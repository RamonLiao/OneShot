import { NextRequest, NextResponse } from "next/server";
import { getSessionFromHeader } from "@/lib/auth";
import { dbAll } from "@/lib/db";

/** Returns marketIds + amounts for user's active bets */
export async function GET(req: NextRequest) {
  const session = await getSessionFromHeader(req.headers.get("authorization"));
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const bets = await dbAll<{ marketId: number; amount: number }>(
    "SELECT marketId, amount FROM bets WHERE hashedUserId = ?",
    session.hashedUserId,
  );

  return NextResponse.json({ bets });
}
