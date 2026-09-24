/** A receipt, a gateway response and chain inclusion are different evidence. */
export const STORAGE_GATEWAYS = ["https://gateway.irys.xyz", "https://arweave.net", "https://ar-io.dev"] as const;
export const STORAGE_PROBE_TIMEOUT_MS = 6000;
export function isStorageTxId(value: unknown): value is string {
  // Legacy Arweave and Irys IDs; shape alone does not identify a network.
  return typeof value === "string" && /^[a-zA-Z0-9_-]{43,44}$/.test(value);
}
/** Arweave IDs are 32 bytes in base64url (43 chars). A 44-char ID can only be an Irys L1 ID. */
export function couldBeArweaveTxId(txId: string): boolean {
  return txId.length === 43;
}
export type ObservationState = "found" | "not_found" | "error";
/** Where the evidence says the ciphertext lives. "unknown" is not "lost". */
export type StorageNetwork = "arweave" | "irys" | "unknown";
export interface StorageStatus {
  version: 3;
  txId: string;
  checkedAt: string;
  network: StorageNetwork;
  arweave: { state: ObservationState | "not_applicable"; blockHeight: number | null; blockTimestamp: number | null };
  /** Turbo (Arweave upload service) receipt: accepted for Arweave, not yet proof of a block. */
  turbo: { state: ObservationState | "not_applicable"; status: string | null };
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
async function turboLookup(txId: string, fetcher: typeof fetch, signal?: AbortSignal, timeoutMs?: number) {
  try {
    const res = await fetcher(`https://upload.ardrive.io/v1/tx/${txId}/status`, { cache: "no-store", signal: probeSignal(signal, timeoutMs) });
    if (res.status === 404) { await res.body?.cancel(); return { state: "not_found" as const, status: null }; }
    if (!res.ok) throw new Error("Turbo status unavailable");
    const json = await res.json();
    const status = typeof json?.status === "string" && /^[A-Z_]{1,32}$/.test(json.status) ? json.status : null;
    if (!status) throw new Error("Invalid Turbo status");
    return { state: "found" as const, status };
  } catch { return { state: "error" as const, status: null }; }
}
export async function getStorageStatus(txId: string, options: { fetcher?: typeof fetch; signal?: AbortSignal; timeoutMs?: number; now?: () => number } = {}): Promise<StorageStatus> {
  if (!isStorageTxId(txId)) throw new Error("Invalid txId");
  const { fetcher = fetch, signal, timeoutMs, now = Date.now } = options;
  const arweaveShape = couldBeArweaveTxId(txId);
  // Only probe Arweave for IDs Arweave could have issued; a 44-char Irys L1 ID is rejected there.
  const gatewaysToProbe = arweaveShape ? STORAGE_GATEWAYS : STORAGE_GATEWAYS.filter((gateway) => gateway === "https://gateway.irys.xyz");
  const [arweave, turbo, irys, gateways] = await Promise.all([
    arweaveShape
      ? indexLookup("https://arweave.net/graphql", txId, "block { height timestamp }", fetcher, signal, timeoutMs)
      : Promise.resolve({ state: "not_applicable" as const, node: null }),
    arweaveShape ? turboLookup(txId, fetcher, signal, timeoutMs) : Promise.resolve({ state: "not_applicable" as const, status: null }),
    indexLookup("https://uploader.irys.xyz/graphql", txId, "timestamp receipt { timestamp }", fetcher, signal, timeoutMs),
    Promise.all(gatewaysToProbe.map(async (gateway) => {
      const url = `${gateway}/${txId}`;
      try {
        const res = await fetcher(url, { method: "HEAD", cache: "no-store", signal: probeSignal(signal, timeoutMs) });
        const state: ObservationState = isDataResponse(res) ? "found" : res.status === 404 || res.status === 410 ? "not_found" : "error";
        return { url, state };
      } catch { return { url, state: "error" as const }; }
    })),
  ]);
  const timestamp = positiveNumber(irys.node?.receipt?.timestamp) ?? positiveNumber(irys.node?.timestamp);
  // An Arweave index record or Turbo receipt wins; an Irys record with no Arweave record means Irys L1 storage.
  const network: StorageNetwork = arweave.state === "found" || turbo.state === "found" ? "arweave"
    : irys.state === "found" && (arweave.state === "not_found" || arweave.state === "not_applicable") ? "irys"
    : "unknown";
  return {
    version: 3, txId, checkedAt: new Date(now()).toISOString(), network,
    arweave: { state: arweave.state, blockHeight: positiveNumber(arweave.node?.block?.height), blockTimestamp: positiveNumber(arweave.node?.block?.timestamp) },
    turbo: { state: turbo.state, status: turbo.status },
    irys: { state: irys.state, uploadedAt: timestamp !== null && timestamp <= now() ? timestamp : null }, gateways,
  };
}
