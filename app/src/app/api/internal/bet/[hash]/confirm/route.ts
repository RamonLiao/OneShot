import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyHmac } from "@/lib/hmac";

export async function POST(req: NextRequest, { params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params;
  const body = await req.text();
  const signature = req.headers.get("x-hmac-signature") || "";

  if (!verifyHmac("POST", `/api/internal/bet/${hash}/confirm`, body, signature)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDb();
  const result = db
    .prepare("UPDATE bets SET creConfirmed = 1 WHERE ciphertextHash = ?")
    .run(hash);

  if (result.changes === 0) {
    return NextResponse.json({ error: "Bet not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
