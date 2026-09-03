/**
 * PingVaults 前端加密核心
 *
 * 预期的数据边界：
 * - 所有操作在浏览器本地完成（WebCrypto API）
 * - 调用方只把 ciphertext + salt + iv + key_schema（结构）+ key_language 发给后端
 * - 整体安全性仍取决于页面完整性、终端安全和恢复短语的不可预测性
 */

// OWASP 2023 推荐：SHA-256 配套 600,000 次（旧标准 100k 已过时）
export const PBKDF2_ITERATIONS = 600_000;
export const KEY_LENGTH = 256;
export const SALT_BYTES = 32; // 256-bit salt（原 16B，提升至 32B）
export const IV_BYTES = 12;
export const KDF_SEPARATOR = "|"; // 防止拼接歧义：abc|def ≠ ab|cdef

// ─── 语言类型 ──────────────────────────────────────────────

export type Language = "zh" | "en" | "ja";

export const LANGUAGE_LABELS: Record<Language, string> = {
  zh: "中文",
  en: "English",
  ja: "日本語",
};

// ─── 密钥类型定义 ─────────────────────────────────────────

export type KeyType =
  | "name"
  | "id_last_4"
  | "phone_last_4"
  | "custom_question";

export const KEY_TYPE_LABELS: Record<KeyType, string> = {
  name: "姓名",
  id_last_4: "证件号后 4 位",
  phone_last_4: "手机号后 4 位",
  custom_question: "自定义问题",
};

export const KEY_TYPE_PLACEHOLDERS: Record<KeyType, string> = {
  name: "例如：张伟",
  id_last_4: "例如：123X",
  phone_last_4: "例如：8888",
  custom_question: "输入你的答案...",
};

// 必选（不可移除，只能调整顺序）
export const REQUIRED_KEY_TYPES: KeyType[] = ["name", "custom_question"];

// 可选（可自由添加/移除）
export const OPTIONAL_KEY_TYPES: KeyType[] = ["id_last_4", "phone_last_4"];

export const ALL_KEY_TYPES: KeyType[] = [
  "name",
  "id_last_4",
  "phone_last_4",
  "custom_question",
];

export const MIN_SELECTIONS = 2; // name + custom_question
export const MAX_SELECTIONS = 4; // 全部四项

// ─── KeySelection 结构 ────────────────────────────────────

export interface KeySelection {
  type: KeyType;
  question?: string; // custom_question 的题面（存入 DB）
  value: string;     // 恢复值（调用方不应把它包含在保存请求中）
}

// ─── 校验 ─────────────────────────────────────────────────

export function validateSelections(selections: KeySelection[]): void {
  if (selections.length < MIN_SELECTIONS || selections.length > MAX_SELECTIONS) {
    throw new Error(`密语必须包含 ${MIN_SELECTIONS}–${MAX_SELECTIONS} 个维度`);
  }
  const hasName = selections.some((s) => s.type === "name");
  if (!hasName) {
    throw new Error("必须包含「姓名」维度");
  }
  const hasCustom = selections.some((s) => s.type === "custom_question");
  if (!hasCustom) {
    throw new Error("必须包含「自定义问题」维度");
  }
  const hasEmpty = selections.some((s) => !s.value.trim());
  if (hasEmpty) {
    throw new Error("所有密语维度的答案不能为空");
  }
}

// ─── 标准化（语言感知）────────────────────────────────────

export function normalizeInput(str: string, language: Language = "zh"): string {
  if (!str) return "";
  let s = str.trim().toLowerCase();

  if (language === "zh" || language === "ja") {
    // 全角转半角（中日用户常见输入问题）
    s = s.replace(/[\uff01-\uff5e]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
    );
  }

  // 移除空格、横杠、斜杠、点等干扰符
  s = s.replace(/[\s\-\/\.,_]/g, "");

  return s;
}

// ─── 工具函数 ─────────────────────────────────────────────

export function bufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return btoa(String.fromCharCode(...bytes));
}

export function base64ToBuffer(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

export function generateRandomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

// ─── 密钥派生（schema 顺序即密钥结构的一部分）───────────────

/**
 * 按用户定义的 schema 顺序拼接并派生 AES-256 密钥
 * 顺序是密钥的一部分：name|birthday ≠ birthday|name
 */
export async function deriveKey(
  selections: KeySelection[],
  salt: Uint8Array,
  language: Language = "zh"
): Promise<CryptoKey> {
  validateSelections(selections);

  // 严格按照用户定义的顺序（不做排序）
  const rawKeyString = selections
    .map((s) => normalizeInput(s.value, language))
    .join(KDF_SEPARATOR);

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(rawKeyString),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt.buffer as ArrayBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: KEY_LENGTH },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function deriveKeyFingerprint(
  selections: KeySelection[],
  salt: Uint8Array,
  language: Language = "zh"
): Promise<string> {
  validateSelections(selections);

  const rawKeyString = selections
    .map((s) => normalizeInput(s.value, language))
    .join(KDF_SEPARATOR);

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(rawKeyString),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt.buffer as ArrayBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    KEY_LENGTH
  );

  const fingerprint = await crypto.subtle.digest("SHA-256", bits);
  return Array.from(new Uint8Array(fingerprint))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

// ─── 加密 ─────────────────────────────────────────────────

export interface EncryptedPayload {
  ciphertext: string; // Base64
  salt: string;       // Base64，16 字节随机
  iv: string;         // Base64，12 字节随机
}

export async function encrypt(
  plaintext: string,
  selections: KeySelection[],
  language: Language = "zh"
): Promise<EncryptedPayload> {
  const salt = generateRandomBytes(SALT_BYTES);
  const iv = generateRandomBytes(IV_BYTES);

  const key = await deriveKey(selections, salt, language);

  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv.buffer as ArrayBuffer },
    key,
    new TextEncoder().encode(plaintext)
  );

  return {
    ciphertext: bufferToBase64(ciphertextBuffer),
    salt: bufferToBase64(salt),
    iv: bufferToBase64(iv),
  };
}

// ─── 解密 ─────────────────────────────────────────────────

export async function decrypt(
  payload: EncryptedPayload,
  selections: KeySelection[],
  language: Language = "zh"
): Promise<string> {
  const salt = base64ToBuffer(payload.salt);
  const iv = base64ToBuffer(payload.iv);
  const ciphertext = base64ToBuffer(payload.ciphertext);

  const key = await deriveKey(selections, salt, language);

  const plaintextBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv.buffer as ArrayBuffer },
    key,
    ciphertext.buffer as ArrayBuffer
  );

  return new TextDecoder().decode(plaintextBuffer);
}
