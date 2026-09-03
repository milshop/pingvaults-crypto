"use client";

import { useMemo, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KEY_TYPE_LABELS, decrypt } from "@/lib/crypto";
import type { KeySelection } from "@/lib/crypto";
import type { VaultPayload, KeySchemaItemSafe } from "@/components/VaultForm";
import type { Language } from "@/lib/crypto";
import {
  PingConfig,
  PING_CONFIG_DEFAULTS,
} from "@/components/PingConfig";
import type { PingConfigData } from "@/components/PingConfig";
import { ArweaveSyncStatus } from "@/components/ArweaveSyncStatus";
import type { UserPlan } from "@/lib/plans";
import { trackEvent } from "@/lib/analytics";

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
  mode?: "create" | "edit";
  initialPingConfig?: PingConfigData | null;
  userPlan?: UserPlan;
  onSaved?: (txId: string, arweaveUrl: string) => void;
  onDone?: () => void;
  onBack?: () => void;
}

export function VaultSave({
  payload,
  vaultKey = DEFAULT_VAULT_KEY,
  mode = "create",
  initialPingConfig = null,
  userPlan = "free",
  onSaved,
  onDone,
  onBack,
}: VaultSaveProps) {
  const t = useTranslations("VaultSave");
  const tPing = useTranslations("PingConfig");
  const kt = useTranslations("keyTypes");
  const locale = useLocale();
  const decryptorHref = locale === "zh" ? "/decrypt-zh.html" : "/decrypt.html";
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ txId: string; dbSaved: boolean; note?: string } | null>(null);
  const [pingEnabled, setPingEnabled] = useState(Boolean(initialPingConfig?.emergencyEmail));
  const [pingConfig, setPingConfig] = useState<PingConfigData>(initialPingConfig ?? PING_CONFIG_DEFAULTS);
  const [drillPassedAt, setDrillPassedAt] = useState<string | null>(null);

  const canSave = !pingEnabled || pingConfig.emergencyEmail.trim().includes("@");
  const summaryCategories = payload.summary?.categories ?? [];
  const summaryCount = payload.summary?.entryCount ?? 0;
  const displayLanguage = payload.keyLanguage.toUpperCase();
  const keyOrder = payload.keySchema.map((item) => ({
    ...item,
    label: kt(item.type as keyof typeof KEY_TYPE_LABELS),
  }));
  const compactMeta = useMemo(() => ({
    salt: `${payload.salt.slice(0, 8)}...${payload.salt.slice(-6)}`,
    iv: `${payload.iv.slice(0, 8)}...${payload.iv.slice(-6)}`,
  }), [payload.iv, payload.salt]);

  async function handleSave() {
    if (!canSave) {
      setError(t("confirmErrorMissingContact"));
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
      trackEvent("Vault Saved", {
        locale,
        plan: userPlan,
        mode,
        ping_enabled: pingEnabled,
        arweave_only: !data.db_saved,
      });
      if (pingEnabled) {
        trackEvent("Ping Enabled", { locale, plan: userPlan, mode });
      }
      onSaved?.(data.tx_id, data.arweave_url);
    } catch (err) {
      trackEvent("Vault Save Failed", { locale, plan: userPlan, mode });
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
    trackEvent("Vault Metadata Exported", { locale, plan: userPlan, mode });
  }

  if (result) {
    const savedAt = new Date().toLocaleString();
    return (
      <div className="space-y-5">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 md:p-5 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="bg-emerald-100 text-emerald-600 border-emerald-300">
                  {mode === "edit" ? t("updatedBadge") : t("savedBadge")}
                </Badge>
                {result.dbSaved ? (
                  <Badge variant="outline" className="text-blue-600 border-blue-200 text-xs">{t("dbBadge")}</Badge>
                ) : (
                  <Badge variant="outline" className="text-yellow-600 border-yellow-200 text-xs">{t("arweaveOnlyBadge")}</Badge>
                )}
                {pingEnabled && (
                  <Badge variant="outline" className="text-purple-600 border-purple-200 text-xs">
                    {t("pingEnabledBadge")}
                  </Badge>
                )}
              </div>
              <div>
                <p className="text-base font-semibold text-gray-900">{mode === "edit" ? t("updatedTitle") : t("savedTitle")}</p>
                <p className="text-sm text-gray-500 leading-relaxed">{t("savedSummary")}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:min-w-[220px]">
              <SummaryChip label={t("resultEntries")} value={String(summaryCount)} />
              <SummaryChip label={t("resultLanguage")} value={displayLanguage} />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
              <p className="text-[11px] font-mono text-gray-500">{t("txLabel")}</p>
              <p className="font-mono text-xs text-emerald-600 break-all leading-relaxed">{result.txId}</p>
              <div className="flex flex-wrap gap-3 text-xs">
                <a
                  href={`https://gateway.irys.xyz/${result.txId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  {t("irysLink")}
                </a>
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(result.txId)}
                  className="text-gray-500 hover:text-gray-900 transition-colors"
                >
                  {t("copyTxId")}
                </button>
              </div>
              <ArweaveSyncStatus txId={result.txId} />
            </div>

            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
              <p className="text-[11px] font-mono text-gray-500">{t("resultChecklistTitle")}</p>
              <ul className="space-y-1.5 text-xs text-gray-500">
                <li>{t("resultChecklist1")}</li>
                <li>{t("resultChecklist2")}</li>
                <li>{t("resultChecklist3")}</li>
              </ul>
              {drillPassedAt && (
                <p className="text-[11px] text-emerald-600 font-mono">
                  {t("lastQuickDrill", { time: drillPassedAt })}
                </p>
              )}
            </div>
          </div>
        </div>

        <DryRunVerifier
          payload={payload}
          onSuccess={() => {
            setDrillPassedAt(new Date().toLocaleString());
            trackEvent("Recovery Drill Passed", { locale, plan: userPlan, mode });
          }}
        />

        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 space-y-3">
          <div>
            <p className="text-sm font-semibold text-blue-600">{t("fullDrillTitle")}</p>
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">{t("fullDrillBody")}</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              type="button"
              variant="outline"
              className="border-blue-200 text-blue-600 hover:bg-blue-50"
              onClick={exportMeta}
            >
              {t("downloadButton")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="border-blue-200 text-blue-600 hover:bg-blue-50"
              onClick={() => {
                trackEvent("Offline Decryptor Opened", { location: "save_success", locale });
                window.open(decryptorHref, "_blank", "noopener,noreferrer");
              }}
            >
              {t("openDecryptor")}
            </Button>
          </div>
          <p className="text-[11px] text-gray-500">{t("fullDrillHint")}</p>
        </div>

        {result.note && (
          <p className="text-xs text-yellow-600 font-mono bg-yellow-50 border border-yellow-200 rounded px-3 py-2">
            {result.note}
          </p>
        )}

        <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 space-y-3">
          <div>
            <p className="text-sm font-semibold text-orange-600">{t("backupTitle")}</p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{t("backupBody")}</p>
          </div>

          <MetaPreview txId={result.txId} payload={payload} savedAt={savedAt} kt={kt} t={t} />

          <p className="text-xs text-muted-foreground text-center">
            {t.rich("offlineNote", {
              link: (chunks) => (
                <a href={decryptorHref} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                  {chunks}
                </a>
              ),
            })}
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="button" className="flex-1" onClick={() => onDone?.()}>
            {mode === "edit" ? t("backToDashboardUpdated") : t("backToDashboardSaved")}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={exportMeta}
          >
            {t("downloadButton")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 md:p-5 space-y-4">
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <TrustPill>{t("trustLocal")}</TrustPill>
            <TrustPill>{t("trustNoAnswers")}</TrustPill>
            <TrustPill>{t("trustSingleVault")}</TrustPill>
          </div>
          <div>
            <p className="text-base font-semibold text-gray-900">{t("confirmTitle")}</p>
            <p className="text-sm text-gray-500 leading-relaxed">{t("uploadDesc")}</p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <SummaryCard label={t("confirmEntries")} value={String(summaryCount)} />
          <SummaryCard label={t("confirmLanguage")} value={displayLanguage} />
          <SummaryCard label={t("confirmSalt")} value={compactMeta.salt} />
          <SummaryCard label={t("confirmIv")} value={compactMeta.iv} />
        </div>

        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-semibold text-gray-800">{t("confirmCategories")}</p>
            <p className="text-xs text-gray-500 font-mono">{t("zeroKnowledgeNote")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {summaryCategories.map((category) => (
              <span
                key={category}
                className="rounded-full border border-gray-200 bg-gray-100 px-3 py-1 text-xs text-gray-700"
              >
                {category}
              </span>
            ))}
            {summaryCategories.length === 0 && (
              <span className="text-xs text-gray-500">{t("confirmNoCategory")}</span>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
          <p className="text-sm font-semibold text-gray-800">{t("confirmKeyOrder")}</p>
          <div className="flex flex-wrap items-center gap-2">
            {keyOrder.map((item, index) => (
              <span key={`${item.type}-${index}`} className="flex items-center gap-2">
                {index > 0 && <span className="text-gray-300">→</span>}
                <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-600">
                  {index + 1}. {item.label}
                </span>
                {item.question && (
                  <span className="text-[11px] text-gray-500">&quot;{item.question}&quot;</span>
                )}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-gray-100 overflow-hidden">
        <button
          type="button"
          onClick={() => setPingEnabled((v) => !v)}
          className="w-full flex flex-col items-start gap-3 px-5 py-4 hover:bg-gray-100 transition-colors sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-center gap-3">
            <span className="text-base">📡</span>
            <div className="text-left">
              <p className="text-sm font-semibold text-gray-900">{t("pingToggleTitle")}</p>
              <p className="text-xs text-gray-500 mt-0.5">{t("pingToggleSub")}</p>
            </div>
          </div>
          <span className={`font-mono text-xs px-2.5 py-1 rounded-full border transition-colors ${
            pingEnabled
              ? "bg-emerald-100 border-emerald-300 text-emerald-600"
              : "bg-gray-100 border-gray-300 text-gray-500"
          }`}>
            {pingEnabled ? t("pingToggleOn") : t("pingToggleOff")}
          </span>
        </button>

        {pingEnabled && (
          <div className="border-t border-gray-200 p-5">
            <PingConfig value={pingConfig} onChange={setPingConfig} userPlan={userPlan} />
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 space-y-1">
          <p className="text-sm text-red-600 font-semibold">{t("confirmErrorTitle")}</p>
          <p className="text-xs text-red-600/90 font-mono leading-relaxed">{error}</p>
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="button" variant="outline" className="flex-1" onClick={() => onBack?.()}>
          {t("backToModify")}
        </Button>
        <Button
          onClick={handleSave}
          disabled={loading || !canSave}
          className="flex-1"
          title={!canSave ? t("confirmErrorMissingContact") : undefined}
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <span className="animate-spin inline-block">⟳</span>
              {t("saving")}
            </span>
          ) : !canSave ? (
            tPing("saveDisabled")
          ) : (
            t("confirmSaveButton")
          )}
        </Button>
      </div>
    </div>
  );
}

// ─── Dry Run Verifier ─────────────────────────────────────

interface DryRunVerifierProps {
  payload: VaultPayload;
  onSuccess?: () => void;
}

function DryRunVerifier({ payload, onSuccess }: DryRunVerifierProps) {
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
      onSuccess?.();
    } catch {
      setStatus("fail");
    }
  }

  return (
    <div className={`rounded-lg border p-4 space-y-3 ${
      status === "ok"
        ? "border-emerald-200 bg-emerald-50"
        : status === "fail"
        ? "border-red-200 bg-red-50"
        : "border-blue-200 bg-blue-50"
    }`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className={`text-sm font-semibold ${
            status === "ok" ? "text-emerald-600" : status === "fail" ? "text-red-600" : "text-blue-600"
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
          {status === "fail" && (
            <ul className="mt-2 space-y-1 text-[11px] text-gray-500">
              <li>{t("dryRunHint1")}</li>
              <li>{t("dryRunHint2")}</li>
              <li>{t("dryRunHint3")}</li>
            </ul>
          )}
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
                className={`text-sm font-mono ${status === "fail" ? "border-red-300" : ""}`}
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
    <div className="rounded-md border border-orange-200 bg-orange-50 overflow-hidden">
      <div className="px-3 py-2.5 space-y-1.5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs font-mono text-orange-600/80">{t("metaSchemaLabel")}</p>
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
              <span className="px-1.5 py-0.5 rounded bg-orange-50 border border-orange-200 text-xs font-mono text-orange-600">
                {i + 1}. {kt(item.type as string)}
              </span>
            </span>
          ))}
        </div>
        <p className="text-[10px] font-mono text-muted-foreground">
          TxID: <span className="text-emerald-500 break-all">{txId.slice(0, 20)}…</span>
          {" · "}Salt: <span className="text-blue-600">{payload.salt.slice(0, 8)}…</span>
          {" · "}IV: <span className="text-blue-600">{payload.iv.slice(0, 8)}…</span>
        </p>
      </div>

      {expanded && (
        <div className="border-t border-orange-200">
          <div className="flex items-center justify-between px-3 py-1.5 bg-orange-50">
            <span className="text-[10px] text-muted-foreground font-mono">{t("fullMetaJson")}</span>
            <button
              type="button"
              onClick={copyJson}
              className="text-[10px] text-orange-600 hover:text-orange-800 transition-colors"
            >
              {copied ? t("copied") : t("copy")}
            </button>
          </div>
          <pre className="text-[10px] font-mono text-orange-600/80 p-3 overflow-x-auto leading-relaxed">
            {jsonStr}
          </pre>
        </div>
      )}
    </div>
  );
}

function SummaryChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
      <p className="text-[11px] text-gray-400 font-mono">{label}</p>
      <p className="text-sm text-gray-800 font-mono mt-1">{value}</p>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-3">
      <p className="text-[11px] text-gray-400 font-mono">{label}</p>
      <p className="text-sm text-gray-800 font-mono mt-1 break-all">{value}</p>
    </div>
  );
}

function TrustPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-mono text-emerald-600">
      {children}
    </span>
  );
}
