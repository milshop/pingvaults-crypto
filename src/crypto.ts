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

// ═══════════════════════════════════════════════════════════
// v2：Argon2id + HKDF，可选 125 位恢复码（高强度模式）
// ═══════════════════════════════════════════════════════════
// v1（上面的 deriveKey/encrypt/decrypt）永久保留，旧金库一律按 v1 解密。
// v2 构造：
//   P    = UTF8(normalize(a1) | normalize(a2) | …)          与 v1 相同
//   Ka   = Argon2id(P, salt, m=64 MiB, t=3, p=1, 32 字节)
//   Kstd = HKDF-SHA256(Ka,               salt, "PingVaults v2 std")
//   Krc  = HKDF-SHA256(Ka ‖ UTF8(R),     salt, "PingVaults v2 rc")
// 恢复码 R 只在浏览器生成、只印在恢复卡上，不发送给服务器。
// AES-GCM 的附加数据（AAD）绑定头部 {"v":2,"kdf":{…},"rc":…}，参数被改就解不开。

export interface KdfParams {
  alg: "argon2id";
  m: number; // KiB
  t: number;
  p: number;
}

export interface VaultHeader {
  v: 2;
  kdf: KdfParams;
  rc: boolean;
}

export const KDF_V2: KdfParams = { alg: "argon2id", m: 65536, t: 3, p: 1 };

export function isVaultHeader(value: unknown): value is VaultHeader {
  if (!value || typeof value !== "object") return false;
  const h = value as Record<string, unknown>;
  const k = h.kdf as Record<string, unknown> | undefined;
  return h.v === 2 && typeof h.rc === "boolean" && !!k && k.alg === "argon2id" &&
    Number.isInteger(k.m) && (k.m as number) >= 8192 && (k.m as number) <= 1048576 &&
    Number.isInteger(k.t) && (k.t as number) >= 1 && (k.t as number) <= 10 &&
    Number.isInteger(k.p) && (k.p as number) >= 1 && (k.p as number) <= 4;
}

/** 头部的规范 JSON（字段顺序固定），用作 AES-GCM 的附加数据 */
export function headerAad(h: VaultHeader): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ v: 2, kdf: { alg: h.kdf.alg, m: h.kdf.m, t: h.kdf.t, p: h.kdf.p }, rc: h.rc }));
}

// ─── 恢复码：Crockford Base32，25 位数据 + 3 位校验，分 7 组 ───

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const RECOVERY_CODE_DATA_CHARS = 25;

async function recoveryChecksum(data: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`PVRC1${data}`)));
  const bits15 = ((digest[0] << 8) | digest[1]) >>> 1;
  return CROCKFORD[(bits15 >> 10) & 31] + CROCKFORD[(bits15 >> 5) & 31] + CROCKFORD[bits15 & 31];
}

/** 按 Crockford 规则标准化：去空格和短横、转大写、I/L→1、O→0；含非法字符返回 null */
export function normalizeRecoveryCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[\s-]/g, "").replace(/[IL]/g, "1").replace(/O/g, "0");
  return /^[0-9A-HJKMNP-TV-Z]*$/.test(s) ? s : null;
}

export function formatRecoveryCode(canonical: string): string {
  return canonical.match(/.{1,4}/g)?.join("-") ?? canonical;
}

export async function generateRecoveryCode(): Promise<string> {
  const bytes = generateRandomBytes(RECOVERY_CODE_DATA_CHARS);
  const data = Array.from(bytes, (b) => CROCKFORD[b & 31]).join("");
  return formatRecoveryCode(data + (await recoveryChecksum(data)));
}

/** 校验恢复码；成功时返回参与密钥派生的 25 位数据 */
export async function parseRecoveryCode(input: string): Promise<{ ok: true; data: string } | { ok: false; reason: "chars" | "length" | "checksum" }> {
  const s = normalizeRecoveryCode(input);
  if (s === null) return { ok: false, reason: "chars" };
  if (s.length !== RECOVERY_CODE_DATA_CHARS + 3) return { ok: false, reason: "length" };
  const data = s.slice(0, RECOVERY_CODE_DATA_CHARS);
  if ((await recoveryChecksum(data)) !== s.slice(RECOVERY_CODE_DATA_CHARS)) return { ok: false, reason: "checksum" };
  return { ok: true, data };
}

// ─── v2 密钥派生 ───

async function argon2idBytes(password: string, salt: Uint8Array, kdf: KdfParams): Promise<Uint8Array> {
  const { argon2id } = await import("hash-wasm");
  return argon2id({ password, salt, parallelism: kdf.p, iterations: kdf.t, memorySize: kdf.m, hashLength: 32, outputType: "binary" });
}

export async function deriveKeyV2(
  selections: KeySelection[],
  salt: Uint8Array,
  language: Language,
  header: VaultHeader,
  recoveryData?: string
): Promise<CryptoKey> {
  validateSelections(selections);
  if (header.rc && !recoveryData) throw new Error("这个金库需要恢复码");
  const raw = selections.map((s) => normalizeInput(s.value, language)).join(KDF_SEPARATOR);
  const ka = await argon2idBytes(raw, salt, header.kdf);
  const rc = header.rc ? new TextEncoder().encode(recoveryData) : new Uint8Array(0);
  const ikm = new Uint8Array(ka.length + rc.length);
  ikm.set(ka, 0);
  ikm.set(rc, ka.length);
  const base = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: salt.buffer as ArrayBuffer, info: new TextEncoder().encode(header.rc ? "PingVaults v2 rc" : "PingVaults v2 std") },
    base,
    { name: "AES-GCM", length: KEY_LENGTH },
    false,
    ["encrypt", "decrypt"]
  );
}

export interface EncryptedPayloadV2 extends EncryptedPayload {
  header: VaultHeader;
}

export async function encryptV2(
  plaintext: string,
  selections: KeySelection[],
  language: Language,
  options: { recoveryCode?: string; kdf?: KdfParams } = {}
): Promise<EncryptedPayloadV2> {
  let recoveryData: string | undefined;
  if (options.recoveryCode !== undefined) {
    const parsed = await parseRecoveryCode(options.recoveryCode);
    if (!parsed.ok) throw new Error("恢复码无效");
    recoveryData = parsed.data;
  }
  const header: VaultHeader = { v: 2, kdf: options.kdf ?? KDF_V2, rc: recoveryData !== undefined };
  const salt = generateRandomBytes(SALT_BYTES);
  const iv = generateRandomBytes(IV_BYTES);
  const key = await deriveKeyV2(selections, salt, language, header, recoveryData);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv.buffer as ArrayBuffer, additionalData: headerAad(header).buffer as ArrayBuffer },
    key,
    new TextEncoder().encode(plaintext)
  );
  return { ciphertext: bufferToBase64(ct), salt: bufferToBase64(salt), iv: bufferToBase64(iv), header };
}

/** 按头部选择 v1 或 v2 解密；header 为空即 v1 */
export async function decryptAny(
  payload: EncryptedPayload & { header?: VaultHeader | null },
  selections: KeySelection[],
  language: Language = "zh",
  recoveryCode?: string
): Promise<string> {
  const header = payload.header ?? null;
  if (!header) return decrypt(payload, selections, language);
  if (!isVaultHeader(header)) throw new Error("无法识别的加密版本");
  let recoveryData: string | undefined;
  if (header.rc) {
    const parsed = await parseRecoveryCode(recoveryCode ?? "");
    if (!parsed.ok) throw new Error("恢复码无效");
    recoveryData = parsed.data;
  }
  const salt = base64ToBuffer(payload.salt);
  const iv = base64ToBuffer(payload.iv);
  const key = await deriveKeyV2(selections, salt, language, header, recoveryData);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv.buffer as ArrayBuffer, additionalData: headerAad(header).buffer as ArrayBuffer },
    key,
    base64ToBuffer(payload.ciphertext).buffer as ArrayBuffer
  );
  return new TextDecoder().decode(pt);
}

/** 由数据库或恢复卡里的 kdf/rc 字段还原头部；没有 kdf 即 v1 金库 */
export function headerFromRecord(kdf: unknown, rc: unknown): VaultHeader | null {
  if (!kdf) return null;
  const h = { v: 2 as const, kdf: kdf as KdfParams, rc: rc === true };
  return isVaultHeader(h) ? h : null;
}
