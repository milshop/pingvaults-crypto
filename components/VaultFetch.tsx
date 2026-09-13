"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  decrypt,
  LANGUAGE_LABELS,
  type KeySelection,
  type Language,
  type KeyType,
} from "@/lib/crypto";
import type { LocalVaultMeta } from "@/components/VaultSave";
import type { KeySchemaItemSafe } from "@/components/VaultForm";
import { ArweaveSyncStatus } from "@/components/ArweaveSyncStatus";
import { isCiphertext } from "@/lib/storage-fetch";

const DEFAULT_VAULT_KEY = "pv_last_vault";

// ─── Decrypted content structure (v1) ────────────────────

interface DecryptedEntry {
  category: string;
  content: string;
  file?: {
    name: string;
    type: string;
    size: number;
    data: string; // base64
  };
}

interface DecryptedPayload {
  v: number;
  entries: DecryptedEntry[];
}

function parseDecryptedContent(raw: string): DecryptedPayload | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.v === 1 && Array.isArray(parsed.entries)) {
      return parsed as DecryptedPayload;
    }
  } catch {
    // Old format (plain text) — backward compatible
  }
  return null;
}

// ─── Decrypted content view ───────────────────────────────

function DecryptedView({ raw }: { raw: string }) {
  const t = useTranslations("VaultFetch");
  const [copied, setCopied] = useState<number | null>(null);
  const structured = parseDecryptedContent(raw);

  async function copyEntry(text: string, index: number) {
    await navigator.clipboard.writeText(text);
    setCopied(index);
    setTimeout(() => setCopied(null), 2000);
  }

  function downloadFile(file: { name: string; type: string; data: string }) {
    const blob = new Blob([Uint8Array.from(atob(file.data), c => c.charCodeAt(0))], { type: file.type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  if (!structured) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-emerald-600 font-mono font-medium">{t("decryptedLabel")}</span>
          <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-300">
            {t("plaintextBadge")}
          </Badge>
        </div>
        <pre className="text-sm whitespace-pre-wrap font-mono text-foreground leading-relaxed">
          {raw}
        </pre>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-emerald-600">{t("decryptedLabel")}</span>
        <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-300">
          {structured.entries.length}
        </Badge>
      </div>

      {structured.entries.map((entry, i) => (
        <div key={i} className="rounded-xl border border-border bg-muted/10 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 bg-muted/20 border-b border-border">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 flex items-center justify-center rounded-full bg-emerald-100 text-emerald-600 text-xs font-bold select-none">
                {i + 1}
              </span>
              <span className="text-sm font-medium text-foreground">{entry.category}</span>
            </div>
            <button
              type="button"
              onClick={() => copyEntry(entry.content, i)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-0.5 rounded border border-transparent hover:border-border"
            >
              {copied === i ? t("copiedEntry") : t("copyEntry")}
            </button>
          </div>
          <div className="px-4 py-3">
            <pre className="text-sm whitespace-pre-wrap font-mono text-foreground leading-relaxed break-all">
              {entry.content}
            </pre>
          </div>
          {entry.file && (
            <div className="px-4 pb-3">
              <div className="flex items-center justify-between p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-emerald-600">📎</span>
                  <div className="min-w-0">
                    <p className="text-xs font-mono text-emerald-700 truncate">{entry.file.name}</p>
                    <p className="text-xs font-mono text-emerald-600/60">{(entry.file.size / 1024).toFixed(1)} KB</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => downloadFile(entry.file!)}
                  className="text-xs font-mono text-emerald-600 hover:text-emerald-700 px-3 py-1.5 rounded border border-emerald-300 hover:bg-emerald-100 transition-colors"
                >
                  {t("downloadFile")}
                </button>
              </div>
            </div>
          )}
        </div>
      ))}

      <p className="text-xs text-muted-foreground font-mono text-center pt-1">
        {t("localNote")}
      </p>
    </div>
  );
}

// ─── FetchedVault type ────────────────────────────────────

interface FetchedVault {
  ciphertext: string;
  salt: string;
  iv: string;
  keySchema: KeySchemaItemSafe[];
  keyLanguage: Language;
  tx_id: string;
  arweave_url: string;
  updated_at?: string;
  source: "dynamodb" | "arweave_direct" | "local_backup";
}

// ─── VaultFetch main component ────────────────────────────

interface VaultFetchProps {
  vaultKey?: string;
}

export function VaultFetch({ vaultKey = DEFAULT_VAULT_KEY }: VaultFetchProps) {
  const t = useTranslations("VaultFetch");
  const kt = useTranslations("keyTypes");

  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [vault, setVault] = useState<FetchedVault | null>(null);

  const [answers, setAnswers] = useState<string[]>([]);
  const [decryptResult, setDecryptResult] = useState<string | null>(null);
  const [decryptError, setDecryptError] = useState<string | null>(null);
  const [decryptLoading, setDecryptLoading] = useState(false);

  async function handleFetch() {
    setLoading(true);
    setFetchError(null);
    setVault(null);
    setDecryptResult(null);
    setDecryptError(null);

    try {
      const localRaw = localStorage.getItem(vaultKey);

      if (localRaw) {
        const local: LocalVaultMeta = JSON.parse(localRaw);
        let ciphertext: string;
        let url = "";
        let source: FetchedVault["source"] = "arweave_direct";
        try {
          const response = await fetch(`/api/vault/fetch?txId=${encodeURIComponent(local.txId)}`, { signal: AbortSignal.timeout(28000), cache: "no-store" });
          const data = await response.json();
          if (!response.ok || !isCiphertext(data.ciphertext)) throw new Error(data.error ?? "Ciphertext download failed");
          ciphertext = data.ciphertext;
          url = data.storage_url ?? data.arweave_url;
        } catch (error) {
          if (!isCiphertext(local.ciphertext)) throw error;
          ciphertext = local.ciphertext;
          source = "local_backup";
        }

        setVault({
          ciphertext,
          salt: local.salt,
          iv: local.iv,
          keySchema: local.keySchema,
          keyLanguage: local.keyLanguage,
          tx_id: local.txId,
          arweave_url: url,
          source,
        });
        setAnswers(local.keySchema.map(() => ""));
        return;
      }

      const res = await fetch("/api/vault/fetch", { signal: AbortSignal.timeout(30000), cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? t("notFoundError"));

      setVault({
        ciphertext: data.ciphertext,
        salt: data.salt,
        iv: data.iv,
        keySchema: data.key_schema ?? [],
        keyLanguage: data.key_language ?? "en",
        tx_id: data.tx_id,
        arweave_url: data.arweave_url,
        updated_at: data.updated_at,
        source: "dynamodb",
      });
      setAnswers((data.key_schema ?? []).map(() => ""));
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function handleDecrypt(e: React.FormEvent) {
    e.preventDefault();
    if (!vault) return;
    setDecryptLoading(true);
    setDecryptError(null);
    setDecryptResult(null);

    try {
      const selections: KeySelection[] = vault.keySchema.map((item, i) => ({
        type: item.type as KeyType,
        question: item.question,
        value: answers[i] ?? "",
      }));

      const plaintext = await decrypt(
        { ciphertext: vault.ciphertext, salt: vault.salt, iv: vault.iv },
        selections,
        vault.keyLanguage
      );
      setDecryptResult(plaintext);
    } catch {
      setDecryptError(t("decryptError"));
    } finally {
      setDecryptLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("fetchDesc")}</p>
      <div className="flex flex-wrap gap-2">
        <TrustPill>{t("trustBadge1")}</TrustPill>
        <TrustPill>{t("trustBadge2")}</TrustPill>
        <TrustPill>{t("trustBadge3")}</TrustPill>
      </div>

      <Button variant="outline" onClick={handleFetch} disabled={loading} className="w-full">
        {loading ? t("fetching") : t("fetchButton")}
      </Button>

      {fetchError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 space-y-1.5">
          <p className="text-sm text-red-600 font-semibold">{t("fetchErrorTitle")}</p>
          <p className="text-xs text-red-600 font-mono leading-relaxed">{fetchError}</p>
          <ul className="space-y-1 text-[11px] text-gray-500">
            <li>{t("fetchHint1")}</li>
            <li>{t("fetchHint2")}</li>
            <li>{t("fetchHint3")}</li>
          </ul>
        </div>
      )}

      {vault && (
        <div className="space-y-4">
          {/* On-chain metadata */}
          <div className="rounded-xl border border-border bg-muted/5 p-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="text-xs">
                {t(vault.source === "dynamodb" ? "accountSource" : vault.source === "local_backup" ? "localSource" : "gatewaySource")}
              </Badge>
              {vault.updated_at && (
                <span className="text-xs text-muted-foreground">
                  {new Date(vault.updated_at).toLocaleString()}
                </span>
              )}
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground mb-0.5">{t("txLabel")}</p>
              <p className="font-mono text-xs text-emerald-600 break-all leading-relaxed">
                {vault.tx_id}
              </p>
              {vault.arweave_url && <a
                href={vault.arweave_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 hover:underline"
              >
                {new URL(vault.arweave_url).hostname} ↗
              </a>}
            </div>
            {vault.source === "local_backup" && <p className="text-xs text-amber-700">{t("localBackupWarning")}</p>}
            <ArweaveSyncStatus txId={vault.tx_id} />
          </div>

          {/* Passphrase arrangement hint */}
          {vault.keySchema.length > 0 && (
            <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-3 space-y-2">
              <p className="text-xs text-yellow-600 font-semibold">{t("schemaHintTitle")}</p>
              <div className="flex flex-wrap items-center gap-1.5">
                {vault.keySchema.map((item, i) => (
                  <span key={i} className="flex items-center gap-1">
                    {i > 0 && <span className="text-muted-foreground/50 text-xs">→</span>}
                    <span className="px-2 py-0.5 rounded-md bg-yellow-50 border border-yellow-200 text-xs text-yellow-600 font-mono">
                      {i + 1}. {kt(item.type as string)}
                    </span>
                  </span>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {LANGUAGE_LABELS[vault.keyLanguage]} · {t("schemaHintSuffix")}
              </p>
            </div>
          )}

          {/* Decrypt form */}
          {!decryptResult && (
            <form onSubmit={handleDecrypt} className="space-y-3">
              <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
                <p className="text-sm font-semibold text-gray-800">{t("decryptGuideTitle")}</p>
                <p className="text-xs text-gray-500 mt-1 leading-relaxed">{t("decryptGuideBody")}</p>
              </div>
              {vault.keySchema.map((item, i) => (
                <div key={i} className="space-y-1.5">
                  <Label className="text-xs text-yellow-600">
                    {i + 1}. {kt(item.type as string)}
                    {item.question && (
                      <span className="ml-1.5 text-muted-foreground font-normal italic">
                        「{item.question}」
                      </span>
                    )}
                  </Label>
                  <Input
                    type="password"
                    placeholder="..."
                    value={answers[i] ?? ""}
                    onChange={(e) => {
                      const next = [...answers];
                      next[i] = e.target.value;
                      setAnswers(next);
                    }}
                    className="font-mono"
                    autoComplete="off"
                  />
                </div>
              ))}

              <Button type="submit" className="w-full" disabled={decryptLoading}>
                {decryptLoading ? t("decrypting") : t("decryptButton")}
              </Button>

              {decryptError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 space-y-1.5">
                  <p className="text-sm text-red-600 font-semibold">{t("decryptErrorTitle")}</p>
                  <p className="text-xs text-red-600 font-mono leading-relaxed">{decryptError}</p>
                  <ul className="space-y-1 text-[11px] text-gray-500">
                    <li>{t("decryptHint1")}</li>
                    <li>{t("decryptHint2")}</li>
                    <li>{t("decryptHint3")}</li>
                  </ul>
                </div>
              )}
            </form>
          )}

          {/* Decrypt result */}
          {decryptResult && (
            <div className="space-y-3">
              <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 space-y-1.5">
                <p className="text-sm font-semibold text-blue-600">{t("recoverySuccessTitle")}</p>
                <p className="text-xs text-gray-500 leading-relaxed">{t("recoverySuccessBody")}</p>
              </div>
              <DecryptedView raw={decryptResult} />
              <button
                type="button"
                onClick={() => { setDecryptResult(null); setDecryptError(null); }}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-center"
              >
                ↺
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TrustPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[11px] font-mono text-blue-600">
      {children}
    </span>
  );
}
