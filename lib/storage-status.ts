/** A receipt, a gateway response and chain inclusion are different evidence. */
export const STORAGE_GATEWAYS = ["https://gateway.irys.xyz", "https://arweave.net", "https://ar-io.dev"] as const;
export const STORAGE_PROBE_TIMEOUT_MS = 6000;
export function isStorageTxId(value: unknown): value is string {
  // Legacy Arweave and Irys IDs; shape alone does not identify a network.
  return typeof value === "string" && /^[a-zA-Z0-9_-]{43,44}$/.test(value);
}
export type ObservationState = "found" | "not_found" | "error";
export interface StorageStatus {
  version: 2;
  txId: string;
  checkedAt: string;
  arweave: { state: ObservationState; blockHeight: number | null; blockTimestamp: number | null };
  irys: { state: ObservationState; uploadedAt: number | null };
  gateways: { url: string; state: ObservationState }[];
}
type IndexNode = { id?: unknown; timestamp?: unknown; block?: { height?: unknown; timestamp?: unknown } | null; receipt?: { timestamp?: unknown } | null };
function positiveNumber(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}
function probeSignal(signal?: AbortSignal, timeoutMs = STORAGE_PROBE_TIMEOUT_MS) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
export function isDataResponse(response: Response): boolean {
  const type = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  return response.status === 200 && !!type && ["application/octet-stream", "text/plain"].includes(type) && response.headers.get("content-length") !== "0";
}
async function indexLookup(url: string, txId: string, fields: string, fetcher: typeof fetch, signal?: AbortSignal, timeoutMs?: number) {
  try {
    const res = await fetcher(url, {
      method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", signal: probeSignal(signal, timeoutMs),
      body: JSON.stringify({ query: `query($ids: [${url === "https://uploader.irys.xyz/graphql" ? "String" : "ID"}!]) { transactions(ids: $ids) { edges { node { id ${fields} } } } }`, variables: { ids: [txId] } }),
    });
    if (!res.ok) throw new Error("Index unavailable");
    const json = await res.json();
    const edges = json?.data?.transactions?.edges;
    if ((json.errors && (!Array.isArray(json.errors) || json.errors.length)) || !Array.isArray(edges)) throw new Error("Invalid index response");
    if (edges.length === 0) return { state: "not_found" as const, node: null };
    const node = edges.find((edge: { node?: IndexNode }) => edge?.node?.id === txId)?.node as IndexNode | undefined;
    if (!node) throw new Error("Mismatched index result");
    return { state: "found" as const, node };
  } catch { return { state: "error" as const, node: null }; }
}
export async function getStorageStatus(txId: string, options: { fetcher?: typeof fetch; signal?: AbortSignal; timeoutMs?: number; now?: () => number } = {}): Promise<StorageStatus> {
  if (!isStorageTxId(txId)) throw new Error("Invalid txId");
  const { fetcher = fetch, signal, timeoutMs, now = Date.now } = options;
  const [arweave, irys, gateways] = await Promise.all([
    indexLookup("https://arweave.net/graphql", txId, "block { height timestamp }", fetcher, signal, timeoutMs),
    indexLookup("https://uploader.irys.xyz/graphql", txId, "timestamp receipt { timestamp }", fetcher, signal, timeoutMs),
    Promise.all(STORAGE_GATEWAYS.map(async (gateway) => {
      const url = `${gateway}/${txId}`;
      try {
        const res = await fetcher(url, { method: "HEAD", cache: "no-store", signal: probeSignal(signal, timeoutMs) });
        const state: ObservationState = isDataResponse(res) ? "found" : res.status === 404 || res.status === 410 ? "not_found" : "error";
        return { url, state };
      } catch { return { url, state: "error" as const }; }
    })),
  ]);
  const timestamp = positiveNumber(irys.node?.receipt?.timestamp) ?? positiveNumber(irys.node?.timestamp);
  return {
    version: 2, txId, checkedAt: new Date(now()).toISOString(),
    arweave: { state: arweave.state, blockHeight: positiveNumber(arweave.node?.block?.height), blockTimestamp: positiveNumber(arweave.node?.block?.timestamp) },
    irys: { state: irys.state, uploadedAt: timestamp !== null && timestamp <= now() ? timestamp : null }, gateways,
  };
}
