import { NextRequest, NextResponse } from "next/server";
import { getSessionFromHeader } from "@/lib/auth";
import { getDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await getSessionFromHeader(req.headers.get("authorization"));
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDb();
  const { hashedUserId } = session;

  const bets = db
    .prepare(
      `SELECT b.betId, b.marketId, b.amount, b.sourceChainId, b.creConfirmed, b.createdAt,
              m.question, m.status as marketStatus, m.resultValue
       FROM bets b
       JOIN markets m ON m.marketId = b.marketId
       WHERE b.hashedUserId = ?
       ORDER BY b.createdAt DESC`
    )
    .all(hashedUserId);

  const payouts = db
    .prepare(
      `SELECT p.marketId, p.chainId, p.amount, p.claimed, p.claimTxHash,
              m.question
       FROM payouts p
       JOIN markets m ON m.marketId = p.marketId
       WHERE p.hashedUserId = ?`
    )
    .all(hashedUserId);

  const balances = db
    .prepare("SELECT chainId, deposited, allocated FROM balances WHERE hashedUserId = ?")
    .all(hashedUserId);

  return NextResponse.json({ bets, payouts, balances });
}
