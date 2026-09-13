"use client";

import { useState, useEffect } from "react";
import { useLocale } from "next-intl";
import type { StorageStatus } from "@/lib/storage-status";

const copy = {
  en: {
    checking: "Checking storage evidence…", refresh: "Check again", failed: "Status check unavailable. This does not mean your ciphertext is lost.",
    receipt: "Irys upload record found", noReceipt: "No Irys upload record found in this check", irysError: "Irys index could not be checked",
    confirmed: "Arweave index reports block inclusion", indexed: "Arweave index found a record, but no confirmed block", notFound: "Arweave inclusion not verified: no record found in the checked index", indexError: "Arweave index could not be checked",
    available: "Gateway responded to availability check", missing: "Not found at this gateway", unknown: "Gateway check inconclusive",
    note: "New uploads use Irys. An Irys record or gateway response is not proof of Arweave inclusion. Waiting does not automatically migrate data to Arweave. No reliable completion estimate is available.",
    backup: "Keep the exported JSON (including ciphertext) and offline decryptor. Availability checks do not verify decryption or guarantee future storage.",
    checked: "Checked", uploaded: "Upload timestamp", block: "Block", stopped: "Checks run on demand; no background polling.",
  },
  zh: {
    checking: "正在核验存储状态…", refresh: "重新检查", failed: "状态查询暂不可用，不代表密文丢失。",
    receipt: "已查到 Irys 上传记录", noReceipt: "本次未查到 Irys 上传记录", irysError: "暂时无法查询 Irys 索引",
    confirmed: "Arweave 索引返回了确认区块", indexed: "Arweave 索引有记录，但尚未返回确认区块", notFound: "尚未验证 Arweave 收录：所查询索引未找到记录", indexError: "暂时无法查询 Arweave 索引",
    available: "网关可用性检查响应正常", missing: "该网关未找到数据", unknown: "该网关检查未得出结论",
    note: "当前新上传使用 Irys。Irys 记录或网关响应不等于 Arweave 收录证明，继续等待也不会自动将数据迁移到 Arweave。目前没有可靠的完成时间估计。",
    backup: "请保存包含密文的导出 JSON 和离线解密器。可用性检查不验证解密结果，也不保证未来存储可用性。",
    checked: "检查时间", uploaded: "上传时间", block: "区块", stopped: "按需检查，不在后台持续轮询。",
  },
};

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
        if (next.version !== 2 || next.txId !== txId || !next.arweave || !next.irys || !Array.isArray(next.gateways)) throw new Error("Invalid status response");
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
        <p>{data.irys.state === "found" ? t.receipt : data.irys.state === "not_found" ? t.noReceipt : t.irysError}
          {data.irys.uploadedAt !== null && <span className="block text-gray-500">{t.uploaded}: {date(data.irys.uploadedAt)}</span>}
        </p>
        <p className={data.arweave.blockHeight !== null ? "text-emerald-700" : "text-amber-700"}>
          {data.arweave.state === "found" ? data.arweave.blockHeight !== null ? `${t.confirmed} · ${t.block} #${data.arweave.blockHeight.toLocaleString()}` : t.indexed : data.arweave.state === "not_found" ? t.notFound : t.indexError}
        </p>
        <ul className="space-y-1">
          {data.gateways.map(({ url, state }) => <li key={url}>
            <a href={url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{new URL(url).hostname} ↗</a>
            <span className={state === "found" ? "text-emerald-700" : "text-gray-500"}> — {state === "found" ? t.available : state === "not_found" ? t.missing : t.unknown}</span>
          </li>)}
        </ul>
        <p className="text-gray-500">{t.checked}: {date(data.checkedAt)}</p>
      </>}
      <p className="text-gray-600">{t.note}</p>
      <p className="text-gray-600">{t.backup}</p>
      <button type="button" disabled={loading} onClick={() => { setLoading(true); setError(false); setRefresh((value) => value + 1); }} className="rounded border border-gray-300 px-3 py-1 text-blue-600 disabled:opacity-50">{t.refresh}</button>
      <p className="text-gray-500">{t.stopped}</p>
    </div>
  );
}
