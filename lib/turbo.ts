/**
 * Arweave uploads through the ArDrive Turbo upload service.
 * Server-side only: the signing key never reaches the browser.
 *
 * The data item is signed locally (ANS-104) and posted as raw bytes, so no
 * extra SDK is needed and the Worker runtime stays the same as for Irys.
 * Items up to 105 KiB use Turbo's free tier; a vault is well under 1 KiB.
 */
import { createHash } from "crypto";
import { createData, EthereumSigner } from "@irys/bundles";

export const TURBO_UPLOAD_URL = "https://upload.ardrive.io/v1/tx";
export const TURBO_MAX_FREE_BYTES = 105 * 1024;

export type UploadTag = { name: string; value: string };

/** Arweave data item ID: base64url(SHA-256(signature)). */
export function arweaveIdFromSignature(signature: Uint8Array): string {
  return createHash("sha256").update(signature).digest("base64url");
}

export async function uploadToTurbo(
  data: string | Uint8Array,
  tags: UploadTag[],
  options: { privateKey?: string; fetcher?: typeof fetch; timeoutMs?: number } = {},
): Promise<{ id: string; bytes: number }> {
  const privateKey = (options.privateKey ?? process.env.TURBO_PRIVATE_KEY ?? process.env.IRYS_PRIVATE_KEY ?? "").replace(/^0x/, "");
  if (!/^[0-9a-fA-F]{64}$/.test(privateKey)) throw new Error("Turbo signing key is not configured");
  const { fetcher = fetch, timeoutMs = 20000 } = options;

  const signer = new EthereumSigner(privateKey);
  const item = createData(typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data), signer, { tags });
  await item.sign(signer);
  const raw = item.getRaw();
  if (raw.length > TURBO_MAX_FREE_BYTES) throw new Error("Data item exceeds the free upload size");

  const expectedId = arweaveIdFromSignature(item.rawSignature);
  const res = await fetcher(TURBO_UPLOAD_URL, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: new Uint8Array(raw),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Turbo upload failed (${res.status})`);
  const receipt = (await res.json()) as { id?: unknown };
  // The receipt must name the item we signed; never store an ID we cannot derive ourselves.
  if (receipt.id !== expectedId) throw new Error("Turbo receipt does not match the signed data item");
  return { id: expectedId, bytes: raw.length };
}
