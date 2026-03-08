import { NextRequest, NextResponse } from "next/server";
import { dbAll } from "@/lib/db";
import { verifyHmac } from "@/lib/hmac";

export async function GET(req: NextRequest) {
  const signature = req.headers.get("x-hmac-signature") || "";

  if (!verifyHmac("GET", "/api/internal/pending-settlements", "", signature)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const markets = await dbAll<Record<string, unknown>>(
    `SELECT marketId, question, options, marketType, closeTime, oracleApiUrl
     FROM markets
     WHERE status = 'Open'
       AND oracleApiUrl IS NOT NULL
       AND oracleApiUrl != ''
       AND closeTime <= unixepoch()`
  );

  const parsed = markets.map((row) => ({
    ...row,
    options: JSON.parse(row.options as string),
  }));

  return NextResponse.json({ markets: parsed });
}
