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
  | { step: "decrypt"; vault: FetchedVault; answers: string[]; decryptError: string | null; decrypting: boolean }
  | { step: "editing"; vault: FetchedVault; initialEntries: AssetEntry[]; initialSelections: KeySelection[]; initialLanguage: Language }
  | { step: "saving"; payload: VaultPayload; savedTxId: string | null };

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
}

export function VaultEdit({ vaultKey = DEFAULT_VAULT_KEY }: VaultEditProps) {
  const t  = useTranslations("VaultEdit");
  const kt = useTranslations("keyTypes");

  const [phase, setPhase] = useState<Phase>({ step: "idle" });

  // ── Phase 1: fetch vault ──────────────────────────────
  async function handleFetch() {
    setPhase({ step: "fetching" });
    try {
      const localRaw = localStorage.getItem(vaultKey);
      let vault: FetchedVault;

      if (localRaw) {
        const local: LocalVaultMeta = JSON.parse(localRaw);
        const res  = await fetch(`/api/vault/fetch?txId=${local.txId}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Arweave fetch failed");
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
        const res  = await fetch("/api/vault/fetch");
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

      setPhase({
        step: "decrypt",
        vault,
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
          <p className="text-sm text-red-400 font-mono bg-red-950/30 border border-red-900/40 rounded px-3 py-2">
            {phase.message}
          </p>
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
          <div className="rounded-xl border border-yellow-900/40 bg-yellow-950/10 p-3 space-y-2">
            <p className="text-xs text-yellow-400 font-semibold">{t("schemaHintTitle")}</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {vault.keySchema.map((item, i) => (
                <span key={i} className="flex items-center gap-1">
                  {i > 0 && <span className="text-muted-foreground/50 text-xs">→</span>}
                  <span className="px-2 py-0.5 rounded-md bg-yellow-900/20 border border-yellow-800/30 text-xs text-yellow-300 font-mono">
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
              <Label className="text-xs text-yellow-400/80">
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
            <p className="text-sm text-red-400 font-mono bg-red-950/30 border border-red-900/40 rounded px-3 py-2">
              {decryptError}
            </p>
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
            <p className="text-sm font-semibold text-zinc-200">{t("editTitle")}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{t("editDesc")}</p>
          </div>
          <Badge variant="outline" className="text-green-400 border-green-800 text-xs">
            {t("decryptedBadge")}
          </Badge>
        </div>

        <div className="rounded-lg border border-blue-900/30 bg-blue-950/10 px-3 py-2">
          <p className="text-xs text-blue-400/80 font-mono">{t("editNote")}</p>
        </div>

        <VaultForm
          initialEntries={phase.initialEntries}
          initialSelections={phase.initialSelections}
          initialLanguage={phase.initialLanguage}
          onPayloadReady={(payload) => setPhase({ step: "saving", payload, savedTxId: null })}
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
        {phase.savedTxId ? (
          <div className="space-y-2">
            <p className="text-sm text-green-400 font-mono">{t("saveSuccess")}</p>
            <p className="font-mono text-xs text-zinc-500 break-all">TxID: {phase.savedTxId}</p>
            <button
              type="button"
              onClick={() => setPhase({ step: "idle" })}
              className="text-xs text-green-400/70 hover:text-green-400 font-mono transition-colors"
            >
              ← {t("back")}
            </button>
          </div>
        ) : (
          <VaultSave
            payload={phase.payload}
            vaultKey={vaultKey}
            onSaved={(txId) => setPhase((prev) => prev.step === "saving" ? { ...prev, savedTxId: txId } : prev)}
          />
        )}
      </div>
    );
  }

  return null;
}
