import { SignJWT, jwtVerify } from "jose";

export function sessionSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || new TextEncoder().encode(secret).length < 32) {
    throw new Error("JWT_SECRET must contain at least 32 bytes");
  }
  return new TextEncoder().encode(secret);
}

export function normalizedEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@:<>]+@[^\s@:<>]+\.[^\s@:<>]+$/.test(email) ? email : null;
}

export interface SessionPayload { email: string; iat: number; exp: number }

export async function issueSession(email: string): Promise<string> {
  const normalized = normalizedEmail(email);
  if (!normalized) throw new Error("Invalid email");
  return new SignJWT({ email: normalized, type: "session" })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("30d")
    .sign(sessionSecret());
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, sessionSecret(), { algorithms: ["HS256"] });
    // Existing sessions did not carry a type. Keep them valid until expiry,
    // but never accept a signed ping-reset token as account authentication.
    if (payload.type !== undefined && payload.type !== "session") return null;
    const email = normalizedEmail(payload.email);
    if (!email || typeof payload.iat !== "number" || typeof payload.exp !== "number" ||
        payload.exp <= payload.iat || payload.exp - payload.iat > 30 * 86400) return null;
    return { email, iat: payload.iat, exp: payload.exp };
  } catch { return null; }
}

export function verifiedGoogleEmail(userInfo: unknown): string | null {
  if (!userInfo || typeof userInfo !== "object") return null;
  const user = userInfo as Record<string, unknown>;
  return user.email_verified === true && typeof user.sub === "string" && user.sub.length > 0
    ? normalizedEmail(user.email) : null;
}
