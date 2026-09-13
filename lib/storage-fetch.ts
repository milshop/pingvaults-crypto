import { isStorageTxId, STORAGE_GATEWAYS } from "./storage-status";

// Retrieval does not need an upload SDK, wallet or funding capability.
export async function fetchCiphertext(txId: string, options: { fetcher?: typeof fetch; signal?: AbortSignal; timeoutMs?: number } = {}) {
  if (!isStorageTxId(txId)) throw new Error("Invalid txId");
  const { fetcher = fetch, signal, timeoutMs = 8000 } = options;
  for (const gateway of STORAGE_GATEWAYS) {
    const url = `${gateway}/${txId}`;
    try {
      const timeout = AbortSignal.timeout(timeoutMs);
      const res = await fetcher(url, { cache: "no-store", signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
      if (!res.ok) { await res.body?.cancel(); continue; }
      const ciphertext = (await res.text()).trim();
      if (!isCiphertext(ciphertext)) continue;
      return { ciphertext, url, gateway: new URL(gateway).hostname };
    } catch { if (signal?.aborted) throw new Error("Request cancelled"); }
  }
  throw new Error("Ciphertext could not be read from the checked gateways. Retry or import your exported recovery JSON in the offline decryptor.");
}
export function isCiphertext(value: unknown): value is string {
  // Existing vaults use padded standard Base64 AES-GCM ciphertext (at least a 16-byte tag).
  return typeof value === "string" && value.length >= 24 && value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}
