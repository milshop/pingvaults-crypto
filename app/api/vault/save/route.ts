/**
 * POST /api/vault/save
 * Intended privacy boundary: this endpoint accepts ciphertext, recovery schema,
 * and ping configuration. The client does not include plaintext or recovery values.
 */
import { NextRequest, NextResponse } from "next/server";
import { getIrysUploader, ARWEAVE_GATEWAY } from "@/lib/irys";
import { getVaultByEmail, putVault, updateVault, removePingConfig, getUserPlan } from "@/lib/dynamodb";
import { getSessionFromRequest } from "@/lib/session";
import { getPlanLimits } from "@/lib/plans";
import { randomUUID } from "crypto";
import { readBoundedJson, RequestPolicyError } from "@/lib/request-policy";
import { MAX_VAULT_REQUEST_BYTES, validateVaultInput } from "@/lib/vault-input";

const DEFAULT_INITIAL_DAYS  = 30;   // days before first ping
const DEFAULT_INTERVAL_DAYS = 7;    // days between subsequent pings
const DEFAULT_MAX_PINGS     = 3;

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await readBoundedJson(request, MAX_VAULT_REQUEST_BYTES);
    const planRecord = await getUserPlan(session.email);
    const userPlan = planRecord?.user_plan ?? "free";
    const limits = getPlanLimits(userPlan);
    const {
      ciphertext,
      salt,
      iv,
      key_schema,
      key_language,
      // Ping config
      emergency_email,
      backup_email,
      ping_initial_days,
      ping_interval_days,
      ping_max_count,
    } = validateVaultInput(body, userPlan);

    // Free tier: reject backup email
    if (!limits.backupEmail && backup_email) {
      return NextResponse.json(
        { error: "Backup email requires a paid plan" },
        { status: 403 }
      );
    }

    const now = Date.now();
    const hasPing = !!emergency_email; // ping system is opt-in

    // Only compute ping fields when user opted in
    // Free tier: force fixed DMS parameters regardless of user input
    let initialDays:  number | undefined;
    let intervalDays: number | undefined;
    let maxCount:     number | undefined;

    if (hasPing) {
      if (!limits.customDms) {
        initialDays  = limits.fixedDmsInitialDays;
        intervalDays = limits.fixedDmsIntervalDays;
        maxCount     = limits.fixedDmsMaxCount;
      } else {
        initialDays  = Math.min(Math.max(Number(ping_initial_days)  || DEFAULT_INITIAL_DAYS,  1), 365);
        intervalDays = Math.min(Math.max(Number(ping_interval_days) || DEFAULT_INTERVAL_DAYS, 1), 30);
        maxCount     = Math.min(Math.max(Number(ping_max_count)     || DEFAULT_MAX_PINGS,     1), 10);
      }
    }
    const nextPingAt   = hasPing ? now + initialDays! * 24 * 60 * 60 * 1000 : undefined;

    // Upload validated, bounded ciphertext to Irys (not proof of Arweave inclusion).
    const irys = await getIrysUploader();

    // Auto-fund from wallet if Irys balance is insufficient
    const dataSize = Buffer.byteLength(ciphertext, "utf8");
    const price   = await irys.getPrice(dataSize);
    const balance = await irys.getLoadedBalance();

    if (balance.lt(price)) {
      await irys.fund(price);
    }

    const receipt = await irys.upload(ciphertext, {
      tags: [
        { name: "App-Name", value: "PingVaults" },
        { name: "Content-Type", value: "application/octet-stream" },
      ],
    });
    const txId = receipt.id;

    // Persist to DynamoDB (no plaintext, no answers)
    const existing = await getVaultByEmail(session.email);

    if (existing) {
      await updateVault(session.email, {
        arweave_txid: txId,
        crypto_salt: salt,
        crypto_iv: iv,
        key_schema,
        key_language,
        last_active_time: now,
        status: "ACTIVE",
        ...(hasPing ? {
          pings_sent: 0,
          next_ping_at: nextPingAt,
          ping_initial_days:  initialDays,
          ping_interval_days: intervalDays,
          ping_max_count:     maxCount,
          emergency_email,
          ...(backup_email ? { ping_backup_email: backup_email } : {}),
        } : {}),
      });
      // If user explicitly turned off ping, clear the old config
      if (!hasPing && existing.emergency_email) {
        await removePingConfig(session.email);
      }
    } else {
      await putVault({
        user_email:   session.email,
        vault_id:     randomUUID(),
        arweave_txid: txId,
        crypto_salt:  salt,
        crypto_iv:    iv,
        key_schema,
        key_language,
        last_active_time: now,
        status:       "ACTIVE",
        ping_token:   randomUUID(),
        created_at:   new Date().toISOString(),
        // Ping fields (all optional)
        ping_initial_days:  initialDays  ?? (0 as unknown as number),
        ping_interval_days: intervalDays ?? (0 as unknown as number),
        ping_max_count:     maxCount     ?? (0 as unknown as number),
        ping_backup_email:  backup_email || undefined,
        emergency_email:    emergency_email || undefined,
        pings_sent:         0,
        next_ping_at:       nextPingAt   ?? (0 as unknown as number),
      });
    }

    return NextResponse.json({
      success: true,
      tx_id: txId,
      arweave_url: `${ARWEAVE_GATEWAY}/${txId}`,
      db_saved: true,
      next_ping_at: nextPingAt ?? null,
    });
  } catch (err) {
    if (err instanceof RequestPolicyError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[/api/vault/save] failed", err instanceof Error ? err.name : "UnknownError");
    return NextResponse.json(
      { error: "Vault save failed. Keep your local encrypted backup and check the vault before retrying." },
      { status: 500 }
    );
  }
}
