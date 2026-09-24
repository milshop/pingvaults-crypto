"use client";

import { useState, useEffect } from "react";
import { useLocale } from "next-intl";
import type { StorageStatus } from "@/lib/storage-status";

const copy = {
  en: {
    checking: "Checking storage status…", refresh: "Check again", failed: "Status check unavailable right now. This does not mean your ciphertext is lost.",
    irysStored: "Stored on the Irys L1 network", irysNote: "This vault is stored on Irys L1, not on Arweave, so Arweave gateways won't find it. That is expected and does not mean anything is missing.",
    receipt: "Irys upload record found", noReceipt: "No Irys upload record found in this check", irysError: "Irys index could not be checked",
    confirmed: "Written to Arweave", indexed: "Received by Arweave, waiting to be written to a block", notFound: "No Arweave record found in this check", indexError: "Arweave index could not be checked",
    unknownNote: "This check could not confirm which network holds the ciphertext. A gateway miss does not mean data is lost; try again later.",
    available: "Gateway returned the ciphertext", missing: "Not found at this gateway", unknown: "Gateway check inconclusive",
    backup: "We recommend also keeping the exported JSON (with ciphertext) and the offline decryptor, so recovery never depends on a gateway.",
    checked: "Checked", uploaded: "Uploaded", block: "Block", stopped: "Checks run on demand; no background polling.",
  },
  zh: {
    checking: "正在检查存储状态…", refresh: "重新检查", failed: "状态查询暂时不可用，不代表密文丢失。",
    irysStored: "已存储在 Irys L1 网络", irysNote: "这个金库存储在 Irys L1，不在 Arweave 上，所以 Arweave 网关查不到它是正常的，不代表数据缺失。",
    receipt: "已查到 Irys 上传记录", noReceipt: "本次未查到 Irys 上传记录", irysError: "暂时无法查询 Irys 索引",
    confirmed: "已写入 Arweave", indexed: "Arweave 已收到，等待写入区块", notFound: "本次未查到 Arweave 记录", indexError: "暂时无法查询 Arweave 索引",
    unknownNote: "本次检查未能确认密文所在的网络。网关暂时查不到不代表数据丢失，请稍后重试。",
    available: "网关已返回密文", missing: "该网关未找到数据", unknown: "该网关检查未得出结论",
    backup: "建议同时保存导出 JSON（含密文）和离线解密器，这样恢复不依赖任何网关。",
    checked: "检查时间", uploaded: "上传时间", block: "区块", stopped: "按需检查，不在后台持续轮询。",
  },
};

// Once the network is known, list only gateways that returned the ciphertext.
function shownGateways(data: StorageStatus) {
  if (data.network === "unknown") return data.gateways;
  const found = data.gateways.filter(({ state }) => state === "found");
  return found.length ? found : data.gateways.filter(({ url }) => url.includes("irys") === (data.network === "irys"));
}

// A new TxID mounts fresh state and aborts the previous request.
export function ArweaveSyncStatus({ txId }: { txId: string }) {
  return <StorageStatusPanel key={txId} txId={txId} />;
}

function StorageStatusPanel({ txId }: { txId: string }) {
  const locale = useLocale();
  const t = locale === "zh" ? copy.zh : copy.en;
  const [data, setData] = useState<StorageStatus | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    async function check() {
      try {
        const res = await fetch(`/api/arweave/status?txId=${encodeURIComponent(txId)}`, {
          cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]),
        });
        if (!res.ok) throw new Error("Status unavailable");
        const next = await res.json();
        if (next.version !== 3 || next.txId !== txId || !["arweave", "irys", "unknown"].includes(next.network) || !next.arweave || !next.turbo || !next.irys || !Array.isArray(next.gateways)) throw new Error("Invalid status response");
        if (active) { setData(next); setError(false); }
      } catch { if (active) setError(true); }
      finally { if (active) setLoading(false); }
    }
    void check();
    return () => { active = false; controller.abort(); };
  }, [txId, refresh]);
  const date = (timestamp: string | number) => new Date(timestamp).toLocaleString(locale === "zh" ? "zh-CN" : "en-US", { timeZoneName: "short" });
  return (
    <div className="mt-2 space-y-2 text-xs font-mono leading-relaxed" aria-live="polite" aria-busy={loading}>
      {loading && <p className="text-gray-500">{t.checking}</p>}
      {error && <p className="text-amber-700" role="status">{t.failed}</p>}
      {data && <>
        {data.network === "irys" ? (
          <p className="text-emerald-700">✓ {t.irysStored}
            {data.irys.uploadedAt !== null && <span className="block text-gray-500">{t.uploaded}: {date(data.irys.uploadedAt)}</span>}
          </p>
        ) : <>
          {data.network === "arweave" ? (
            <p className={data.arweave.blockHeight !== null ? "text-emerald-700" : "text-gray-700"}>
              {data.arweave.blockHeight !== null ? `✓ ${t.confirmed} · ${t.block} #${data.arweave.blockHeight.toLocaleString()}` : t.indexed}
            </p>
          ) : <>
            <p>{data.irys.state === "found" ? t.receipt : data.irys.state === "not_found" ? t.noReceipt : t.irysError}
              {data.irys.uploadedAt !== null && <span className="block text-gray-500">{t.uploaded}: {date(data.irys.uploadedAt)}</span>}
            </p>
            {data.arweave.state !== "not_applicable" && <p className="text-gray-700">{data.arweave.state === "not_found" ? t.notFound : t.indexError}</p>}
          </>}
        </>}
        <ul className="space-y-1">
          {shownGateways(data).map(({ url, state }) => <li key={url}>
            <a href={url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{new URL(url).hostname} ↗</a>
            <span className={state === "found" ? "text-emerald-700" : "text-gray-500"}> — {state === "found" ? t.available : state === "not_found" ? t.missing : t.unknown}</span>
          </li>)}
        </ul>
        <p className="text-gray-500">{t.checked}: {date(data.checkedAt)}</p>
        {data.network === "irys" && <p className="text-gray-600">{t.irysNote}</p>}
        {data.network === "unknown" && <p className="text-gray-600">{t.unknownNote}</p>}
      </>}
      <p className="text-gray-600">{t.backup}</p>
      <button type="button" disabled={loading} onClick={() => { setLoading(true); setError(false); setRefresh((value) => value + 1); }} className="rounded border border-gray-300 px-3 py-1 text-blue-600 disabled:opacity-50">{t.refresh}</button>
      <p className="text-gray-500">{t.stopped}</p>
    </div>
  );
}
