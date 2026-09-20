import { normalizedEmail } from "./auth-policy";
import { RequestPolicyError } from "./request-policy";
import { getPlanLimits, type UserPlan } from "./plans";

export const MAX_VAULT_REQUEST_BYTES = 6 * 1024 * 1024;
const TYPES = ["name", "custom_question", "id_last_4", "phone_last_4"];
const FIELDS = new Set(["ciphertext", "salt", "iv", "key_schema", "key_language", "emergency_email", "backup_email", "ping_initial_days", "ping_interval_days", "ping_max_count"]);
function invalid(): never { throw new RequestPolicyError("Invalid encrypted vault or recovery metadata"); }
function base64(value: unknown, minBytes: number, maxBytes: number): value is string {
  if (typeof value !== "string" || value.length > 4 * Math.ceil(maxBytes / 3) || value.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return false;
  const decoded = Buffer.from(value, "base64");
  return decoded.length >= minBytes && decoded.length <= maxBytes && decoded.toString("base64") === value;
}
export function validateVaultInput(input: unknown, plan: UserPlan) {
  if (!input || typeof input !== "object" || Array.isArray(input)) invalid();
  const body = input as Record<string, unknown>;
  if (Object.keys(body).some((key) => !FIELDS.has(key))) invalid();
  const limits = getPlanLimits(plan);
  // Bound total opaque ciphertext, not its secret contents. Paid file budgets
  // include inner Base64 expansion and 256 KiB for JSON/text/crypto overhead.
  const maxEncryptedBytes = 256 * 1024 + Math.ceil(limits.maxFileSize * 4 / 3);
  if (!base64(body.ciphertext, 17, maxEncryptedBytes) || !base64(body.salt, 32, 32) || !base64(body.iv, 12, 12)) invalid();
  if (!["en", "zh", "ja"].includes(String(body.key_language))) invalid();
  if (!Array.isArray(body.key_schema) || body.key_schema.length < 2 || body.key_schema.length > 4) invalid();
  const key_schema = body.key_schema.map((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) invalid();
    const row = item as Record<string, unknown>;
    if (Object.keys(row).some((key) => key !== "type" && key !== "question") || !TYPES.includes(String(row.type))) invalid();
    if (row.type === "custom_question") {
      if (typeof row.question !== "string" || !row.question.trim() || row.question.length > 300) invalid();
      return { type: String(row.type), question: row.question.trim() };
    }
    if (row.question !== undefined) invalid();
    return { type: String(row.type) };
  });
  const selected = new Set(key_schema.map((item) => item.type));
  if (selected.size !== key_schema.length || !selected.has("name") || !selected.has("custom_question")) invalid();
  function email(field: string) {
    const value = body[field];
    if (value === undefined || value === null || value === "") return undefined;
    return normalizedEmail(value) ?? invalid();
  }
  function days(field: string, max: number) {
    const value = body[field];
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > max) invalid();
    return value;
  }
  return {
    ciphertext: body.ciphertext, salt: body.salt, iv: body.iv,
    key_schema, key_language: String(body.key_language),
    emergency_email: email("emergency_email"), backup_email: email("backup_email"),
    ping_initial_days: days("ping_initial_days", 365),
    ping_interval_days: days("ping_interval_days", 30), ping_max_count: days("ping_max_count", 10),
  };
}
