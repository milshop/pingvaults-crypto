/**
 * GET /api/vault/fetch
 * GET /api/vault/fetch?txId=xxx (public ciphertext only; recovery answers are never accepted)
 */
import { NextRequest, NextResponse } from "next/server";
import { getVaultByEmail } from "@/lib/dynamodb";
import { getSessionFromRequest } from "@/lib/session";
import { fetchCiphertext } from "@/lib/storage-fetch";
import { isStorageTxId } from "@/lib/storage-status";

const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" };

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const txIdParam = searchParams.get("txId");

    // 直接 TxID 模式（紧急联系人 / 离线解密）
    if (txIdParam !== null) {
      if (!isStorageTxId(txIdParam)) return NextResponse.json({ error: "Invalid txId" }, { status: 400, headers });
      const result = await fetchCiphertext(txIdParam, { signal: request.signal });
      return NextResponse.json({
        ciphertext: result.ciphertext,
        tx_id: txIdParam,
        storage_url: result.url,
        arweave_url: result.url, // Legacy field retained for existing clients.
        gateway: result.gateway,
        source: "arweave_direct",
      }, { headers });
    }

    // 已登录模式：从 DynamoDB 读取元数据
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "未登录" }, { status: 401, headers });
    }

    const vault = await getVaultByEmail(session.email);
    if (!vault || !vault.arweave_txid) {
      return NextResponse.json({ error: "未找到金库记录" }, { status: 404, headers });
    }

    // Historical column names are retained; they do not prove a storage network.
    const result = await fetchCiphertext(vault.arweave_txid, { signal: request.signal });

    return NextResponse.json({
      ciphertext: result.ciphertext,
      salt: vault.crypto_salt,
      iv: vault.crypto_iv,
      key_schema: vault.key_schema ?? [],
      key_language: vault.key_language ?? "zh",
      tx_id: vault.arweave_txid,
      storage_url: result.url,
      arweave_url: result.url,
      gateway: result.gateway,
      source: "dynamodb",
    }, { headers });
  } catch (err) {
    console.error("[/api/vault/fetch] retrieval failed", err instanceof Error ? err.name : "UnknownError");
    return NextResponse.json(
      { error: "Ciphertext retrieval is unavailable. Retry or import your exported JSON in the offline decryptor." },
      { status: 502, headers }
    );
  }
}
