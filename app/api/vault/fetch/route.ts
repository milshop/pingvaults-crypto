/**
 * GET /api/vault/fetch
 * GET /api/vault/fetch?txId=xxx  （直接从 Arweave 下载，用于离线/紧急联系人场景）
 */
import { NextRequest, NextResponse } from "next/server";
import { getVaultByEmail } from "@/lib/dynamodb";
import { getSessionFromRequest } from "@/lib/session";
import { fetchFromArweave } from "@/lib/irys";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const txIdParam = searchParams.get("txId");

    // 直接 TxID 模式（紧急联系人 / 离线解密）
    if (txIdParam) {
      const res = await fetchFromArweave(txIdParam);
      return NextResponse.json({
        ciphertext: await res.text(),
        tx_id: txIdParam,
        source: "arweave_direct",
      });
    }

    // 已登录模式：从 DynamoDB 读取元数据
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const vault = await getVaultByEmail(session.email);
    if (!vault || !vault.arweave_txid) {
      return NextResponse.json({ error: "未找到金库记录" }, { status: 404 });
    }

    // 从 Arweave 下载密文（自动多网关降级）
    const arweaveRes = await fetchFromArweave(vault.arweave_txid);

    return NextResponse.json({
      ciphertext: await arweaveRes.text(),
      salt: vault.crypto_salt,
      iv: vault.crypto_iv,
      key_schema: vault.key_schema ?? [],
      key_language: vault.key_language ?? "zh",
      tx_id: vault.arweave_txid,
      source: "dynamodb",
    });
  } catch (err) {
    console.error("[/api/vault/fetch]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "服务器内部错误" },
      { status: 500 }
    );
  }
}
