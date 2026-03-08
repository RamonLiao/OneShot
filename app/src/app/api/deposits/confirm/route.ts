import { NextRequest, NextResponse } from "next/server";
import { getSessionFromHeader } from "@/lib/auth";
import { dbRun, dbGet } from "@/lib/db";

export async function POST(req: NextRequest) {
  const session = await getSessionFromHeader(req.headers.get("authorization"));
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { reference, hashedUserId, amount } = await req.json();

  if (!reference || !hashedUserId || !amount) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  // Ensure the authenticated user matches the request
  if (session.hashedUserId !== hashedUserId) {
    return NextResponse.json({ error: "User mismatch" }, { status: 403 });
  }

  const chainId = "world-chain";

  // Upsert balance: increment deposited for user on world-chain
  await dbRun(
    `INSERT INTO balances (hashedUserId, chainId, deposited, allocated)
     VALUES (?, ?, ?, 0)
     ON CONFLICT(hashedUserId, chainId) DO UPDATE SET deposited = deposited + ?`,
    hashedUserId, chainId, amount, amount
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
