export class RequestPolicyError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

export async function readBoundedJson(request: Request, maxBytes: number): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new RequestPolicyError("Expected JSON", 415);
  }
  const origin = request.headers.get("origin");
  const expectedOrigin = process.env.NODE_ENV === "production"
    ? new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.pingvaults.com").origin
    : new URL(request.url).origin;
  if ((origin && origin !== expectedOrigin) || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new RequestPolicyError("Cross-site request rejected", 403);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new RequestPolicyError("Missing request body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new RequestPolicyError("Request too large", 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new RequestPolicyError("Invalid JSON"); }
}
