import { NextRequest, NextResponse } from "next/server";
import { getSessionFromHeader } from "@/lib/auth";
import { dbGet } from "@/lib/db";
import { signClaimMessage } from "@/lib/operator";

export async function POST(req: NextRequest) {
  const session = await getSessionFromHeader(req.headers.get("authorization"));
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { marketId, chainId } = await req.json();
  if (marketId === undefined || !chainId) {
    return NextResponse.json({ error: "Missing marketId or chainId" }, { status: 400 });
  }

  const { hashedUserId } = session;

  const payout = await dbGet<{ amount: number; claimed: number }>(
    "SELECT amount, claimed FROM payouts WHERE hashedUserId = ? AND marketId = ? AND chainId = ?",
    hashedUserId, marketId, chainId
  );

  if (!payout) {
    return NextResponse.json({ error: "No payout found" }, { status: 404 });
  }
  if (payout.claimed) {
    return NextResponse.json({ error: "Already claimed" }, { status: 409 });
  }

  const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour
  const signature = await signClaimMessage(
    hashedUserId,
    marketId,
    BigInt(payout.amount),
    deadline,
    chainId
  );

  return NextResponse.json({
    hashedUserId,
    marketId,
    amount: payout.amount,
    deadline,
    signature,
    chainId,
  });
}
