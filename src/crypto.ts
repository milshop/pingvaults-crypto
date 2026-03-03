/**
 * pingvaults-crypto — PingVaults Encryption Core
 *
 * MIT License — open source for independent security auditing.
 * This is the ONLY code that ever touches your plaintext or answers.
 * Everything runs in the browser via WebCrypto API.
 * No network calls. No server involvement. No exceptions.
 *
 * Algorithm:
 *   Key derivation : PBKDF2-SHA256, 600,000 iterations (OWASP 2023 recommendation)
 *   Encryption     : AES-256-GCM (authenticated encryption, 256-bit key, 96-bit IV)
 *   Salt           : 32 bytes (256-bit), cryptographically random per encryption
 *   IV             : 12 bytes (96-bit), cryptographically random per encryption
 */

// ─── Constants ────────────────────────────────────────────

/** OWASP 2023: 600,000 iterations for PBKDF2-SHA256 */
export const PBKDF2_ITERATIONS = 600_000;

/** AES key length in bits */
export const KEY_LENGTH = 256;

/** Salt length in bytes (32 bytes = 256-bit) */
export const SALT_BYTES = 32;

/** IV length in bytes (12 bytes = 96-bit, recommended for AES-GCM) */
export const IV_BYTES = 12;

/**
 * Separator between key segments.
 * Prevents concatenation attacks: "abc|def" ≠ "ab|cdef"
 */
export const KDF_SEPARATOR = "|";

// ─── Language ─────────────────────────────────────────────

export type Language = "zh" | "en" | "ja";

// ─── Key Schema ───────────────────────────────────────────

export type KeyType =
  | "name"
  | "id_last_4"
  | "phone_last_4"
  | "custom_question";

/** Required fields — must always be present */
export const REQUIRED_KEY_TYPES: KeyType[] = ["name", "custom_question"];

/** Optional fields — user may add any combination */
export const OPTIONAL_KEY_TYPES: KeyType[] = ["id_last_4", "phone_last_4"];

export const MIN_SELECTIONS = 2; // name + custom_question minimum
export const MAX_SELECTIONS = 4; // all four fields maximum

export interface KeySelection {
  type: KeyType;
  question?: string; // Question text for custom_question (stored on server, safe to expose)
  value: string;     // Answer (stays in browser only, NEVER uploaded)
}

// ─── Validation ───────────────────────────────────────────

export function validateSelections(selections: KeySelection[]): void {
  if (selections.length < MIN_SELECTIONS || selections.length > MAX_SELECTIONS) {
    throw new Error(`Key schema must contain ${MIN_SELECTIONS}–${MAX_SELECTIONS} fields`);
  }
  if (!selections.some((s) => s.type === "name")) {
    throw new Error("Key schema must include the 'name' field");
  }
  if (!selections.some((s) => s.type === "custom_question")) {
    throw new Error("Key schema must include a 'custom_question' field");
  }
  if (selections.some((s) => !s.value.trim())) {
    throw new Error("All key fields must have non-empty answers");
  }
}

// ─── Input Normalization ──────────────────────────────────

/**
 * Normalize an answer string for consistent key derivation.
 *
 * Rules (language-aware):
 *   1. Trim whitespace
 *   2. Lowercase
 *   3. Full-width → half-width (Chinese/Japanese input)
 *   4. Remove spaces, dashes, slashes, dots, underscores
 *
 * This ensures "Alice", "alice", "ALICE" all derive the same key.
 * Users are reminded of these rules when setting up their schema.
 */
export function normalizeInput(str: string, language: Language = "zh"): string {
  if (!str) return "";
  let s = str.trim().toLowerCase();

  if (language === "zh" || language === "ja") {
    // Convert full-width characters (common in CJK input methods) to half-width
    s = s.replace(/[\uff01-\uff5e]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
    );
  }

  // Remove separators that users might accidentally include
  s = s.replace(/[\s\-\/\.,_]/g, "");

  return s;
}

// ─── Utilities ────────────────────────────────────────────

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

// ─── Key Derivation ───────────────────────────────────────

/**
 * Derive an AES-256-GCM key from user answers using PBKDF2-SHA256.
 *
 * The ORDER of selections is part of the key:
 *   [name, question] ≠ [question, name]
 *
 * Combined input string format:
 *   normalize(answer_0) | normalize(answer_1) | ... | normalize(answer_n)
 */
export async function deriveKey(
  selections: KeySelection[],
  salt: Uint8Array,
  language: Language = "zh"
): Promise<CryptoKey> {
  validateSelections(selections);

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

/**
 * Derive a key and return its SHA-256 fingerprint (hex).
 * Useful for verifying that two sets of answers produce the same key
 * without actually exposing the key material.
 */
export async function deriveKeyFingerprint(
  selections: KeySelection[],
  salt: Uint8Array,
  language: Language = "zh"
): Promise<string> {
  // We derive a second exportable key just for fingerprinting
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
    256
  );

  const hashBuffer = await crypto.subtle.digest("SHA-256", bits);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ─── Encryption ───────────────────────────────────────────

export interface EncryptedPayload {
  ciphertext: string; // Base64-encoded AES-GCM ciphertext (includes 16-byte auth tag)
  salt: string;       // Base64-encoded 32-byte random salt
  iv: string;         // Base64-encoded 12-byte random IV
}

/**
 * Encrypt plaintext using AES-256-GCM.
 * Salt and IV are freshly generated for each encryption.
 */
export async function encrypt(
  plaintext: string,
  selections: KeySelection[],
  language: Language = "zh"
): Promise<EncryptedPayload> {
  const salt = generateRandomBytes(SALT_BYTES);
  const iv   = generateRandomBytes(IV_BYTES);
  const key  = await deriveKey(selections, salt, language);

  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv.buffer as ArrayBuffer },
    key,
    new TextEncoder().encode(plaintext)
  );

  return {
    ciphertext: bufferToBase64(ciphertextBuffer),
    salt:       bufferToBase64(salt),
    iv:         bufferToBase64(iv),
  };
}

// ─── Decryption ───────────────────────────────────────────

/**
 * Decrypt an EncryptedPayload using AES-256-GCM.
 * Throws if the key is wrong or the ciphertext has been tampered with.
 */
export async function decrypt(
  payload: EncryptedPayload,
  selections: KeySelection[],
  language: Language = "zh"
): Promise<string> {
  const salt       = base64ToBuffer(payload.salt);
  const iv         = base64ToBuffer(payload.iv);
  const ciphertext = base64ToBuffer(payload.ciphertext);
  const key        = await deriveKey(selections, salt, language);

  const plaintextBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv.buffer as ArrayBuffer },
    key,
    ciphertext.buffer as ArrayBuffer
  );

  return new TextDecoder().decode(plaintextBuffer);
}
