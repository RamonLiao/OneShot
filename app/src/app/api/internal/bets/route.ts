import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyHmac } from "@/lib/hmac";

export async function GET(req: NextRequest) {
  const marketId = req.nextUrl.searchParams.get("marketId");
  const signature = req.headers.get("x-hmac-signature") || "";
  const path = `/api/internal/bets?marketId=${marketId}`;

  if (!verifyHmac("GET", path, "", signature)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!marketId) {
    return NextResponse.json({ error: "Missing marketId" }, { status: 400 });
  }

  const db = getDb();
  const bets = db
    .prepare(
      "SELECT betId, marketId, hashedUserId, ciphertextHash, ciphertext, amount, sourceChainId FROM bets WHERE marketId = ?"
    )
    .all(Number(marketId)) as Record<string, unknown>[];

  const parsed = bets.map((row) => ({
    ...row,
    ciphertext: Buffer.from(row.ciphertext as Buffer).toString("base64"),
  }));

  return NextResponse.json({ bets: parsed });
}
