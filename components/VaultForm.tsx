"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { KeySchemaBuilder } from "@/components/KeySchemaBuilder";
import {
  encrypt,
  validateSelections,
  type KeySelection,
  type Language,
  type KeyType,
} from "@/lib/crypto";

// Initial: name + custom_question in random order
function initSelections(): KeySelection[] {
  const base: KeySelection[] = [
    { type: "name", value: "" },
    { type: "custom_question", question: "", value: "" },
  ];
  return Math.random() > 0.5 ? base : [base[1], base[0]];
}

// ─── Asset Entry ──────────────────────────────────────────

export interface AssetEntry {
  id: string;
  category: string;
  content: string;
}

// ─── VaultPayload (sent to server — no values / plaintext) ─

export interface KeySchemaItemSafe {
  type: KeyType;
  question?: string;
}

export interface VaultPayload {
  ciphertext: string;
  salt: string;
  iv: string;
  keySchema: KeySchemaItemSafe[];
  keyLanguage: Language;
}

// ─── Asset Editor ─────────────────────────────────────────

interface AssetEditorProps {
  entries: AssetEntry[];
  onChange: (entries: AssetEntry[]) => void;
}

function AssetEditor({ entries, onChange }: AssetEditorProps) {
  const t = useTranslations("VaultForm");

  const PRESET_CATEGORIES = [
    t("categories.privateKey"),
    t("categories.crypto"),
    t("categories.bank"),
    t("categories.hardware"),
    t("categories.passwords"),
    t("categories.property"),
    t("categories.stocks"),
    t("categories.other"),
  ];

  function addEntry() {
    const id = Date.now().toString();
    onChange([...entries, { id, category: PRESET_CATEGORIES[0], content: "" }]);
  }

  function removeEntry(id: string) {
    onChange(entries.filter((e) => e.id !== id));
  }

  function moveUp(index: number) {
    if (index === 0) return;
    const next = [...entries];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    onChange(next);
  }

  function moveDown(index: number) {
    if (index === entries.length - 1) return;
    const next = [...entries];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    onChange(next);
  }

  function updateField(id: string, field: keyof AssetEntry, value: string) {
    onChange(entries.map((e) => (e.id === id ? { ...e, [field]: value } : e)));
  }

  function getPlaceholder(category: string): string {
    if (category.includes("Private Key") || category.includes("Mnemonic") || category.includes("私钥") || category.includes("助记词"))
      return t("placeholders.privateKey");
    if (category.includes("Crypto") || category.includes("加密货币"))
      return t("placeholders.crypto");
    if (category.includes("Bank") || category.includes("银行"))
      return t("placeholders.bank");
    if (category.includes("Hardware") || category.includes("硬件"))
      return t("placeholders.hardware");
    if (category.includes("Password") || category.includes("Login") || category.includes("账号"))
      return t("placeholders.passwords");
    if (category.includes("Property") || category.includes("Safe") || category.includes("房产"))
      return t("placeholders.property");
    if (category.includes("Stock") || category.includes("Fund") || category.includes("股票"))
      return t("placeholders.stocks");
    return t("placeholders.default");
  }

  return (
    <div className="space-y-3">
      {entries.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {t("emptyHint")}
        </div>
      )}

      {entries.map((entry, i) => (
        <div
          key={entry.id}
          className="rounded-xl border border-border bg-muted/10 overflow-hidden"
        >
          {/* Entry header */}
          <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/20 border-b border-border">
            <span className="w-6 h-6 flex items-center justify-center rounded-full bg-primary/15 text-primary text-xs font-bold shrink-0 select-none">
              {i + 1}
            </span>
            <div className="flex-1 min-w-0">
              <select
                value={PRESET_CATEGORIES.includes(entry.category) ? entry.category : "__custom__"}
                onChange={(e) => {
                  updateField(
                    entry.id,
                    "category",
                    e.target.value === "__custom__" ? "" : e.target.value
                  );
                }}
                className="w-full bg-transparent text-base text-foreground focus:outline-none cursor-pointer"
              >
                {PRESET_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
                <option value="__custom__">{t("customCategory")}</option>
              </select>
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                type="button"
                onClick={() => moveUp(i)}
                disabled={i === 0}
                title="↑"
                className="px-1.5 py-1 rounded text-xs text-muted-foreground hover:text-foreground disabled:opacity-25 hover:bg-muted transition-colors"
              >↑</button>
              <button
                type="button"
                onClick={() => moveDown(i)}
                disabled={i === entries.length - 1}
                title="↓"
                className="px-1.5 py-1 rounded text-xs text-muted-foreground hover:text-foreground disabled:opacity-25 hover:bg-muted transition-colors"
              >↓</button>
              <button
                type="button"
                onClick={() => removeEntry(entry.id)}
                title="×"
                className="px-1.5 py-1 rounded text-xs text-red-400 hover:text-red-300 hover:bg-red-950/30 transition-colors ml-1"
              >×</button>
            </div>
          </div>

          {/* Custom category input */}
          {!PRESET_CATEGORIES.includes(entry.category) && (
            <div className="px-4 pt-3 pb-1">
              <Input
                placeholder={t("customPlaceholder")}
                value={entry.category}
                onChange={(e) => updateField(entry.id, "category", e.target.value)}
                className="text-sm h-8"
              />
            </div>
          )}

          {/* Content textarea */}
          <div className="px-4 pb-4 pt-3">
            <textarea
              rows={3}
              className="w-full bg-transparent text-sm font-mono resize-y focus:outline-none placeholder:text-muted-foreground/50 leading-loose"
              placeholder={getPlaceholder(entry.category)}
              value={entry.content}
              onChange={(e) => updateField(entry.id, "content", e.target.value)}
            />
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={addEntry}
        className="w-full rounded-xl border border-dashed border-border py-3.5 text-base text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-primary/5 transition-all"
      >
        {t("addEntry")}
      </button>
    </div>
  );
}

// ─── VaultForm main component ─────────────────────────────

interface VaultFormProps {
  onPayloadReady: (payload: VaultPayload) => void;
  initialEntries?: AssetEntry[];
  initialSelections?: KeySelection[];
  initialLanguage?: Language;
}

export function VaultForm({
  onPayloadReady,
  initialEntries,
  initialSelections,
  initialLanguage,
}: VaultFormProps) {
  const t = useTranslations("VaultForm");

  const [entries, setEntries] = useState<AssetEntry[]>(() => initialEntries ?? []);
  const [selections, setSelections] = useState<KeySelection[]>(() => initialSelections ?? initSelections());
  const [language, setLanguage] = useState<Language>(initialLanguage ?? "en");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleEncrypt(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const nonEmpty = entries.filter((en) => en.content.trim());
    if (nonEmpty.length === 0) {
      setError(t("noEntriesError"));
      return;
    }

    try {
      validateSelections(selections);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("schemaValidationError"));
      return;
    }

    const customWithoutQuestion = selections.find(
      (s) => s.type === "custom_question" && !s.question?.trim()
    );
    if (customWithoutQuestion) {
      setError(t("questionRequiredError"));
      return;
    }

    setLoading(true);
    try {
      const plaintext = JSON.stringify({
        v: 1,
        entries: nonEmpty.map(({ category, content }) => ({ category, content })),
      });

      const payload = await encrypt(plaintext, selections, language);

      const keySchema: KeySchemaItemSafe[] = selections.map((s) => ({
        type: s.type,
        ...(s.type === "custom_question" ? { question: s.question } : {}),
      }));

      onPayloadReady({ ...payload, keySchema, keyLanguage: language });
    } catch (err) {
      setError("Encryption failed: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleEncrypt} className="space-y-6">
      <div className="space-y-3">
        <Label>{t("sectionAssets")}</Label>
        <AssetEditor entries={entries} onChange={setEntries} />
      </div>

      <Separator />

      <div className="space-y-3">
        <Label>{t("sectionPassphrase")}</Label>
        <KeySchemaBuilder
          selections={selections}
          language={language}
          onChange={(s, l) => {
            setSelections(s);
            setLanguage(l);
          }}
        />
      </div>

      {error && (
        <p className="text-sm text-red-400 font-mono bg-red-950/30 border border-red-900/40 rounded px-3 py-2">
          {error}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? t("encrypting") : t("encryptButton")}
      </Button>
    </form>
  );
}
