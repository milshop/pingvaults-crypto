"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { KeySchemaBuilder } from "@/components/KeySchemaBuilder";
import {
  encrypt,
  normalizeInput,
  validateSelections,
  type KeySelection,
  type Language,
  type KeyType,
} from "@/lib/crypto";
import { getPlanLimits, type UserPlan } from "@/lib/plans";
import { trackEvent } from "@/lib/analytics";

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
  file?: {
    name: string;
    type: string;
    size: number;
    data: string; // base64
  };
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
  summary: {
    entryCount: number;
    categories: string[];
  };
}

// ─── Asset Editor ─────────────────────────────────────────

interface AssetEditorProps {
  entries: AssetEntry[];
  onChange: (entries: AssetEntry[]) => void;
  userPlan?: UserPlan;
}

function CategorySelect({
  value,
  onChange,
  options,
  t
}: {
  value: string;
  onChange: (val: string) => void;
  options: string[];
  t: (key: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const isCustom = !options.includes(value) && value !== "__custom__";
  const displayValue = isCustom ? value : (value === "__custom__" ? t("customCategory") : value);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex min-h-10 items-center gap-2 px-3 py-2 rounded-md bg-white hover:bg-gray-50 text-xs font-mono text-gray-700 border border-gray-200 transition-colors"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/50" />
        <span className="truncate max-w-[140px]">{displayValue || t("customCategory")}</span>
        <span className="text-gray-400 ml-1">▾</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1.5 w-56 bg-white border border-gray-200 rounded-lg shadow-xl shadow-gray-200/50 z-20 overflow-hidden font-mono text-xs py-1">
            {options.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => { onChange(opt); setOpen(false); }}
                className="w-full text-left px-3 py-2.5 hover:bg-gray-100 text-gray-700 transition-colors"
              >
                {opt}
              </button>
            ))}
            <div className="h-px bg-gray-200 my-1" />
            <button
              type="button"
              onClick={() => { onChange("__custom__"); setOpen(false); }}
              className="w-full text-left px-3 py-2.5 hover:bg-gray-100 text-emerald-600 transition-colors"
            >
              {t("customCategory")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function AssetEditor({ entries, onChange, userPlan = "free" }: AssetEditorProps) {
  const t = useTranslations("VaultForm");
  const { fileUpload, maxFileSize } = getPlanLimits(userPlan);

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

  function handleFileUpload(id: string, file: File) {
    // Check file size limit
    if (file.size > maxFileSize) {
      alert(t("fileTooLarge", { max: (maxFileSize / 1024 / 1024).toFixed(0) }));
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target?.result as string;
      const data = base64.split(',')[1]; // Remove data:mime;base64, prefix
      onChange(entries.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              file: {
                name: file.name,
                type: file.type,
                size: file.size,
                data,
              }
            }
          : entry
      ));
    };
    reader.readAsDataURL(file);
  }

  function removeFile(id: string) {
    onChange(entries.map((entry) =>
      entry.id === id ? { ...entry, file: undefined } : entry
    ));
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
    <div className="space-y-4">
      {entries.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-200 p-8 text-center text-sm font-mono text-gray-400 bg-gray-50">
          <span className="block text-2xl mb-3 opacity-30">⌨️</span>
          {t("emptyHint")}
        </div>
      )}

      {entries.map((entry, i) => {
        const isCustom = !PRESET_CATEGORIES.includes(entry.category);
        return (
          <div
            key={entry.id}
            className="group relative rounded-xl border border-gray-200 bg-white shadow-sm transition-all hover:border-gray-300"
          >
            {/* Header / Controls */}
            <div className="flex flex-col gap-3 px-3 py-3 border-b border-gray-200 bg-gray-50 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <span className="font-mono text-[10px] text-gray-400 select-none ml-1">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <CategorySelect
                  value={entry.category}
                  options={PRESET_CATEGORIES}
                  t={t}
                  onChange={(val) => updateField(entry.id, "category", val === "__custom__" ? "" : val)}
                />
              </div>

              {/* Action buttons (Fade in on hover) */}
              <div className="flex items-center justify-end gap-1 opacity-100 sm:opacity-50 sm:group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={() => moveUp(i)}
                  disabled={i === 0}
                  className="min-h-10 min-w-10 p-2 rounded text-gray-500 hover:text-gray-700 disabled:opacity-20 hover:bg-gray-100 transition-colors"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 15l-6-6-6 6"/></svg>
                </button>
                <button
                  type="button"
                  onClick={() => moveDown(i)}
                  disabled={i === entries.length - 1}
                  className="min-h-10 min-w-10 p-2 rounded text-gray-500 hover:text-gray-700 disabled:opacity-20 hover:bg-gray-100 transition-colors"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
                </button>
                <div className="w-px h-4 bg-gray-200 mx-1" />
                <button
                  type="button"
                  onClick={() => removeEntry(entry.id)}
                  className="min-h-10 min-w-10 p-2 rounded text-red-500/70 hover:text-red-600 hover:bg-red-500/10 transition-colors"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
              </div>
            </div>

            {/* Custom category input */}
            {isCustom && (
              <div className="px-4 pt-3 pb-1">
                <input
                  type="text"
                  placeholder={t("customPlaceholder")}
                  value={entry.category}
                  onChange={(e) => updateField(entry.id, "category", e.target.value)}
                  className="w-full bg-transparent text-xs font-mono text-emerald-600 border-b border-dashed border-gray-200 pb-1 focus:outline-none focus:border-emerald-500/50 transition-colors"
                />
              </div>
            )}

            {/* Content Editor */}
            <div className="relative px-4 py-3">
              <div className="absolute left-4 top-3.5 bottom-3 w-px bg-gray-200" />
              <textarea
                rows={4}
                className="w-full min-h-28 pl-4 bg-transparent text-sm font-mono text-gray-700 resize-y focus:outline-none placeholder:text-gray-400 leading-relaxed"
                placeholder={`// ${getPlaceholder(entry.category)}`}
                value={entry.content}
                onChange={(e) => updateField(entry.id, "content", e.target.value)}
              />
            </div>

            {/* File Upload Area */}
            <div className="px-4 pb-3">
              {!fileUpload ? (
                <div className="flex items-center justify-center gap-2 p-3 border border-dashed border-gray-200 rounded-lg bg-gray-50">
                  <span className="text-gray-300">📎</span>
                  <span className="text-xs font-mono text-gray-400">{t("fileUploadPremium")}</span>
                </div>
              ) : entry.file ? (
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
                    onClick={() => removeFile(entry.id)}
                    className="text-red-500 hover:text-red-600 p-1"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 6L6 18M6 6l12 12"/>
                    </svg>
                  </button>
                </div>
              ) : (
                <label className="flex items-center justify-center gap-2 p-3 border border-dashed border-gray-300 rounded-lg hover:border-emerald-500 hover:bg-emerald-50/30 transition-colors cursor-pointer">
                  <span className="text-gray-400">📎</span>
                  <span className="text-xs font-mono text-gray-500">{t("attachFile")} (max {(maxFileSize / 1024 / 1024).toFixed(0)}MB)</span>
                  <input
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileUpload(entry.id, file);
                    }}
                  />
                </label>
              )}
            </div>
          </div>
        );
      })}

      <button
        type="button"
        onClick={addEntry}
        className="w-full rounded-xl border border-dashed border-gray-200 py-3 text-sm font-mono text-gray-500 hover:text-emerald-600 hover:border-emerald-500/30 hover:bg-emerald-500/5 transition-all flex items-center justify-center gap-2"
      >
        <span>+</span> {t("addEntry")}
      </button>
    </div>
  );
}

// ─── VaultForm main component ─────────────────────────────

interface VaultFormProps {
  onPayloadReady: (
    payload: VaultPayload,
    draft: {
      entries: AssetEntry[];
      selections: KeySelection[];
      language: Language;
    }
  ) => void;
  initialEntries?: AssetEntry[];
  initialSelections?: KeySelection[];
  initialLanguage?: Language;
  userPlan?: UserPlan;
}

export function VaultForm({
  onPayloadReady,
  initialEntries,
  initialSelections,
  initialLanguage,
  userPlan = "free",
}: VaultFormProps) {
  const t = useTranslations("VaultForm");
  const locale = useLocale();

  const [entries, setEntries] = useState<AssetEntry[]>(() => initialEntries ?? []);
  const [selections, setSelections] = useState<KeySelection[]>(() => initialSelections ?? initSelections());
  const [language, setLanguage] = useState<Language>(initialLanguage ?? "en");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ title: string; detail: string } | null>(null);

  async function handleEncrypt(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const nonEmpty = entries.filter((en) => en.content.trim());
    if (nonEmpty.length === 0) {
      setError({
        title: t("inputErrorTitle"),
        detail: t("noEntriesError"),
      });
      return;
    }

    try {
      validateSelections(selections);
    } catch (err) {
      setError({
        title: t("schemaErrorTitle"),
        detail: err instanceof Error ? err.message : t("schemaValidationError"),
      });
      return;
    }

    const customWithoutQuestion = selections.find(
      (s) => s.type === "custom_question" && !s.question?.trim()
    );
    if (customWithoutQuestion) {
      setError({
        title: t("schemaErrorTitle"),
        detail: t("questionRequiredError"),
      });
      return;
    }

    const recoveryPhrase = selections.find((s) => s.type === "custom_question");
    if (
      !recoveryPhrase ||
      [...normalizeInput(recoveryPhrase.value, language)].length < 20
    ) {
      setError({
        title: t("schemaErrorTitle"),
        detail: t("recoveryPhraseWeakError"),
      });
      return;
    }

    setLoading(true);
    trackEvent("Vault Encryption Started", {
      locale,
      plan: userPlan,
      entries: nonEmpty.length,
      has_file: nonEmpty.some((entry) => Boolean(entry.file)),
    });
    try {
      const plaintext = JSON.stringify({
        v: 1,
        entries: nonEmpty.map(({ category, content, file }) => ({
          category,
          content,
          ...(file ? { file } : {})
        })),
      });

      const payload = await encrypt(plaintext, selections, language);

      trackEvent("Vault Encrypted", {
        locale,
        plan: userPlan,
        entries: nonEmpty.length,
        has_file: nonEmpty.some((entry) => Boolean(entry.file)),
      });

      const keySchema: KeySchemaItemSafe[] = selections.map((s) => ({
        type: s.type,
        ...(s.type === "custom_question" ? { question: s.question } : {}),
      }));

      const categories = Array.from(
        new Set(
          nonEmpty
            .map((entry) => entry.category.trim())
            .filter(Boolean)
        )
      );

      onPayloadReady(
        {
          ...payload,
          keySchema,
          keyLanguage: language,
          summary: {
            entryCount: nonEmpty.length,
            categories,
          },
        },
        {
          entries,
          selections,
          language,
        }
      );
    } catch (err) {
      trackEvent("Vault Encryption Failed", { locale, plan: userPlan });
      setError({
        title: t("encryptErrorTitle"),
        detail: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleEncrypt} className="space-y-6">
      <div className="space-y-3">
        <Label>{t("sectionAssets")}</Label>
        <AssetEditor entries={entries} onChange={setEntries} userPlan={userPlan} />
        <p className="text-xs text-gray-500 font-mono">
          {t("assetSummary", {
            count: entries.filter((entry) => entry.content.trim()).length,
          })}
        </p>
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
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 space-y-1.5">
          <p className="text-sm text-red-600 font-semibold">{error.title}</p>
          <p className="text-xs text-red-600/90 font-mono leading-relaxed">{error.detail}</p>
          <p className="text-[11px] text-gray-500">{t("errorHint")}</p>
        </div>
      )}

      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? t("encrypting") : t("encryptButton")}
      </Button>
    </form>
  );
}
