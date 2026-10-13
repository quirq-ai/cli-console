"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Command, Flag, Run, Tool } from "@/lib/schema";
import { buildArgv, displayCommand } from "@/lib/parser";

type Preview = { id: string; command: string; cwd: string; terminalReason: string | null; stdinBytes: number };
const favorites = ["gh", "git", "npm", "pnpm", "docker", "kubectl", "vercel", "curl", "python3", "node"];
async function api<T>(body?: unknown, runsOnly = false): Promise<T> {
  const response = await fetch("/api/console" + (runsOnly ? "?runs=1" : ""), body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Request failed"); return data;
}
function FlagField({ flag, value, change }: { flag: Flag; value: string | boolean | undefined; change: (value: string | boolean) => void }) {
  return <div className={flag.value ? "field" : "field switch-field"}>
    <label htmlFor={"flag" + flag.name}><code>{flag.name}</code>{flag.aliases.length > 0 && <small>{flag.aliases.join(", ")}</small>}</label>
    {flag.value ? <input id={"flag" + flag.name} value={typeof value === "string" ? value : ""} onChange={e => change(e.target.value)} placeholder={flag.value} spellCheck={false} /> : <input id={"flag" + flag.name} type="checkbox" checked={value === true} onChange={e => change(e.target.checked)} />}
    <p>{flag.description || "Documented command option"}</p>
  </div>;
}
function StructuredOutput({ text }: { text: string }) {
  let parsed: unknown; try { parsed = JSON.parse(text); } catch { return <pre>{text || "No standard output."}</pre>; }
  if (Array.isArray(parsed) && parsed.length && parsed.every(row => row && typeof row === "object" && !Array.isArray(row))) {
    const columns = [...new Set(parsed.flatMap(row => Object.keys(row)))].slice(0, 8);
    return <div className="table-scroll"><table><thead><tr>{columns.map(key => <th key={key}>{key}</th>)}</tr></thead><tbody>{parsed.slice(0, 200).map((row, i) => <tr key={i}>{columns.map(key => <td key={key}>{typeof row[key] === "object" ? JSON.stringify(row[key]) : String(row[key] ?? "—")}</td>)}</tr>)}</tbody></table>{parsed.length > 200 && <p>Showing the first 200 rows. Full output is available in Raw.</p>}</div>;
  }
  return <pre>{JSON.stringify(parsed, null, 2)}</pre>;
}

export default function Console() {
  const [tools, setTools] = useState<Tool[]>([]), [tool, setTool] = useState("gh"), [cwd, setCwd] = useState("");
  const [trail, setTrail] = useState<Command[]>([]), [values, setValues] = useState<Record<string, string | boolean>>({});
  const [args, setArgs] = useState(""), [stdin, setStdin] = useState(""), [search, setSearch] = useState(""), [flagSearch, setFlagSearch] = useState("");
  const [loading, setLoading] = useState("Connecting to your machine"), [error, setError] = useState(""), [ai, setAi] = useState(false);
  const [runs, setRuns] = useState<Run[]>([]), [selectedRun, setSelectedRun] = useState<string | null>(null), [outputTab, setOutputTab] = useState("Output");
  const [modal, setModal] = useState<"tools" | "review" | "history" | "import" | null>(null), [toolSearch, setToolSearch] = useState(""), [importText, setImportText] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null), [busy, setBusy] = useState(false), [drawer, setDrawer] = useState(false), [toast, setToast] = useState("");
  const generation = useRef(0), searchRef = useRef<HTMLInputElement>(null), modalRef = useRef<HTMLDialogElement>(null);
  const command = trail.at(-1), root = trail[0], family = trail[1];
  const pathKey = command?.path.join(" ") ?? "";
  const positionals = args.split("\n").filter(v => v !== "");
  let display = tool, invalid = "";
  if (command) { try { display = displayCommand(tool, buildArgv(command, values, positionals)); } catch (e) { invalid = (e as Error).message; } }
  const activeRun = runs.find(r => r.id === selectedRun);

  const open = useCallback(async (name: string, path: string[] = [], refresh = false) => {
    const current = ++generation.current;
    setTool(name); setLoading(`Generating ${[name, ...path].join(" ")} from its reference`); setError(""); setDrawer(false);
    setValues({}); setArgs(""); setStdin(""); setFlagSearch("");
    try {
      const next: Command[] = [];
      for (let i = 0; i <= path.length; i++) {
        const result = await api<{ command: Command }>({ action: "generate", tool: name, path: path.slice(0, i), refresh: refresh && i === path.length });
        next.push(result.command);
      }
      if (current !== generation.current) return;
      setTrail(next); setTools(previous => previous.map(t => t.name === name ? { ...t, cached: true } : t));
      window.history.replaceState(null, "", "#" + [name, ...path].map(encodeURIComponent).join("/"));
    } catch (e) { if (current === generation.current) { setTrail([]); setError((e as Error).message); } }
    finally { if (current === generation.current) setLoading(""); }
  }, []);

  useEffect(() => {
    let alive = true;
    api<{ tools: Tool[]; cwd: string; ai: boolean; runs: Run[] }>().then(data => {
      if (!alive) return;
      setTools(data.tools); setCwd(data.cwd); setAi(data.ai); setRuns(data.runs);
      const hash = decodeURIComponent(window.location.hash.slice(1)).split("/").filter(Boolean);
      const preferred = hash[0] ?? (data.tools.some(t => t.name === "gh") ? "gh" : "git");
      void open(preferred, hash.length ? hash.slice(1) : preferred === "gh" ? ["pr", "list"] : []);
    }).catch(e => { setError(e.message); setLoading(""); });
    return () => { alive = false; };
  }, [open]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setDrawer(true); searchRef.current?.focus(); }
      if (e.key === "Escape") { setModal(null); setDrawer(false); }
    };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => { const dialog = modalRef.current; if (modal && dialog && !dialog.open) dialog.showModal(); else if (!modal && dialog?.open) dialog.close(); }, [modal]);
  useEffect(() => { if (!toast) return; const timeout = setTimeout(() => setToast(""), 2500); return () => clearTimeout(timeout); }, [toast]);
  const running = runs.some(r => r.state === "running");
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => { api<{ runs: Run[] }>(undefined, true).then(data => setRuns(data.runs)).catch(e => setError(e.message)); }, 800);
    return () => clearInterval(timer);
  }, [running]);

  async function review() {
    if (!command || invalid) return; setBusy(true); setError("");
    try { const data = await api<{ preview: Preview }>({ action: "preview", tool, path: command.path, values, positionals, cwd, stdin }); setPreview(data.preview); setModal("review"); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function run() {
    if (!preview) return; setBusy(true);
    try { const { run } = await api<{ run: Run }>({ action: "run", id: preview.id, confirmed: true }); setRuns(previous => [run, ...previous]); setSelectedRun(run.id); setModal(null); setPreview(null); }
    catch (e) { setError((e as Error).message); setModal(null); } finally { setBusy(false); }
  }
  async function cancel(id: string) { try { await api({ action: "cancel", id }); const data = await api<{ runs: Run[] }>(undefined, true); setRuns(data.runs); } catch (e) { setError((e as Error).message); } }
  async function copy(text: string) { try { await navigator.clipboard.writeText(text); setToast("Copied to clipboard"); } catch { setToast("Clipboard unavailable. Select and copy the preview."); } }
  async function saveImport() { setBusy(true); try { const { command: imported } = await api<{ command: Command }>({ action: "import", tool, path: [], help: importText }); setTrail([imported]); setError(""); setModal(null); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }

  const groups = [...new Set(root?.children.map(c => c.group) ?? [])];
  const visibleFlags = command?.flags.filter(f => (f.name + " " + f.description).toLowerCase().includes(flagSearch.toLowerCase())) ?? [];
  const shownTools = [...tools].sort((a, b) => {
    const ai = favorites.indexOf(a.name), bi = favorites.indexOf(b.name);
    return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi) || a.name.localeCompare(b.name);
  }).filter(t => t.name.toLowerCase().includes(toolSearch.toLowerCase()));

  return <div className="app-shell">
    <a className="skip-link" href="#main">Skip to command</a>
    {drawer && <button className="scrim" aria-label="Close command menu" onClick={() => setDrawer(false)} />}
    <aside className={"sidebar " + (drawer ? "is-open" : "")} aria-label="Command families">
      <div className="brand"><span className="terminal-mark" aria-hidden="true">&gt;_</span><span>cli <b>console</b></span><span className="local-tag">LOCAL</span></div>
      <button className="tool-picker" onClick={() => { setToolSearch(""); setModal("tools"); }}><span className="tool-avatar">{tool.slice(0, 2)}</span><span><b>{tool}</b><small>Command workspace</small></span><span className="chevron">⌄</span></button>
      <label className="command-search"><span aria-hidden="true">⌕</span><input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)} placeholder="Find a command…" aria-label="Find a command" /><kbd>⌘ K</kbd></label>
      <nav className="family-nav" aria-label="CLI command families">
        <button className={command?.path.length === 0 ? "family-link active" : "family-link"} onClick={() => void open(tool)}><span className="nav-symbol">▦</span>Overview</button>
        {groups.map(group => <div key={group}><div className="nav-label">{group.replace(/commands/i, "").trim() || "COMMANDS"}</div>{root?.children.filter(c => c.group === group && (c.name + " " + c.description).toLowerCase().includes(search.toLowerCase())).map(child => <button key={child.name} className={"family-link " + (command?.path[0] === child.name ? "active" : "")} title={child.description} onClick={() => void open(tool, [child.name])} aria-current={command?.path[0] === child.name ? "page" : undefined}><span className="nav-symbol">◇</span><span>{child.name}</span><span className="nav-arrow">›</span></button>)}</div>)}
        {!loading && root && !root.children.length && <p className="side-empty">This tool has no documented subcommands. Its options are in the workspace.</p>}
      </nav>
      <div className="sidebar-bottom"><span className="dot" /><span><b>Connected locally</b><small>{tools.length.toLocaleString()} installed programs</small></span><button className="icon-button" title="Choose another tool" aria-label="Choose another tool" onClick={() => setModal("tools")}>＋</button></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><div className="breadcrumbs"><button className="icon-button mobile-menu" aria-label="Open command menu" onClick={() => setDrawer(true)}>☰</button><span className="breadcrumb-home">⌘</span><span>/</span><button onClick={() => void open(tool)}>{tool}</button>{command?.path.map((part, i) => <span className="crumb-part" key={i}><span>/</span><button onClick={() => void open(tool, command.path.slice(0, i + 1))}>{part}</button></span>)}</div><div className="top-actions"><span className="machine-badge"><span className="dot" /> Your machine</span><button className="history-button" onClick={() => setModal("history")}>◷ <span>History</span><small>{runs.length}</small></button></div></header>
      <nav className="command-tabs" aria-label="Subcommands"><button className={!command?.path.length ? "selected" : ""} onClick={() => void open(tool)}>Overview</button>{family?.children.map(child => <button key={child.name} className={command?.path[1] === child.name ? "selected" : ""} onClick={() => void open(tool, [family.path[0], child.name])}>{child.name}</button>)}<span className="tabs-status">{command ? (command.source === "man" ? "man page" : "help reference") : "on-demand console"}</span></nav>
      <main id="main">
        {error && <div className="notice error" role="alert"><span>{error}</span><button onClick={() => { setImportText(""); setModal("import"); }}>Import reference</button></div>}
        {loading ? <div className="generation-state" role="status"><span className="generator-icon">&gt;_</span><span className="spinner" /><h1>Making room for your command.</h1><p>{loading}</p><small>Collect reference → extract commands and flags → build console</small></div> : command && <>
          <div className="page-intro"><div><div className="eyebrow"><span>&gt;_</span> {[tool, ...command.path].join(" ")}</div><div className="title-row"><h1>{command.path.length ? command.title.replace(/-/g, " ") : `${tool} workspace`}</h1><span className="generated-badge">✧ Generated</span></div><p>{command.description}</p></div><button className="text-button regenerate" onClick={() => void open(tool, command.path, true)}>↻ Regenerate</button></div>
          {command.children.length > 0 && <section className="command-grid" aria-label="Available commands">{command.children.map(child => <button key={child.name} onClick={() => void open(tool, [...command.path, child.name])}><div><code>{child.name}</code><span>↗</span></div><p>{child.description}</p></button>)}</section>}
          <div className="composer-layout">
            <section className="panel parameters"><div className="panel-heading"><div><h2>Parameters</h2><small>Compose your command</small></div><button className="text-button" onClick={() => { setValues({}); setArgs(""); setStdin(""); }}>Reset</button></div>
              <div className="form-body"><div className="field"><label htmlFor="positionals">Arguments <small>optional</small></label><textarea id="positionals" rows={2} value={args} onChange={e => setArgs(e.target.value)} placeholder="One argument per line" spellCheck={false} /><p>Each line is one argument. Spaces inside a line are preserved.</p></div>
                {command.flags.length > 8 && <input className="flag-search" aria-label="Search flags" placeholder={`Search ${command.flags.length} flags…`} value={flagSearch} onChange={e => setFlagSearch(e.target.value)} />}
                {visibleFlags.slice(0, 8).map(flag => <FlagField key={flag.name} flag={flag} value={values[flag.name]} change={value => setValues(previous => ({ ...previous, [flag.name]: value }))} />)}
                {visibleFlags.length > 8 && <details className="more-flags"><summary>More flags <span>{visibleFlags.length - 8}</span></summary>{visibleFlags.slice(8).map(flag => <FlagField key={flag.name} flag={flag} value={values[flag.name]} change={value => setValues(previous => ({ ...previous, [flag.name]: value }))} />)}</details>}
                {!visibleFlags.length && <p className="muted">{command.flags.length ? "No flags match your search." : "No option fields were extracted. Read the source reference below for this command's syntax."}</p>}
                <details className="more-flags"><summary>Standard input <small>optional</small></summary><textarea aria-label="Standard input" rows={4} value={stdin} onChange={e => setStdin(e.target.value)} placeholder="Send text directly to the process" /></details>
              </div>
            </section>
            <div className="preview-column"><section className="command-preview"><div className="preview-heading"><span><i className="lights"><b /><b /><b /></i>Command preview</span><button onClick={() => void copy(display)} aria-label="Copy command">Copy ⧉</button></div><div className="command-code"><span>$</span><pre>{display}</pre></div><div className="preview-footer"><span><span className="dot" />Runs on your machine</span><span>{invalid ? "Check arguments" : "Ready"}</span></div></section>
              <section className="execution-card"><div className="execution-heading"><span>↗</span><div><h2>Ready when you are</h2><p>Review the command, then run it with your existing CLI connection.</p></div></div>{invalid && <p className="form-error">{invalid}</p>}<button className="primary-button run-button" disabled={busy || Boolean(invalid)} onClick={() => void review()}><span>▷</span>{busy ? "Preparing…" : "Review & run"}<span>↵</span></button><small>Nothing runs until you confirm the preview.</small></section>
              <section className="context-summary"><div className="eyebrow">EXECUTION CONTEXT</div><label htmlFor="working-dir">Working directory</label><input id="working-dir" value={cwd} onChange={e => setCwd(e.target.value)} spellCheck={false} /><dl><div><dt>Reference</dt><dd>{command.source === "man" ? "Local man page" : command.source === "import" ? "Imported text" : "Live CLI help"}</dd></div><div><dt>Generator</dt><dd>{command.enrichment === "ai" ? "Parser + AI" : "Local parser"}</dd></div><div><dt>Cache</dt><dd>Saved · refresh on change</dd></div></dl></section>
              <div className="command-tip"><span>i</span><p>This console comes from your installed tool’s reference. Open a command to generate its next level.</p></div>
            </div>
          </div>
          <section className="panel results-panel"><div className="panel-heading"><div className="result-heading"><h2>Results</h2>{activeRun && <><span className={"result-status " + activeRun.state}>{activeRun.state}</span><small>{(activeRun.duration / 1000).toFixed(1)}s {activeRun.code !== null && `· exit ${activeRun.code}`}</small></>}</div><div>{activeRun?.state === "running" ? <button className="text-button" onClick={() => void cancel(activeRun.id)}>Stop command</button> : activeRun && <button className="text-button" onClick={() => void copy(activeRun.stdout)}>Copy output</button>}</div></div>
            {activeRun ? <><div className="result-command"><code>{activeRun.command}</code></div><div className="result-tabs">{["Output", "Raw", "Stderr"].map(tab => <button className={outputTab === tab ? "selected" : ""} key={tab} onClick={() => setOutputTab(tab)}>{tab}{tab === "Stderr" && activeRun.stderr && <span className="dot amber" />}</button>)}</div>{activeRun.truncated && <p className="notice">Output exceeded 512 KiB. The process was stopped.</p>}<div className="output-body">{outputTab === "Output" ? <StructuredOutput text={activeRun.stdout} /> : <pre>{outputTab === "Stderr" ? activeRun.stderr || "No standard error." : activeRun.stdout || "No standard output."}</pre>}</div></> : <div className="result-empty"><div className="empty-terminal">&gt;_<i /><i /><i /></div><h3>A direct line to your tools.</h3><p>Set your parameters and run a command.<br />Real output from {tool} will appear here.</p><small>LOCAL PROCESS · EXISTING AUTHENTICATION</small></div>}
          </section>
          <details className="source-reference"><summary>Source reference <span>{command.source} · {command.flags.length} flags · {command.children.length} subcommands</span></summary><pre>{command.help}</pre></details>
          <footer><span><span className="dot" />LOCAL EXECUTION</span><span>{ai ? "AI enrichment available" : "No AI key required"}</span><span>Generated from your installed CLI</span></footer>
        </>}
      </main>
    </div>
    <dialog ref={modalRef} aria-labelledby="dialog-title" className={"modal " + (modal === "tools" ? "tools-modal" : "")} onCancel={() => setModal(null)} onClick={e => { if (e.target === e.currentTarget) setModal(null); }}><div className="modal-header"><div><div className="eyebrow">{modal === "tools" ? "YOUR MACHINE" : modal === "review" ? "EXACT COMMAND" : modal === "import" ? "CUSTOM REFERENCE" : "THIS SERVER SESSION"}</div><h2 id="dialog-title">{modal === "tools" ? "Choose your tool" : modal === "review" ? "Review before running" : modal === "import" ? "Import CLI help" : "Run history"}</h2></div><button className="icon-button" aria-label="Close dialog" onClick={() => setModal(null)}>×</button></div>
      {modal === "tools" && <><p className="modal-description">A workspace for any installed CLI. Missing consoles are generated when you open them.</p><input autoFocus aria-label="Search installed tools" value={toolSearch} onChange={e => setToolSearch(e.target.value)} placeholder={`Search ${tools.length.toLocaleString()} installed programs…`} /><div className="tool-list">{shownTools.slice(0, 100).map(t => <button key={t.name} onClick={() => { setModal(null); setSearch(""); void open(t.name); }}><span className="tool-avatar">{t.name.slice(0, 2)}</span><span><b>{t.name}</b><small title={t.executable}>{t.executable}</small></span><span className={t.cached ? "cache-badge" : "generate-label"}>{t.cached ? "Saved console" : "Generate ↗"}</span></button>)}{!shownTools.length && <p>No installed programs match.</p>}{shownTools.length > 100 && <p className="muted">Search to narrow {shownTools.length.toLocaleString()} matches.</p>}</div></>}
      {modal === "review" && preview && <><p className="modal-description">This process can change local files or remote services. Review the command and its directory.</p><pre className="review-command">{preview.command}</pre><dl className="review-context"><dt>Directory</dt><dd>{preview.cwd}</dd><dt>Input</dt><dd>{preview.stdinBytes} bytes</dd></dl>{preview.terminalReason && <div className="notice">{preview.terminalReason}</div>}<div className="modal-actions"><button className="secondary-button" onClick={() => setModal(null)}>Go back</button>{preview.terminalReason ? <button className="primary-button" onClick={() => void copy(preview.command)}>Copy for terminal</button> : <button className="primary-button" disabled={busy} onClick={() => void run()}>{busy ? "Starting…" : "Confirm and run"}</button>}</div></>}
      {modal === "history" && <div className="history-list">{!runs.length ? <p className="muted">Your runs will appear here. History lasts until this server stops.</p> : runs.map(r => <button key={r.id} onClick={() => { setSelectedRun(r.id); setModal(null); }}><code>{r.command}</code><span className={"result-status " + r.state}>{r.state}</span><small>{r.cwd}</small></button>)}</div>}
      {modal === "import" && <><p className="modal-description">Paste root help or a man page for <b>{tool}</b>. Imported consoles provide a command builder and terminal handoff.</p><textarea aria-label="Help text to import" rows={12} value={importText} onChange={e => setImportText(e.target.value)} placeholder="Paste the reference text here…" /><div className="modal-actions"><button className="primary-button" disabled={busy || importText.length < 10} onClick={() => void saveImport()}>Generate console</button></div></>}
    </dialog>
    {toast && <div className="toast" role="status">{toast}</div>}
  </div>;
}
