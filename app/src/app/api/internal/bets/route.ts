import { NextRequest, NextResponse } from "next/server";
import { dbAll } from "@/lib/db";
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

  const bets = await dbAll<Record<string, unknown>>(
    "SELECT betId, marketId, hashedUserId, ciphertextHash, ciphertext, amount, sourceChainId FROM bets WHERE marketId = ?",
    Number(marketId)
  );

  const parsed = bets.map((row) => ({
    ...row,
    ciphertext: typeof row.ciphertext === "string"
      ? row.ciphertext
      : Buffer.from(row.ciphertext as Buffer).toString("base64"),
  }));

  return NextResponse.json({ bets: parsed });
}
