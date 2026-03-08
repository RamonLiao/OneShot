import { NextResponse } from "next/server";
import { dbAll } from "@/lib/db";

export async function GET() {
  const markets = await dbAll<Record<string, unknown>>(
    `SELECT m.marketId, m.question, m.options, m.marketType, m.status, m.closeTime,
            m.resultValue, m.oracleApiUrl,
            COUNT(b.betId) as totalBets,
            COALESCE(SUM(b.amount), 0) as totalVolume
     FROM markets m
     LEFT JOIN bets b ON b.marketId = m.marketId
     GROUP BY m.marketId
     ORDER BY m.closeTime DESC`
  );

  const parsed = markets.map((row) => ({
    ...row,
    options: JSON.parse(row.options as string),
  }));

  return NextResponse.json({ markets: parsed });
}
