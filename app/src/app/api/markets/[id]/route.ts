import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();

  const market = db
    .prepare(
      `SELECT m.marketId, m.question, m.options, m.marketType, m.status, m.closeTime,
              m.resultValue, m.oracleApiUrl,
              COUNT(b.betId) as totalBets,
              COALESCE(SUM(b.amount), 0) as totalVolume
       FROM markets m
       LEFT JOIN bets b ON b.marketId = m.marketId
       WHERE m.marketId = ?
       GROUP BY m.marketId`
    )
    .get(Number(id)) as Record<string, unknown> | undefined;

  if (!market) {
    return NextResponse.json({ error: "Market not found" }, { status: 404 });
  }

  return NextResponse.json({
    ...market,
    options: JSON.parse(market.options as string),
  });
}
