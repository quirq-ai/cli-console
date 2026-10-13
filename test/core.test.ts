import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseHelp, buildArgv, displayCommand, cleanHelp } from '../src/lib/parser';
import { assertLocal, readJson } from '../src/lib/boundary';
import { createPreview, runPreview, listRuns, cancelRun, terminalReason } from '../src/lib/runner';
import { capture } from '../src/lib/process';
import { getCommand } from '../src/lib/catalog';

const cobra = `Work with issues\n\nUSAGE\n  demo issue <command> [flags]\n\nAVAILABLE COMMANDS\n  list:        List issues\n  create:      Create an issue\n\nFLAGS\n  -L, --limit int      Maximum count (default 30)\n  -a, --all            Include everything\n  --label string       Filter by label\n\nINHERITED FLAGS\n  -R, --repo string    Select repository\n`;
const command = parseHelp('git', [], 'usage: git [--version]\n\nFLAGS\n  --version   Show version\n');

async function finish(id: string) { const deadline = Date.now() + 3000; while (Date.now() < deadline) { const r = listRuns().find(r => r.id === id)!; if (r.state !== 'running') return r; await new Promise(resolve => setTimeout(resolve, 20)); } throw new Error('Run did not complete'); }

test('extract Cobra children, aliases, typed and boolean flags', () => {
 const c = parseHelp('demo',['issue'],cobra);
 assert.deepEqual(c.children.map(x=>x.name),['list','create']);
 assert.deepEqual(c.flags.map(x=>[x.name,x.value]),[['--limit','int'],['--all',''],['--label','string'],['--repo','string']]);
 assert.deepEqual(c.flags[0].aliases,['-L']);
});
test('extract argparse/clap-style commands and option values', () => {
 const c=parseHelp('demo',[],'Usage: demo [OPTIONS] <COMMAND>\n\nCommands:\n  init     Create project\n  inspect  Inspect data\n\nOptions:\n  -c, --config <FILE>  Configuration file\n  -v, --verbose        Verbose output');
 assert.equal(c.children.length,2); assert.equal(c.flags[0].value,'<FILE>'); assert.equal(c.flags[1].value,'');
});
test('extract npm comma-separated inventory and Git command groups',()=>{
 assert.deepEqual(parseHelp('npm',[],'All commands:\n    install, exec, run,\n    view, whoami').children.map(c=>c.name),['install','exec','run','view','whoami']);
 const c=parseHelp('git',[],'Main Porcelain Commands\n   status                  Show status\n   log                     Show commits\nUser-facing repository, command and file interfaces\n   hooks                   Hooks docs');
 assert.deepEqual(c.children.map(c=>c.name),['status','log']);
});
test('render man-page flags and remove terminal formatting',()=>{
 const c=parseHelp('demo',[],'NAME\n demo — example\nOPTIONS\n     --output FILE\n          Write to a file.\n     --quiet\n          Suppress output.','man');
 assert.equal(c.flags[0].name,'--output'); assert.equal(c.flags[0].value,'FILE'); assert.match(c.flags[0].description,/Write to a file/);
 assert.equal(cleanHelp('\x1b[31mred\x1b[0m b\bb'),'red b');
});
test('keep argument boundaries, quote preview, reject unlisted options',()=>{
 const c=parseHelp('demo',['issue'],cobra);
 assert.deepEqual(buildArgv(c,{'--limit':'5','--all':true},['hello world','$(whoami)']),['issue','--limit','5','--all','hello world','$(whoami)']);
 assert.match(displayCommand('demo',['$(touch nope)']),/'\$\(touch nope\)'/);
 assert.throws(()=>buildArgv(c,{'--execute':'oops'},[]),/Unknown flag/);
 assert.throws(()=>buildArgv(c,{},['--unknown']),/Positional/);
});
test('block cross-origin, cross-site and non-loopback requests',()=>{
 assert.doesNotThrow(()=>assertLocal(new Request('http://127.0.0.1:4320/api/console',{method:'POST',headers:{host:'127.0.0.1:4320',origin:'http://127.0.0.1:4320'}})));
 const cases: Record<string,string>[] = [{host:'evil.test'},{host:'127.0.0.1:4320',origin:'https://evil.test'},{host:'127.0.0.1:4320','sec-fetch-site':'cross-site'}];
 for(const headers of cases) assert.throws(()=>assertLocal(new Request('http://127.0.0.1:4320/api/console',{headers})),/blocked|loopback/);
 assert.throws(()=>assertLocal(new Request('http://127.0.0.1:4320/api/console',{method:'POST'})),/Origin/);
});
test('enforce JSON request size and media type',async()=>{
 await assert.rejects(readJson(new Request('http://localhost',{method:'POST',body:'oops'})),/application\/json/);
 await assert.rejects(readJson(new Request('http://localhost',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify('x'.repeat(70000))})),/64 KiB/);
});
test('require confirmation, execute immutable preview and prevent replay',async()=>{
 const p=await createPreview(command,{'--version':true},[],process.cwd(),'');
 await assert.rejects(runPreview(p.id,false),/confirmation/);
 const r=await runPreview(p.id,true); const done=await finish(r.id);
 assert.equal(done.code,0); assert.match(done.stdout,/git version/);
 await assert.rejects(runPreview(p.id,true),/expired|used/);
});
test('interactive and credential commands require terminal handoff',async()=>{
 assert.ok(terminalReason({...command,tool:'gh',path:['auth','token']},{}));
 assert.ok(terminalReason({...command,tool:'npm',path:['run']},{}));
 const p=await createPreview({...command,source:'import'},{'--version':true},[],process.cwd(),'');
 await assert.rejects(runPreview(p.id,true),/imported text/);
});
test('cancel a running process without executing shell strings',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'cli-console-test-')); const file=join(dir,'fixture-cli'); const old=process.env.PATH;
 try {
 await writeFile(file,'#!/bin/sh\nsleep 30\n'); await chmod(file,0o700); process.env.PATH=dir+':'+old;
 const p=await createPreview({...command,tool:'fixture-cli',flags:[]},{},[],dir,''); const r=await runPreview(p.id,true); cancelRun(r.id);
 assert.equal((await finish(r.id)).state,'cancelled');
 } finally {process.env.PATH=old; await rm(dir,{recursive:true,force:true});}
});
test('bound help timeout and output',async()=>{
 await assert.rejects(capture(process.execPath,['-e','setTimeout(()=>{},10000)'],process.cwd(),30),/timed out/);
 await assert.rejects(capture(process.execPath,['-e','process.stdout.write("a".repeat(300000))']),/256 KiB/);
});
test('generate and cache real gh and git references, reject invented paths',async()=>{
 const root=await getCommand('gh',[]); assert.ok(root.children.some(c=>c.name==='pr'));
 const selected=await getCommand('gh',['pr','list']); assert.ok(selected.flags.some(f=>f.name==='--limit'));
 const again=await getCommand('gh',['pr','list']); assert.equal(again.generatedAt,selected.generatedAt);
 await assert.rejects(getCommand('gh',['invented-command']),/parent help/);
 const git=await getCommand('git',[]); assert.ok(git.children.some(c=>c.name==='status'));
});
test('preserve optional equals values from real Git man pages',async()=>{
 const c=await getCommand('git',['status']);
 assert.match(c.description,/working tree status/i);
 assert.deepEqual(buildArgv(c,{'--porcelain':'v1'},[]),['status','--porcelain=v1']);
 const r=await capture('/usr/bin/git',buildArgv(c,{'--porcelain':'v1'},[])); assert.equal(r.code,0);
});
test('never probe an unfamiliar executable for help',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'cli-console-discovery-')); const old=process.env.PATH;
 try {
 const name='unfamiliar-cli-'+Date.now(); const marker=join(dir,'started');
 await writeFile(join(dir,name),'#!/bin/sh\ntouch '+marker+'\n'); await chmod(join(dir,name),0o700); process.env.PATH=dir+':'+old;
 await assert.rejects(getCommand(name,[]),/was not started/);
 const {access}=await import('node:fs/promises'); await assert.rejects(access(marker));
 } finally {process.env.PATH=old; await rm(dir,{recursive:true,force:true});}
});
test('generate npm inline options and pnpm categorized commands',async()=>{
 const npm=await getCommand('npm',['view']); assert.ok(npm.flags.some(f=>f.name==='--json' && !f.value));
 const pnpm=await getCommand('pnpm',[]); assert.ok(pnpm.children.some(c=>c.name==='install')); assert.ok(pnpm.children.some(c=>c.name==='run'));
});
