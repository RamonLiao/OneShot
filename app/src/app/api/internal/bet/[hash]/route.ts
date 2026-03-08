import { NextRequest, NextResponse } from "next/server";
import { dbGet } from "@/lib/db";
import { verifyHmac } from "@/lib/hmac";

export async function GET(req: NextRequest, { params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params;
  const signature = req.headers.get("x-hmac-signature") || "";
  if (!verifyHmac("GET", `/api/internal/bet/${hash}`, "", signature)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const bet = await dbGet<Record<string, unknown>>(
    "SELECT betId, marketId, hashedUserId, ciphertextHash, ciphertext, amount, sourceChainId FROM bets WHERE ciphertextHash = ?",
    hash
  );

  if (!bet) {
    return NextResponse.json({ error: "Bet not found" }, { status: 404 });
  }

  return NextResponse.json({
    ...bet,
    ciphertext: typeof bet.ciphertext === "string"
      ? bet.ciphertext
      : Buffer.from(bet.ciphertext as Buffer).toString("base64"),
  });
}
