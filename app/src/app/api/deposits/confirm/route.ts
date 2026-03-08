import { NextRequest, NextResponse } from "next/server";
import { getSessionFromHeader } from "@/lib/auth";
import { getDb } from "@/lib/db";

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

  const db = getDb();
  const chainId = "world-chain";

  // Upsert balance: increment deposited for user on world-chain
  db.prepare(
    `INSERT INTO balances (hashedUserId, chainId, deposited, allocated)
     VALUES (?, ?, ?, 0)
     ON CONFLICT(hashedUserId, chainId) DO UPDATE SET deposited = deposited + ?`
  ).run(hashedUserId, chainId, amount, amount);

  const row = db
    .prepare("SELECT deposited, allocated FROM balances WHERE hashedUserId = ? AND chainId = ?")
    .get(hashedUserId, chainId) as { deposited: number; allocated: number };

  return NextResponse.json({
    success: true,
    newBalance: row.deposited - row.allocated,
  });
}
