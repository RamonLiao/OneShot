import { NextRequest, NextResponse } from "next/server";
import { getSessionFromHeader } from "@/lib/auth";
import { dbGet, dbRun, dbBatch } from "@/lib/db";

/** GET — check if user has a bet on this market */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ marketId: string }> },
) {
  const { marketId } = await params;
  const session = await getSessionFromHeader(req.headers.get("authorization"));
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const bet = await dbGet<{
    betId: string;
    amount: number;
    sourceChainId: string;
    createdAt: number;
  }>(
    "SELECT betId, amount, sourceChainId, createdAt FROM bets WHERE marketId = ? AND hashedUserId = ?",
    Number(marketId),
    session.hashedUserId,
  );

  if (!bet) {
    return NextResponse.json({ hasBet: false });
  }

  return NextResponse.json({ hasBet: true, bet });
}

/** DELETE — cancel bet and refund balance (only if market still open) */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ marketId: string }> },
) {
  const { marketId } = await params;
  const session = await getSessionFromHeader(req.headers.get("authorization"));
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const market = await dbGet<{ status: string }>(
    "SELECT status FROM markets WHERE marketId = ?",
    Number(marketId),
  );
  if (!market || market.status !== "Open") {
    return NextResponse.json({ error: "Market is no longer open" }, { status: 400 });
  }

  const bet = await dbGet<{ betId: string; amount: number; sourceChainId: string }>(
    "SELECT betId, amount, sourceChainId FROM bets WHERE marketId = ? AND hashedUserId = ?",
    Number(marketId),
    session.hashedUserId,
  );
  if (!bet) {
    return NextResponse.json({ error: "No bet found" }, { status: 404 });
  }

  // Delete bet and refund allocated balance
  await dbBatch([
    {
      sql: "DELETE FROM bets WHERE betId = ?",
      args: [bet.betId],
    },
    {
      sql: "UPDATE balances SET allocated = allocated - ? WHERE hashedUserId = ? AND chainId = ?",
      args: [bet.amount, session.hashedUserId, bet.sourceChainId],
    },
  ]);

  return NextResponse.json({ success: true, refunded: bet.amount });
}
