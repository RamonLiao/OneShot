import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { getSessionFromHeader } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { ciphertextHash } from "@/lib/crypto";
import { sendPlaceBet, sendAllocate } from "@/lib/operator";

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

  const db = getDb();
  const { hashedUserId } = session;

  // Check market is open
  const market = db.prepare("SELECT status FROM markets WHERE marketId = ?").get(marketId) as
    | { status: string }
    | undefined;
  if (!market || market.status !== "Open") {
    return NextResponse.json({ error: "Market not open" }, { status: 400 });
  }

  // Check not already bet on this market
  const existingBet = db
    .prepare("SELECT betId FROM bets WHERE marketId = ? AND hashedUserId = ?")
    .get(marketId, hashedUserId);
  if (existingBet) {
    return NextResponse.json({ error: "Already placed bet on this market" }, { status: 409 });
  }

  // Check cache balance
  const balance = db
    .prepare("SELECT deposited, allocated FROM balances WHERE hashedUserId = ? AND chainId = ?")
    .get(hashedUserId, sourceChainId) as { deposited: number; allocated: number } | undefined;

  const available = (balance?.deposited || 0) - (balance?.allocated || 0);
  if (available < amount) {
    return NextResponse.json({ error: "Insufficient balance" }, { status: 400 });
  }

  // Store bet blindly
  const ciphertextBuf = Buffer.from(ciphertext, "base64");
  const cHash = ciphertextHash(ciphertextBuf);
  const betId = uuid();

  const insertBet = db.prepare(
    `INSERT INTO bets (betId, marketId, hashedUserId, ciphertextHash, ciphertext, amount, sourceChainId)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  const updateBalance = db.prepare(
    `UPDATE balances SET allocated = allocated + ? WHERE hashedUserId = ? AND chainId = ?`
  );

  const txn = db.transaction(() => {
    insertBet.run(betId, marketId, hashedUserId, cHash, ciphertextBuf, amount, sourceChainId);
    updateBalance.run(amount, hashedUserId, sourceChainId);
  });
  txn();

  // Send on-chain txs (non-blocking for UX, but we await for correctness)
  try {
    const txHash = await sendPlaceBet(
      marketId,
      hashedUserId,
      cHash,
      BigInt(amount),
      Number(sourceChainId) || 1
    );
    db.prepare("UPDATE bets SET onchainTxHash = ? WHERE betId = ?").run(txHash, betId);

    await sendAllocate(sourceChainId, hashedUserId, BigInt(amount));
  } catch (err) {
    console.error("On-chain tx failed:", err);
    // Bet is still recorded in DB; on-chain sync can be retried
  }

  return NextResponse.json({ betId, ciphertextHash: cHash });
}
