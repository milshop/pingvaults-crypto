import { NextRequest, NextResponse } from "next/server";
import { getStorageStatus, isStorageTxId } from "@/lib/storage-status";

// Legacy URL retained. Version 2 reports observations, never an estimated settlement time.
const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" };
export async function GET(request: NextRequest) {
  const txId = request.nextUrl.searchParams.get("txId");
  if (!isStorageTxId(txId)) return NextResponse.json({ error: "Invalid txId" }, { status: 400, headers });
  return NextResponse.json(await getStorageStatus(txId, { signal: request.signal }), { headers });
}
