import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { getSessionFromHeader } from "@/lib/auth";
import { dbGet, dbBatch } from "@/lib/db";
import { ciphertextHash } from "@/lib/crypto";
import { sendPlaceBet, sendAllocate } from "@/lib/operator";
import { dbRun } from "@/lib/db";

export async function POST(req: NextRequest) {
  const session = await getSessionFromHeader(req.headers.get("authorization"));
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { marketId, ciphertext, amount, sourceChainId, nullifier_hash, proof, merkle_root } =
    await req.json();

  if (!ciphertext || !amount || marketId === undefined) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const { hashedUserId } = session;

  // Check market is open
  const market = await dbGet<{ status: string }>(
    "SELECT status FROM markets WHERE marketId = ?", marketId
  );
  if (!market || market.status !== "Open") {
    return NextResponse.json({ error: "Market not open" }, { status: 400 });
  }

  // Check not already bet on this market
  const existingBet = await dbGet(
    "SELECT betId FROM bets WHERE marketId = ? AND hashedUserId = ?",
    marketId, hashedUserId
  );
  if (existingBet) {
    return NextResponse.json({ error: "Already placed bet on this market" }, { status: 409 });
  }

  // Check cache balance
  const balance = await dbGet<{ deposited: number; allocated: number }>(
    "SELECT deposited, allocated FROM balances WHERE hashedUserId = ? AND chainId = ?",
    hashedUserId, sourceChainId
  );

  const available = (balance?.deposited || 0) - (balance?.allocated || 0);
  if (available < amount) {
    return NextResponse.json({ error: "Insufficient balance" }, { status: 400 });
  }

  // Store bet blindly
  const ciphertextBuf = Buffer.from(ciphertext, "base64");
  const cHash = ciphertextHash(ciphertextBuf);
  const betId = uuid();

  await dbBatch([
    {
      sql: `INSERT INTO bets (betId, marketId, hashedUserId, ciphertextHash, ciphertext, amount, sourceChainId)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [betId, marketId, hashedUserId, cHash, ciphertextBuf, amount, sourceChainId],
    },
    {
      sql: `UPDATE balances SET allocated = allocated + ? WHERE hashedUserId = ? AND chainId = ?`,
      args: [amount, hashedUserId, sourceChainId],
    },
  ]);

  // Send on-chain txs (non-blocking for UX, but we await for correctness)
  try {
    const txHash = await sendPlaceBet(
      marketId,
      hashedUserId,
      cHash,
      BigInt(amount),
      Number(sourceChainId) || 1
    );
    await dbRun("UPDATE bets SET onchainTxHash = ? WHERE betId = ?", txHash, betId);

    await sendAllocate(sourceChainId, hashedUserId, BigInt(amount));
  } catch (err) {
    console.error("On-chain tx failed:", err);
    // Bet is still recorded in DB; on-chain sync can be retried
  }

  return NextResponse.json({ betId, ciphertextHash: cHash });
}
