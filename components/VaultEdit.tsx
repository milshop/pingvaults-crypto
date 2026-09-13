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
import type { KeySchemaItemSafe, AssetEntry, VaultPayload } from "@/components/VaultForm";
import { VaultForm } from "@/components/VaultForm";
import { CryptoResult } from "@/components/CryptoResult";
import { TransparencyPanel } from "@/components/TransparencyPanel";
import { VaultSave } from "@/components/VaultSave";
import type { PingConfigData } from "@/components/PingConfig";
import type { UserPlan } from "@/lib/plans";

const DEFAULT_VAULT_KEY = "pv_last_vault";

// ─── Types ────────────────────────────────────────────────

interface FetchedVault {
  ciphertext: string;
  salt: string;
  iv: string;
  keySchema: KeySchemaItemSafe[];
  keyLanguage: Language;
  tx_id: string;
  arweave_url: string;
}

type Phase =
  | { step: "idle" }
  | { step: "fetching" }
  | { step: "fetch-error"; message: string }
  | {
      step: "decrypt";
      vault: FetchedVault;
      pingConfig: PingConfigData | null;
      answers: string[];
      decryptError: string | null;
      decrypting: boolean;
    }
  | {
      step: "editing";
      vault: FetchedVault;
      pingConfig: PingConfigData | null;
      initialEntries: AssetEntry[];
      initialSelections: KeySelection[];
      initialLanguage: Language;
    }
  | {
      step: "saving";
      payload: VaultPayload;
      vault: FetchedVault;
      pingConfig: PingConfigData | null;
      draftEntries: AssetEntry[];
      draftSelections: KeySelection[];
      draftLanguage: Language;
    };

// ─── Helpers ──────────────────────────────────────────────

function parseEntries(raw: string): AssetEntry[] {
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.v === 1 && Array.isArray(parsed.entries)) {
      return parsed.entries.map(
        (e: { category: string; content: string }, i: number) => ({
          id: String(Date.now() + i),
          category: e.category,
          content: e.content,
        })
      );
    }
  } catch {
    // old plain-text format
    return [{ id: String(Date.now()), category: "Other", content: raw }];
  }
  return [];
}

// ─── VaultEdit ────────────────────────────────────────────

interface VaultEditProps {
  vaultKey?: string;
  userPlan?: UserPlan;
  onSaved?: () => void;
}

export function VaultEdit({ vaultKey = DEFAULT_VAULT_KEY, userPlan = "free", onSaved }: VaultEditProps) {
  const t  = useTranslations("VaultEdit");
  const kt = useTranslations("keyTypes");

  const [phase, setPhase] = useState<Phase>({ step: "idle" });

  // ── Phase 1: fetch vault ──────────────────────────────
  async function handleFetch() {
    setPhase({ step: "fetching" });
    try {
      const localRaw = localStorage.getItem(vaultKey);
      let vault: FetchedVault;
      let pingConfig: PingConfigData | null = null;

      if (localRaw) {
        const local: LocalVaultMeta = JSON.parse(localRaw);
        const res  = await fetch(`/api/vault/fetch?txId=${encodeURIComponent(local.txId)}`, { cache: "no-store", signal: AbortSignal.timeout(28000) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Ciphertext retrieval failed");
        vault = {
          ciphertext:  data.ciphertext,
          salt:        local.salt,
          iv:          local.iv,
          keySchema:   local.keySchema,
          keyLanguage: local.keyLanguage,
          tx_id:       local.txId,
          arweave_url: data.arweave_url,
        };
      } else {
        const res  = await fetch("/api/vault/fetch", { cache: "no-store", signal: AbortSignal.timeout(30000) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? t("notFoundError"));
        vault = {
          ciphertext:  data.ciphertext,
          salt:        data.salt,
          iv:          data.iv,
          keySchema:   data.key_schema ?? [],
          keyLanguage: data.key_language ?? "en",
          tx_id:       data.tx_id,
          arweave_url: data.arweave_url,
        };
      }

      try {
        const pingRes = await fetch("/api/ping/config");
        const pingData = await pingRes.json();
        if (pingRes.ok && pingData.hasVault && pingData.emergencyEmail) {
          pingConfig = {
            emergencyEmail: pingData.emergencyEmail ?? "",
            backupEmail: pingData.backupEmail ?? "",
            initialDays: pingData.initialDays ?? 90,
            intervalDays: pingData.intervalDays ?? 7,
            maxPings: pingData.maxPings ?? 3,
          };
        }
      } catch {
        // ignore ping preload failures
      }

      setPhase({
        step: "decrypt",
        vault,
        pingConfig,
        answers: (vault.keySchema ?? []).map(() => ""),
        decryptError: null,
        decrypting: false,
      });
    } catch (err) {
      setPhase({ step: "fetch-error", message: err instanceof Error ? err.message : "Unknown error" });
    }
  }

  // ── Phase 2: decrypt ─────────────────────────────────
  async function handleDecrypt(vault: FetchedVault, answers: string[]) {
    setPhase((prev) => prev.step === "decrypt" ? { ...prev, decrypting: true, decryptError: null } : prev);
    try {
      const selections: KeySelection[] = vault.keySchema.map((item, i) => ({
        type:     item.type as KeyType,
        question: item.question,
        value:    answers[i] ?? "",
      }));

      const plaintext = await decrypt(
        { ciphertext: vault.ciphertext, salt: vault.salt, iv: vault.iv },
        selections,
        vault.keyLanguage
      );

      const initialEntries    = parseEntries(plaintext);
      const initialSelections: KeySelection[] = vault.keySchema.map((item) => ({
        type:     item.type as KeyType,
        question: item.question,
        value:    "",
      }));

      setPhase({
        step: "editing",
        vault,
        pingConfig: phase.step === "decrypt" ? phase.pingConfig : null,
        initialEntries,
        initialSelections,
        initialLanguage: vault.keyLanguage,
      });
    } catch {
      setPhase((prev) =>
        prev.step === "decrypt"
          ? { ...prev, decrypting: false, decryptError: t("decryptError") }
          : prev
      );
    }
  }

  // ── Render ────────────────────────────────────────────

  if (phase.step === "idle" || phase.step === "fetch-error") {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("fetchDesc")}</p>
        <Button variant="outline" onClick={handleFetch} className="w-full">
          {t("fetchButton")}
        </Button>
        {phase.step === "fetch-error" && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 space-y-1.5">
            <p className="text-sm text-red-600 font-semibold">{t("fetchErrorTitle")}</p>
            <p className="text-xs text-red-600 font-mono leading-relaxed">{phase.message}</p>
            <p className="text-[11px] text-gray-500">{t("fetchErrorHint")}</p>
          </div>
        )}
      </div>
    );
  }

  if (phase.step === "fetching") {
    return (
      <p className="text-sm text-muted-foreground animate-pulse font-mono">{t("fetching")}</p>
    );
  }

  if (phase.step === "decrypt") {
    const { vault, answers, decryptError, decrypting } = phase;
    return (
      <div className="space-y-4">
        {/* Schema hint */}
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
              {LANGUAGE_LABELS[vault.keyLanguage]}
            </p>
          </div>
        )}

        {/* Answers form */}
        <form
          onSubmit={(e) => { e.preventDefault(); handleDecrypt(vault, answers); }}
          className="space-y-3"
        >
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
                  setPhase((prev) =>
                    prev.step === "decrypt" ? { ...prev, answers: next, decryptError: null } : prev
                  );
                }}
                className="font-mono"
                autoComplete="off"
              />
            </div>
          ))}

          <Button type="submit" className="w-full" disabled={decrypting}>
            {decrypting ? t("decrypting") : t("decryptButton")}
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

        <button
          type="button"
          onClick={() => setPhase({ step: "idle" })}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-center"
        >
          ← {t("back")}
        </button>
      </div>
    );
  }

  if (phase.step === "editing") {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-800">{t("editTitle")}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{t("editDesc")}</p>
          </div>
          <Badge variant="outline" className="text-emerald-600 border-emerald-300 text-xs">
            {t("decryptedBadge")}
          </Badge>
        </div>

        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
          <p className="text-xs text-blue-600 font-mono">{t("editNote")}</p>
        </div>

        <VaultForm
          initialEntries={phase.initialEntries}
          initialSelections={phase.initialSelections}
          initialLanguage={phase.initialLanguage}
          onPayloadReady={(payload, draft) =>
            setPhase({
              step: "saving",
              payload,
              vault: phase.vault,
              pingConfig: phase.pingConfig,
              draftEntries: draft.entries,
              draftSelections: draft.selections,
              draftLanguage: draft.language,
            })}
        />

        <button
          type="button"
          onClick={() => setPhase({ step: "idle" })}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-center"
        >
          ← {t("back")}
        </button>
      </div>
    );
  }

  if (phase.step === "saving") {
    return (
      <div className="space-y-5">
        <CryptoResult payload={phase.payload} />
        <TransparencyPanel payload={phase.payload} />
        <VaultSave
          payload={phase.payload}
          vaultKey={vaultKey}
          mode="edit"
          userPlan={userPlan}
          initialPingConfig={phase.pingConfig}
          onBack={() =>
            setPhase({
              step: "editing",
              vault: phase.vault,
              pingConfig: phase.pingConfig,
              initialEntries: phase.draftEntries,
              initialSelections: phase.draftSelections,
              initialLanguage: phase.draftLanguage,
            })
          }
          onDone={() => {
            setPhase({ step: "idle" });
            onSaved?.();
          }}
        />
      </div>
    );
  }

  return null;
}
