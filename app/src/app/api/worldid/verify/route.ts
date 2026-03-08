import { NextRequest, NextResponse } from "next/server";
import { deriveHashedUserId, createSession } from "@/lib/auth";
import { dbRun } from "@/lib/db";

const WORLD_APP_ID = process.env.WORLD_APP_ID || "";
const WORLD_VERIFY_URL = "https://developer.worldcoin.org/api/v2/verify";

export async function POST(req: NextRequest) {
  const { nullifier_hash, proof, merkle_root, verification_level, action } = await req.json();

  if (!nullifier_hash || !proof || !merkle_root) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  // Verify with World ID API
  const verifyRes = await fetch(WORLD_VERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nullifier_hash,
      proof,
      merkle_root,
      verification_level: verification_level || "orb",
      action: action || "privapoll-auth",
      app_id: WORLD_APP_ID,
    }),
  });

  if (!verifyRes.ok) {
    const err = await verifyRes.json().catch(() => ({}));
    return NextResponse.json({ error: "World ID verification failed", detail: err }, { status: 401 });
  }

  const hashedUserId = deriveHashedUserId(nullifier_hash);
  const sessionExpiry = Math.floor(Date.now() / 1000) + 86400;

  await dbRun(
    `INSERT INTO users (hashedUserId, sessionExpiry) VALUES (?, ?)
     ON CONFLICT(hashedUserId) DO UPDATE SET sessionExpiry = ?`,
    hashedUserId, sessionExpiry, sessionExpiry
  );

  const token = await createSession(hashedUserId);
  const crePublicKey = process.env.CRE_PUBLIC_KEY || "";

  return NextResponse.json({ token, hashedUserId, crePublicKey });
}
