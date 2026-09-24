import { isStorageTxId, STORAGE_GATEWAYS } from "./storage-status";

// Retrieval does not need an upload SDK, wallet or funding capability.
// Gateways are queried in parallel and the first valid ciphertext wins: fresh Arweave
// uploads are served from gateway caches before they are in a block, and any single
// gateway can briefly fail. One retry round covers short blips.
export async function fetchCiphertext(txId: string, options: { fetcher?: typeof fetch; signal?: AbortSignal; timeoutMs?: number; retryDelayMs?: number } = {}) {
  if (!isStorageTxId(txId)) throw new Error("Invalid txId");
  const { fetcher = fetch, signal, timeoutMs = 8000, retryDelayMs = 1000 } = options;
  for (let round = 0; round < 2; round++) {
    if (round > 0) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    if (signal?.aborted) throw new Error("Request cancelled");
    const settled = new AbortController();
    const attempts = STORAGE_GATEWAYS.map(async (gateway) => {
      if (signal?.aborted) throw new Error("Request cancelled");
      const url = `${gateway}/${txId}`;
      const signals = [settled.signal, AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])];
      const res = await fetcher(url, { cache: "no-store", signal: AbortSignal.any(signals) });
      if (!res.ok) { await res.body?.cancel(); throw new Error("Gateway unavailable"); }
      const ciphertext = (await res.text()).trim();
      if (!isCiphertext(ciphertext)) throw new Error("Not ciphertext");
      return { ciphertext, url, gateway: new URL(gateway).hostname };
    });
    try {
      const result = await Promise.any(attempts);
      settled.abort(); // stop the slower gateways
      return result;
    } catch {
      if (signal?.aborted) throw new Error("Request cancelled");
    }
  }
  throw new Error("Ciphertext could not be read from the checked gateways. Retry or import your exported recovery JSON in the offline decryptor.");
}
export function isCiphertext(value: unknown): value is string {
  // Existing vaults use padded standard Base64 AES-GCM ciphertext (at least a 16-byte tag).
  return typeof value === "string" && value.length >= 24 && value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}
