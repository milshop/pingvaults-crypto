/**
 * GET /api/ping/reset?token=JWT
 * Public endpoint — called when user clicks the "I'm still here" link in the ping email.
 * Verifies the JWT, resets pings_sent to 0, and updates next_ping_at.
 * Returns a standalone HTML confirmation page.
 */
import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { getVaultByEmail, updateVault } from "@/lib/dynamodb";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? "dev-secret-change-in-production"
);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");

  if (!token) {
    return htmlResponse("❌ Invalid Link", "Missing token parameter.", false);
  }

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);

    if (payload.type !== "ping-reset" || typeof payload.email !== "string") {
      return htmlResponse("❌ Invalid Token", "This link is not a valid ping reset link.", false);
    }

    const email = payload.email;
    const vault = await getVaultByEmail(email);

    if (!vault) {
      return htmlResponse("❌ Vault Not Found", "No vault associated with this link.", false);
    }

    if (vault.status === "EXECUTED") {
      return htmlResponse(
        "⚠️ Already Executed",
        "Your emergency contacts have already been notified. Please contact support if this is an error.",
        false
      );
    }

    // After a reset we restart the full initial-wait period, not just the interval
    const initialDays = vault.ping_initial_days ?? 30;
    const nextPingAt  = Date.now() + initialDays * 24 * 60 * 60 * 1000;

    await updateVault(email, {
      pings_sent: 0,
      next_ping_at: nextPingAt,
      last_active_time: Date.now(),
      status: "ACTIVE",
    });

    const nextDate = new Date(nextPingAt).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    return htmlResponse(
      "✅ Timer Reset",
      `Your vault timer has been successfully reset.\nNext check-in ping: <strong>${nextDate}</strong>\n(${initialDays} days from now)`,
      true
    );
  } catch (err) {
    console.error("[/api/ping/reset]", err);
    return htmlResponse(
      "❌ Link Expired",
      "This reset link has expired or is invalid. Please log in to PingVaults to reset your timer manually.",
      false
    );
  }
}

function htmlResponse(title: string, message: string, success: boolean) {
  const color = success ? "#22c55e" : "#ef4444";
  const bg = success ? "#0a1a0f" : "#1a0a0a";
  const border = success ? "#1a4a2a" : "#4a1a1a";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PingVaults — ${title}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #050505;
    color: #e4e4e7;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .card {
    background: ${bg};
    border: 1px solid ${border};
    border-radius: 16px;
    padding: 40px 48px;
    max-width: 480px;
    width: 100%;
    text-align: center;
  }
  .logo { font-family: monospace; font-size: 1.1rem; color: #71717a; margin-bottom: 28px; }
  .logo span { color: #22c55e; }
  .title { font-size: 1.5rem; font-weight: 700; color: ${color}; margin-bottom: 16px; font-family: monospace; }
  .msg { font-size: 0.9rem; color: #a1a1aa; line-height: 1.7; }
  .msg strong { color: #e4e4e7; }
  .back { display: inline-block; margin-top: 28px; text-decoration: none;
    border: 1px solid #27272a; color: #71717a; border-radius: 8px;
    padding: 10px 20px; font-size: 0.8rem; font-family: monospace;
    transition: all 0.15s; }
  .back:hover { border-color: #22c55e; color: #22c55e; }
</style>
</head>
<body>
<div class="card">
  <div class="logo"><span>›_</span> PingVaults</div>
  <div class="title">${title}</div>
  <p class="msg">${message.replace(/\n/g, "<br>")}</p>
  <a href="https://pingvaults.com" class="back">← Back to PingVaults</a>
</div>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
