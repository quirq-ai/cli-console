export class HttpError extends Error { constructor(message: string, public status = 400) { super(message); } }

export function assertLocal(request: Request) {
  const host = request.headers.get("host") ?? new URL(request.url).host;
  if (!/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host)) throw new HttpError("This console accepts loopback connections only", 403);
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== host) throw new HttpError("Cross-origin requests are blocked", 403);
  if (request.headers.get("sec-fetch-site") === "cross-site") throw new HttpError("Cross-site requests are blocked", 403);
  if (request.method !== "GET" && !origin) throw new HttpError("An Origin header is required", 403);
}

export async function readJson(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new HttpError("Use application/json", 415);
  const reader = request.body?.getReader(); if (!reader) throw new HttpError("Missing body");
  let size = 0; const chunks: Uint8Array[] = [];
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 64 * 1024) { await reader.cancel(); throw new HttpError("Request exceeds 64 KiB", 413); } chunks.push(value); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
