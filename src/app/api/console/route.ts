import { z } from "zod";
import { assertLocal, HttpError, readJson } from "@/lib/boundary";
import { getCommand, importHelp, listTools } from "@/lib/catalog";
import { cancelRun, createPreview, listRuns, runPreview } from "@/lib/runner";
import { token } from "@/lib/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const commandRequest = z.object({ tool: token, path: z.array(token).max(12).default([]) });
const payload = z.discriminatedUnion("action", [
  commandRequest.extend({ action: z.literal("generate"), refresh: z.boolean().default(false) }),
  commandRequest.extend({ action: z.literal("import"), help: z.string().min(10).max(50_000) }),
  commandRequest.extend({ action: z.literal("preview"), values: z.record(z.string(), z.union([z.string().max(8_000), z.boolean()])), positionals: z.array(z.string().max(8_000)).max(100), cwd: z.string().max(2_000), stdin: z.string().max(30_000).default("") }),
  z.object({ action: z.literal("run"), id: z.string().uuid(), confirmed: z.literal(true) }),
  z.object({ action: z.literal("cancel"), id: z.string().uuid() }),
]);
function failure(error: unknown) { return Response.json({ error: error instanceof Error ? error.message : "Request failed" }, { status: error instanceof HttpError ? error.status : 400, headers: { "Cache-Control": "no-store" } }); }
export async function GET(request: Request) {
  try { assertLocal(request); const runsOnly = new URL(request.url).searchParams.get("runs"); return Response.json(runsOnly ? { runs: listRuns() } : { tools: await listTools(), cwd: process.cwd(), ai: Boolean(process.env.AI_GATEWAY_API_KEY && process.env.AI_MODEL), runs: listRuns() }, { headers: { "Cache-Control": "no-store" } }); } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    assertLocal(request); const body = payload.parse(await readJson(request));
    switch (body.action) {
      case "generate": return Response.json({ command: await getCommand(body.tool, body.path, body.refresh) });
      case "import": return Response.json({ command: await importHelp(body.tool, body.path, body.help) });
      case "preview": return Response.json({ preview: await createPreview(await getCommand(body.tool, body.path), body.values, body.positionals, body.cwd, body.stdin) });
      case "run": return Response.json({ run: await runPreview(body.id, body.confirmed) });
      case "cancel": return Response.json({ run: cancelRun(body.id) });
    }
  } catch (error) { return failure(error); }
}
