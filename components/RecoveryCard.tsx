"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import qrcode from "qrcode-generator";
import { Button } from "@/components/ui/button";
import type { KeySchemaItemSafe } from "@/components/VaultForm";
import type { Language } from "@/lib/crypto";
import { trackEvent } from "@/lib/analytics";

export interface RecoveryCardData {
  txId: string;
  salt: string;
  iv: string;
  keySchema: KeySchemaItemSafe[];
  keyLanguage: Language;
}

/**
 * The card holds what the offline decryptor needs besides the answers:
 * the storage ID (ciphertext is fetched from Arweave), salt, IV and question order.
 * It never contains answers, keys or plaintext.
 */
export function recoveryCardText(data: RecoveryCardData): string {
  return JSON.stringify({
    v: 1,
    txId: data.txId,
    salt: data.salt,
    iv: data.iv,
    keySchema: data.keySchema.map(({ type, question }) => (question ? { type, question } : { type })),
    keyLanguage: data.keyLanguage,
  });
}

function qrSvg(text: string): string {
  const qr = qrcode(0, "M");
  // Byte mode with UTF-8 bytes, so question text in any language scans correctly.
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  qr.addData(binary, "Byte");
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const copy = {
  en: {
    title: "Recovery card",
    lead: "Print this card and keep it with your will. Your heir can open the vault with it even if this website is gone.",
    steps: ["Print the card", "Keep it with your will", "Your heir opens the offline decryptor and scans it", "They enter the answers and the vault opens"],
    arweave: "The encrypted vault is stored permanently on Arweave. The decryptor downloads it by itself.",
    questions: "Questions to answer, in order",
    noAnswers: "The card has no answers on it. The card alone cannot open the vault.",
    view: "View recovery card", print: "Print or save as PDF", close: "Close", copyText: "Copy card text", copied: "Copied",
    previewHint: "Check the card below. Printing opens your browser's print dialog, where you can also save it as a PDF.",
    printTitle: "PingVaults recovery card",
    howTitle: "How to recover",
    how: [
      "Open the offline decryptor: a saved copy, www.pingvaults.com/decrypt.html, or the offline folder at github.com/milshop/pingvaults-crypto.",
      "Scan the QR code with a phone and paste the text into “Have a recovery card?” at the top. If you can't scan it, type in the card text below.",
      "Enter the answers to the questions below, in order, and click Decrypt.",
    ],
    textLabel: "Card text (type this in if the QR code can't be scanned)",
    keep: "Keep this card with your will. It does not contain the answers.",
    created: "Created",
  },
  zh: {
    title: "恢复卡",
    lead: "把这张卡打印出来，和遗嘱放在一起。即使这个网站不在了，继承人也能用它打开金库。",
    steps: ["打印恢复卡", "和遗嘱放在一起", "继承人打开离线解密器，扫描卡片", "按顺序输入答案，金库打开"],
    arweave: "加密的金库永久保存在 Arweave 上，解密器会自动下载。",
    questions: "需要回答的问题（按顺序）",
    noAnswers: "卡上没有答案，只凭这张卡无法打开金库。",
    view: "查看恢复卡", print: "打印或存为 PDF", close: "关闭", copyText: "复制卡片文字", copied: "已复制",
    previewHint: "先确认下面的卡片内容。点击打印会打开浏览器的打印窗口，也可以在里面存为 PDF。",
    printTitle: "PingVaults 恢复卡",
    howTitle: "如何恢复",
    how: [
      "打开离线解密器：已保存的副本、www.pingvaults.com/decrypt-zh.html，或 github.com/milshop/pingvaults-crypto 的 offline 文件夹。",
      "用手机扫描二维码，把得到的文字粘贴到解密器顶部的「有恢复卡？」；扫不了码就照着下方的卡片文字输入。",
      "按顺序输入下列问题的答案，点「本地解密」。",
    ],
    textLabel: "卡片文字（二维码无法扫描时手动输入）",
    keep: "请把这张卡和遗嘱放在一起保管。卡上不含答案。",
    created: "生成日期",
  },
};

export function RecoveryCard({ data, compact = false }: { data: RecoveryCardData; compact?: boolean }) {
  const locale = useLocale();
  const t = locale === "zh" ? copy.zh : copy.en;
  const kt = useTranslations("keyTypes");
  const [copied, setCopied] = useState(false);
  const text = useMemo(() => recoveryCardText(data), [data]);
  const svg = useMemo(() => qrSvg(text), [text]);
  const questions = useMemo(
    () => data.keySchema.map((item) => (item.question ? `${kt(item.type)}${locale === "zh" ? "：" : ": "}${item.question}` : kt(item.type))),
    [data.keySchema, kt, locale],
  );

  const [open, setOpen] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const date = new Date().toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US");

  // The preview and the printout are the same document, so what the user checks is what prints.
  const cardHtml = useMemo(() => `<!doctype html><html lang="${locale === "zh" ? "zh-CN" : "en"}"><head><meta charset="utf-8"><title>${esc(t.printTitle)}</title>
<style>
@page{size:A4;margin:14mm}html,body{margin:0;background:#fff}body{font-family:-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#111;padding:12px}
.card{border:2px solid #111;border-radius:10px;padding:18px 20px;max-width:170mm;box-sizing:border-box}
h1{font-size:18px;margin:0 0 12px}.top{display:flex;gap:18px;align-items:flex-start}.qr{width:52mm;flex:none}.qr svg{width:100%;height:auto;display:block}
h2{font-size:13px;margin:0 0 6px}ol{margin:0 0 10px 18px;padding:0;font-size:12px;line-height:1.5}
.code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:10px;word-break:break-all;border:1px dashed #999;padding:8px;border-radius:6px;margin-top:6px}
.foot{font-size:11px;color:#444;margin-top:12px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
@media screen and (max-width:560px){.top{flex-direction:column}.qr{width:60%;margin:0 auto}}
@media screen{.card{margin:0 auto}}@media print{body{padding:0}}
</style></head><body><div class="card">
<h1>${esc(t.printTitle)}</h1>
<div class="top"><div class="qr">${svg}</div><div>
<h2>${esc(t.howTitle)}</h2><ol>${t.how.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
<h2>${esc(t.questions)}</h2><ol>${questions.map((q) => `<li>${esc(q)}</li>`).join("")}</ol>
</div></div>
<h2 style="margin-top:12px">${esc(t.textLabel)}</h2><div class="code">${esc(text)}</div>
<div class="foot"><span>${esc(t.keep)}</span><span>${esc(t.created)}: ${esc(date)}</span></div>
</div></body></html>`, [locale, t, svg, questions, text, date]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = overflow; };
  }, [open]);

  function viewCard() {
    setOpen(true);
    trackEvent("Recovery Card Viewed", { locale, compact });
  }

  function printCard() {
    const frame = frameRef.current?.contentWindow;
    if (!frame) return;
    frame.focus();
    frame.print();
    trackEvent("Recovery Card Printed", { locale, compact });
  }

  async function copyText() {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard blocked */ }
  }

  const actions = (
    <div className="flex flex-wrap gap-2">
      <Button type="button" onClick={viewCard}>{t.view}</Button>
      <Button type="button" variant="outline" onClick={copyText}>{copied ? t.copied : t.copyText}</Button>
    </div>
  );

  // Portal to <body> so no transformed or clipped ancestor can trap the overlay.
  const modal = open && createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-6" onClick={() => setOpen(false)}>
      <div role="dialog" aria-modal="true" aria-labelledby="recovery-card-dialog-title"
        className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-4 py-3">
          <div>
            <p id="recovery-card-dialog-title" className="text-sm font-semibold text-gray-900">{t.title}</p>
            <p className="mt-0.5 text-xs text-gray-500">{t.previewHint}</p>
          </div>
          <button type="button" aria-label={t.close} onClick={() => setOpen(false)} className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900">✕</button>
        </div>
        <iframe ref={frameRef} title={t.printTitle} srcDoc={cardHtml} className="w-full flex-none border-0 bg-white" style={{ height: "min(68vh, 720px)" }}
          onLoad={(e) => e.currentTarget.contentDocument?.addEventListener("keydown", (ev) => { if (ev.key === "Escape") setOpen(false); })} />
        <div className="flex flex-wrap justify-end gap-2 border-t border-gray-200 px-4 py-3">
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>{t.close}</Button>
          <Button type="button" onClick={printCard}>{t.print}</Button>
        </div>
      </div>
    </div>,
    document.body,
  );

  if (compact) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">{t.title}</p>
          <p className="text-xs text-gray-600 mt-1 leading-relaxed">{t.lead}</p>
        </div>
        {actions}
        {modal}
      </div>
    );
  }

  return (
    <section className="rounded-xl border border-emerald-200 bg-white p-4 md:p-5 space-y-4" aria-labelledby="recovery-card-title">
      <div>
        <h3 id="recovery-card-title" className="text-base font-semibold text-gray-900">{t.title}</h3>
        <p className="text-sm text-gray-600 mt-1 leading-relaxed">{t.lead}</p>
      </div>

      {/* Flow: owner prints and stores the card; heir scans it and answers. */}
      <ol className="grid gap-2 sm:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] sm:items-stretch">
        {t.steps.map((step, i) => (
          <li key={i} className="contents">
            {i > 0 && (
              <span aria-hidden className="flex items-center justify-center text-emerald-500 text-sm">
                <span className="sm:hidden">↓</span><span className="hidden sm:inline">→</span>
              </span>
            )}
            <div className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 ${i < 2 ? "border-emerald-200 bg-emerald-50" : "border-blue-200 bg-blue-50"}`}>
              <span className={`flex h-6 w-6 flex-none items-center justify-center rounded-full text-xs font-semibold text-white ${i < 2 ? "bg-emerald-600" : "bg-blue-600"}`}>{i + 1}</span>
              <span className="text-xs leading-snug text-gray-800">{step}</span>
            </div>
          </li>
        ))}
      </ol>
      <p className="text-xs text-gray-500">{t.arweave}</p>

      <div className="flex flex-col gap-4 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 sm:flex-row sm:items-center">
        <div className="mx-auto w-36 flex-none rounded bg-white p-1 sm:mx-0" dangerouslySetInnerHTML={{ __html: svg }} />
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-700">{t.questions}</p>
          <ol className="list-decimal pl-4 text-xs text-gray-700 space-y-0.5">
            {questions.map((q, i) => <li key={i}>{q}</li>)}
          </ol>
          <p className="text-xs text-gray-500">{t.noAnswers}</p>
        </div>
      </div>

      {actions}
      {modal}
    </section>
  );
}
