"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KEY_TYPE_LABELS, decrypt } from "@/lib/crypto";
import type { KeySelection } from "@/lib/crypto";
import type { VaultPayload, KeySchemaItemSafe } from "@/components/VaultForm";
import type { Language } from "@/lib/crypto";
import { PingConfig, PING_CONFIG_DEFAULTS } from "@/components/PingConfig";
import type { PingConfigData } from "@/components/PingConfig";
import { ArweaveSyncStatus } from "@/components/ArweaveSyncStatus";

const DEFAULT_VAULT_KEY = "pv_last_vault";

export interface LocalVaultMeta {
  txId: string;
  salt: string;
  iv: string;
  keySchema: KeySchemaItemSafe[];
  keyLanguage: Language;
  savedAt: string;
  ciphertext: string; // included so decryption works even if all gateways are down
}

interface VaultSaveProps {
  payload: VaultPayload;
  vaultKey?: string;
  onSaved: (txId: string, arweaveUrl: string) => void;
}

export function VaultSave({ payload, vaultKey = DEFAULT_VAULT_KEY, onSaved }: VaultSaveProps) {
  const t = useTranslations("VaultSave");
  const tPing = useTranslations("PingConfig");
  const kt = useTranslations("keyTypes");
  const locale = useLocale();
  const decryptorHref = locale === "zh" ? "/decrypt-zh.html" : "/decrypt.html";
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ txId: string; dbSaved: boolean; note?: string } | null>(null);
  const [pingEnabled, setPingEnabled] = useState(false);
  const [pingConfig, setPingConfig] = useState<PingConfigData>(PING_CONFIG_DEFAULTS);

  const canSave = !pingEnabled || pingConfig.emergencyEmail.trim().includes("@");

  async function handleSave() {
    if (!canSave) {
      setError("Please set an emergency contact email before saving.");
      return;
    }
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/vault/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ciphertext: payload.ciphertext,
          salt: payload.salt,
          iv: payload.iv,
          key_schema: payload.keySchema,
          key_language: payload.keyLanguage,
          ...(pingEnabled ? {
            emergency_email:    pingConfig.emergencyEmail.trim(),
            backup_email:       pingConfig.backupEmail.trim() || undefined,
            ping_initial_days:  pingConfig.initialDays,
            ping_interval_days: pingConfig.intervalDays,
            ping_max_count:     pingConfig.maxPings,
          } : {}),
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Save failed");

      const meta: LocalVaultMeta = {
        txId: data.tx_id,
        salt: payload.salt,
        iv: payload.iv,
        keySchema: payload.keySchema,
        keyLanguage: payload.keyLanguage,
        savedAt: new Date().toISOString(),
        ciphertext: payload.ciphertext,
      };
      localStorage.setItem(vaultKey, JSON.stringify(meta));

      setResult({ txId: data.tx_id, dbSaved: data.db_saved, note: data.note });
      onSaved(data.tx_id, data.arweave_url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  function exportMeta() {
    const raw = localStorage.getItem(vaultKey);
    if (!raw) return;
    const blob = new Blob([raw], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pingvaults-meta-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (result) {
    const savedAt = new Date().toLocaleString();
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Badge className="bg-green-900/50 text-green-300 border-green-700">
            {t("savedBadge")}
          </Badge>
          {result.dbSaved
            ? <Badge variant="outline" className="text-blue-400 border-blue-800 text-xs">{t("dbBadge")}</Badge>
            : <Badge variant="outline" className="text-yellow-400 border-yellow-800 text-xs">{t("arweaveOnlyBadge")}</Badge>
          }
        </div>

        {/* Dry Run Verifier */}
        <DryRunVerifier payload={payload} />

        {/* TxID + Arweave sync status */}
        <div className="rounded-lg border border-green-900/30 bg-green-950/20 p-3 space-y-1">
          <p className="text-xs text-muted-foreground">{t("txLabel")}</p>
          <p className="font-mono text-xs text-green-400 break-all">{result.txId}</p>
          <a
            href={`https://gateway.irys.xyz/${result.txId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-400 hover:underline"
          >
            {t("irysLink")}
          </a>
          <ArweaveSyncStatus txId={result.txId} />
        </div>

        {result.note && (
          <p className="text-xs text-yellow-400 font-mono bg-yellow-950/20 border border-yellow-900/30 rounded px-3 py-2">
            {result.note}
          </p>
        )}

        {/* Backup section */}
        <div className="rounded-lg border border-orange-900/50 bg-orange-950/15 p-4 space-y-3">
          <div>
            <p className="text-sm font-semibold text-orange-300">{t("backupTitle")}</p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{t("backupBody")}</p>
          </div>

          <MetaPreview txId={result.txId} payload={payload} savedAt={savedAt} kt={kt} t={t} />

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full border-orange-800/50 text-orange-400 hover:bg-orange-950/30"
            onClick={exportMeta}
          >
            {t("downloadButton")}
          </Button>

          <p className="text-xs text-muted-foreground text-center">
            {t.rich("offlineNote", {
              link: (chunks) => (
                <a href={decryptorHref} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                  {chunks}
                </a>
              ),
            })}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">{t("uploadDesc")}</p>

      {/* ── Dead Man's Switch toggle ── */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 overflow-hidden">
        <button
          type="button"
          onClick={() => setPingEnabled((v) => !v)}
          className="w-full flex items-center justify-between px-5 py-4 hover:bg-zinc-800/30 transition-colors"
        >
          <div className="flex items-center gap-3">
            <span className="text-base">📡</span>
            <div className="text-left">
              <p className="text-sm font-semibold text-zinc-100">{t("pingToggleTitle")}</p>
              <p className="text-xs text-zinc-500 mt-0.5">{t("pingToggleSub")}</p>
            </div>
          </div>
          <span className={`font-mono text-xs px-2.5 py-1 rounded-full border transition-colors ${
            pingEnabled
              ? "bg-green-900/40 border-green-700 text-green-400"
              : "bg-zinc-800/50 border-zinc-700 text-zinc-500"
          }`}>
            {pingEnabled ? t("pingToggleOn") : t("pingToggleOff")}
          </span>
        </button>

        {pingEnabled && (
          <div className="border-t border-zinc-800/60 p-5">
            <PingConfig value={pingConfig} onChange={setPingConfig} />
          </div>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-400 font-mono bg-red-950/30 border border-red-900/40 rounded px-3 py-2">
          {error}
        </p>
      )}

      <Button
        onClick={handleSave}
        disabled={loading || !canSave}
        className="w-full"
        title={!canSave ? "Set an emergency contact email first" : undefined}
      >
        {loading ? (
          <span className="flex items-center gap-2">
            <span className="animate-spin inline-block">⟳</span>
            {t("saving")}
          </span>
        ) : !canSave ? (
          tPing("saveDisabled")
        ) : (
          t("saveButton")
        )}
      </Button>
      <p className="text-xs text-muted-foreground font-mono">{t("zeroKnowledgeNote")}</p>
    </div>
  );
}

// ─── Dry Run Verifier ─────────────────────────────────────

interface DryRunVerifierProps {
  payload: VaultPayload;
}

function DryRunVerifier({ payload }: DryRunVerifierProps) {
  const t = useTranslations("VaultSave");
  const kt = useTranslations("keyTypes");
  const [answers, setAnswers] = useState<string[]>(payload.keySchema.map(() => ""));
  const [status, setStatus] = useState<"idle" | "running" | "ok" | "fail">("idle");
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const schemaLabels = payload.keySchema.map((item) => ({
    label: kt(item.type as keyof typeof KEY_TYPE_LABELS),
    question: item.question,
  }));

  async function runDryRun() {
    setStatus("running");
    try {
      const selections: KeySelection[] = payload.keySchema.map((item, i) => ({
        type: item.type as KeySelection["type"],
        question: item.question,
        value: answers[i],
      }));
      await decrypt(
        { ciphertext: payload.ciphertext, salt: payload.salt, iv: payload.iv },
        selections,
        payload.keyLanguage
      );
      setStatus("ok");
    } catch {
      setStatus("fail");
    }
  }

  return (
    <div className={`rounded-lg border p-4 space-y-3 ${
      status === "ok"
        ? "border-green-800/50 bg-green-950/15"
        : status === "fail"
        ? "border-red-800/50 bg-red-950/15"
        : "border-blue-900/40 bg-blue-950/10"
    }`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className={`text-sm font-semibold ${
            status === "ok" ? "text-green-300" : status === "fail" ? "text-red-300" : "text-blue-300"
          }`}>
            {status === "ok" ? t("dryRunTitleOk")
              : status === "fail" ? t("dryRunTitleFail")
              : t("dryRunTitle")}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {status === "ok" ? t("dryRunBodyOk")
              : status === "fail" ? t("dryRunBodyFail")
              : t("dryRunBodyDefault")}
          </p>
        </div>
        {status !== "running" && status !== "ok" && (
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="text-xs text-muted-foreground hover:text-foreground shrink-0"
          >
            {t("dryRunSkip")}
          </button>
        )}
      </div>

      {status !== "ok" && (
        <div className="space-y-2">
          {schemaLabels.map((item, i) => (
            <div key={i} className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                {i + 1}. {item.label}
                {item.question && (
                  <span className="ml-1 italic text-muted-foreground/70">「{item.question}」</span>
                )}
              </Label>
              <Input
                type="password"
                placeholder={t("dryRunPlaceholder")}
                value={answers[i]}
                onChange={(e) => {
                  const next = [...answers];
                  next[i] = e.target.value;
                  setAnswers(next);
                  if (status === "fail") setStatus("idle");
                }}
                className={`text-sm font-mono ${status === "fail" ? "border-red-700" : ""}`}
                autoComplete="off"
              />
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            className="w-full"
            disabled={status === "running" || answers.some((a) => !a.trim())}
            onClick={runDryRun}
          >
            {status === "running" ? (
              <span className="flex items-center gap-2">
                <span className="animate-spin inline-block">⟳</span>
                {t("dryRunVerifying")}
              </span>
            ) : (
              t("dryRunVerify")
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Metadata Preview ─────────────────────────────────────

interface MetaPreviewProps {
  txId: string;
  payload: VaultPayload;
  savedAt: string;
  kt: ReturnType<typeof useTranslations>;
  t: ReturnType<typeof useTranslations>;
}

function MetaPreview({ txId, payload, savedAt, kt, t }: MetaPreviewProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const meta = {
    txId,
    salt: payload.salt,
    iv: payload.iv,
    keySchema: payload.keySchema,
    keyLanguage: payload.keyLanguage,
    savedAt,
    ciphertext: payload.ciphertext,
  };
  const jsonStr = JSON.stringify(meta, null, 2);

  async function copyJson() {
    await navigator.clipboard.writeText(jsonStr);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="rounded-md border border-orange-900/30 bg-black/30 overflow-hidden">
      <div className="px-3 py-2.5 space-y-1.5">
        <div className="flex items-center justify-between">
          <p className="text-xs font-mono text-orange-400/80">{t("metaSchemaLabel")}</p>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {expanded ? t("collapseJson") : t("expandJson")}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {payload.keySchema.map((item, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span className="text-muted-foreground/40 text-xs">→</span>}
              <span className="px-1.5 py-0.5 rounded bg-orange-950/30 border border-orange-900/30 text-xs font-mono text-orange-300">
                {i + 1}. {kt(item.type as string)}
              </span>
            </span>
          ))}
        </div>
        <p className="text-[10px] font-mono text-muted-foreground">
          TxID: <span className="text-green-500">{txId.slice(0, 20)}…</span>
          {" · "}Salt: <span className="text-blue-400">{payload.salt.slice(0, 8)}…</span>
          {" · "}IV: <span className="text-blue-400">{payload.iv.slice(0, 8)}…</span>
        </p>
      </div>

      {expanded && (
        <div className="border-t border-orange-900/30">
          <div className="flex items-center justify-between px-3 py-1.5 bg-orange-950/10">
            <span className="text-[10px] text-muted-foreground font-mono">{t("fullMetaJson")}</span>
            <button
              type="button"
              onClick={copyJson}
              className="text-[10px] text-orange-400 hover:text-orange-200 transition-colors"
            >
              {copied ? t("copied") : t("copy")}
            </button>
          </div>
          <pre className="text-[10px] font-mono text-orange-300/80 p-3 overflow-x-auto leading-relaxed">
            {jsonStr}
          </pre>
        </div>
      )}
    </div>
  );
}
