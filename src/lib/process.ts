import { spawn } from "node:child_process";

const { AI_GATEWAY_API_KEY: _aiKey, ...inheritedEnv } = process.env;
export const processEnv = { ...inheritedEnv, NO_COLOR: "1", TERM: "dumb", PAGER: "cat", MANPAGER: "cat", GIT_PAGER: "cat", GH_PAGER: "cat", CI: "1", GIT_TERMINAL_PROMPT: "0", GH_PROMPT_DISABLED: "1" };

export async function capture(executable: string, argv: string[], cwd = process.cwd(), timeout = 8_000) {
  return new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve, reject) => {
    const child = spawn(executable, argv, { cwd, env: processEnv, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", size = 0, failure: Error | undefined;
    const timer = setTimeout(() => { failure = new Error("Help collection timed out"); child.kill("SIGKILL"); }, timeout);
    for (const [stream, type] of [[child.stdout, "out"], [child.stderr, "err"]] as const) stream.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 256 * 1024) { failure = new Error("Help output exceeded 256 KiB"); child.kill("SIGKILL"); return; }
      if (type === "out") stdout += chunk.toString(); else stderr += chunk.toString();
    });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => { clearTimeout(timer); if (failure) reject(failure); else resolve({ stdout, stderr, code }); });
  });
}
