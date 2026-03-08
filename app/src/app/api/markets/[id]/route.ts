import { NextRequest, NextResponse } from "next/server";
import { dbGet } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const market = await dbGet<Record<string, unknown>>(
    `SELECT m.marketId, m.question, m.options, m.marketType, m.status, m.closeTime,
            m.resultValue, m.oracleApiUrl, m.scalarLow, m.scalarHigh,
            COUNT(b.betId) as totalBets,
            COALESCE(SUM(b.amount), 0) as totalVolume
     FROM markets m
     LEFT JOIN bets b ON b.marketId = m.marketId
     WHERE m.marketId = ?
     GROUP BY m.marketId`,
    Number(id)
  );

  if (!market) {
    return NextResponse.json({ error: "Market not found" }, { status: 404 });
  }

  return NextResponse.json({
    ...market,
    options: JSON.parse(market.options as string),
  });
}
