import { NextRequest, NextResponse } from "next/server";
import { getSessionFromHeader } from "@/lib/auth";
import { dbAll } from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await getSessionFromHeader(req.headers.get("authorization"));
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { hashedUserId } = session;

  const bets = await dbAll(
    `SELECT b.betId, b.marketId, b.amount, b.sourceChainId, b.creConfirmed, b.createdAt,
            m.question, m.status as marketStatus, m.resultValue
     FROM bets b
     JOIN markets m ON m.marketId = b.marketId
     WHERE b.hashedUserId = ?
     ORDER BY b.createdAt DESC`,
    hashedUserId
  );

  const payouts = await dbAll(
    `SELECT p.marketId, p.chainId, p.amount, p.claimed, p.claimTxHash,
            m.question
     FROM payouts p
     JOIN markets m ON m.marketId = p.marketId
     WHERE p.hashedUserId = ?`,
    hashedUserId
  );

  const balances = await dbAll(
    "SELECT chainId, deposited, allocated FROM balances WHERE hashedUserId = ?",
    hashedUserId
  );

  return NextResponse.json({ bets, payouts, balances });
}
