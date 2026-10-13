import { spawn, type ChildProcess } from "node:child_process";
import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import type { Command, Run } from "./schema";
import { buildArgv, displayCommand } from "./parser";
import { fingerprint, resolveTool } from "./catalog";
import { processEnv } from "./process";

type Preview = { id: string; command: string; cwd: string; argv: string[]; executable: string; fingerprint: string; expiresAt: number; terminalReason: string | null; stdin: string };
type State = { previews: Map<string, Preview>; runs: Map<string, Run>; processes: Map<string, ChildProcess> };
const globalState = globalThis as typeof globalThis & { cliConsoleState?: State };
const state = globalState.cliConsoleState ??= { previews: new Map(), runs: new Map(), processes: new Map() };

export function terminalReason(command: Command, values: Record<string, string | boolean>) {
  const path = command.path.join(" ");
  if (/^(bash|sh|zsh|fish|node|python\d*|ruby|perl|php|osascript|ssh|sudo|su|vim|vi|nano|less|more|man|open|npx)$/.test(command.tool)) return "This program needs a terminal or can run arbitrary code. Copy the command and use your terminal.";
  if (/^(exec|run|run-script|start|stop|restart|test|explore|edit|login|adduser)$/.test(path) && /^(npm|pnpm|yarn|bun)$/.test(command.tool)) return "Project scripts and interactive package-manager commands run in your terminal.";
  if (command.tool === "gh" && /^(auth|alias|extension|copilot|codespace (ssh|code)|pr (edit|create)|issue (edit|create)|repo (create|edit))\b/.test(path)) return "Credential, extension, editor, and interactive commands run in your terminal.";
  if (command.tool === "git" && /^(credential|citool|gui|gitk|difftool|mergetool|send-email|p4|svn|hook)\b/.test(path)) return "This Git operation uses credentials or an interactive helper. Use your terminal.";
  if (Object.entries(values).some(([key, value]) => typeof value === "string" && (/--(jq|template)/.test(key) && /\benv\b|environ/.test(value)))) return "Expressions that inspect the process environment need a terminal.";
  if (command.source === "import") return "This console was generated from imported text. Use the command in your terminal until live help can verify it.";
  return null;
}

export async function createPreview(command: Command, values: Record<string, string | boolean>, positionals: string[], cwd: string, stdin: string) {
  if (!isAbsolute(cwd) || !(await stat(cwd)).isDirectory()) throw new Error("Choose an existing absolute working directory");
  const executable = await resolveTool(command.tool);
  const argv = buildArgv(command, values, positionals);
  const preview: Preview = { id: randomUUID(), command: displayCommand(command.tool, argv), cwd, argv, executable, fingerprint: await fingerprint(executable), expiresAt: Date.now() + 120_000, terminalReason: terminalReason(command, values), stdin };
  for (const [id, value] of state.previews) if (value.expiresAt < Date.now()) state.previews.delete(id);
  if (state.previews.size >= 100) state.previews.delete(state.previews.keys().next().value!);
  state.previews.set(preview.id, preview);
  return { id: preview.id, command: preview.command, cwd, expiresAt: preview.expiresAt, terminalReason: preview.terminalReason, stdinBytes: Buffer.byteLength(stdin) };
}

function stopProcess(child: ChildProcess) {
  if (!child.pid) return;
  try { if (process.platform !== "win32") process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); } catch { child.kill("SIGKILL"); }
}
export async function runPreview(id: string, confirmed: boolean) {
  const preview = state.previews.get(id);
  if (!preview || preview.expiresAt < Date.now()) throw new Error("Preview expired. Review a fresh preview.");
  if (confirmed !== true) throw new Error("Explicit confirmation is required");
  if (preview.terminalReason) throw new Error(preview.terminalReason);
  if (state.processes.size >= 4) throw new Error("Four commands are already running");
  if (await fingerprint(preview.executable) !== preview.fingerprint) throw new Error("Executable changed since preview. Review again.");
  // Consume only after validation, and before spawning, to prevent replay.
  if (!state.previews.delete(id)) throw new Error("Preview already used");
  const run: Run = { id: randomUUID(), command: preview.command, cwd: preview.cwd, state: "running", stdout: "", stderr: "", code: null, startedAt: Date.now(), duration: 0, truncated: false };
  const child = spawn(preview.executable, preview.argv, { cwd: preview.cwd, env: processEnv, shell: false, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] });
  state.runs.set(run.id, run); state.processes.set(run.id, child);
  let bytes = 0;
  const timer = setTimeout(() => { run.state = "timeout"; stopProcess(child); }, 120_000);
  for (const [stream, key] of [[child.stdout!, "stdout"], [child.stderr!, "stderr"]] as const) stream.on("data", (chunk: Buffer) => {
    const remaining = 512 * 1024 - bytes; bytes += chunk.length;
    if (remaining > 0) run[key] += chunk.subarray(0, remaining).toString();
    if (bytes > 512 * 1024) { run.truncated = true; stopProcess(child); }
  });
  child.stdin!.on("error", () => { /* closed input is an ordinary CLI outcome */ });
  child.stdin!.end(preview.stdin);
  child.on("error", error => { run.stderr += error.message; run.state = "failed"; });
  child.on("close", code => {
    clearTimeout(timer); state.processes.delete(run.id); run.code = code; run.duration = Date.now() - run.startedAt;
    if (run.state === "running") run.state = code === 0 ? "completed" : "failed";
    while (state.runs.size > 30) { const oldest = [...state.runs].find(([, r]) => r.state !== "running"); if (!oldest) break; state.runs.delete(oldest[0]); }
  });
  return run;
}
export function listRuns() { return [...state.runs.values()].reverse().map(run => ({ ...run, duration: run.state === "running" ? Date.now() - run.startedAt : run.duration })); }
export function cancelRun(id: string) { const child = state.processes.get(id), run = state.runs.get(id); if (!child || !run) throw new Error("This command is no longer running"); run.state = "cancelled"; stopProcess(child); return run; }
