import { NextRequest, NextResponse } from "next/server";
import { getSessionFromHeader } from "@/lib/auth";
import { dbRun, dbGet } from "@/lib/db";

/**
 * Mock deposit — credits balance without real on-chain transfer.
 * Only enabled when MOCK_DEPOSIT=true on the server.
 */
export async function POST(req: NextRequest) {
  if (process.env.MOCK_DEPOSIT !== "true") {
    return NextResponse.json({ error: "Mock deposits disabled" }, { status: 403 });
  }

  const session = await getSessionFromHeader(req.headers.get("authorization"));
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { amount } = await req.json();
  const amountNum = Number(amount);
  if (!amountNum || amountNum <= 0 || amountNum > 1_000_000_000) {
    return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
  }

  const { hashedUserId } = session;
  const chainId = "world-chain";

  await dbRun(
    `INSERT INTO balances (hashedUserId, chainId, deposited, allocated)
     VALUES (?, ?, ?, 0)
     ON CONFLICT(hashedUserId, chainId) DO UPDATE SET deposited = deposited + ?`,
    hashedUserId, chainId, amountNum, amountNum
  );

  const row = await dbGet<{ deposited: number; allocated: number }>(
    "SELECT deposited, allocated FROM balances WHERE hashedUserId = ? AND chainId = ?",
    hashedUserId, chainId
  );

  return NextResponse.json({
    success: true,
    newBalance: (row?.deposited || 0) - (row?.allocated || 0),
  });
}
