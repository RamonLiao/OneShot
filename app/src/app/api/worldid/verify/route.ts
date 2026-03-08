import { NextRequest, NextResponse } from "next/server";
import { deriveHashedUserId, createSession } from "@/lib/auth";
import { dbRun } from "@/lib/db";

const WORLD_APP_ID = process.env.WORLD_APP_ID || "";

export async function POST(req: NextRequest) {
  const { nullifier_hash, proof, merkle_root, verification_level, action } = await req.json();

  if (!nullifier_hash || !proof || !merkle_root) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  // Verify with World ID API — app_id goes in the URL path
  const verifyUrl = `https://developer.worldcoin.org/api/v2/verify/${WORLD_APP_ID}`;
  const verifyRes = await fetch(verifyUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nullifier_hash,
      proof,
      merkle_root,
      verification_level: verification_level || "orb",
      action: action || "privapoll-auth",
    }),
  });

  if (!verifyRes.ok) {
    const err = await verifyRes.json().catch(() => ({}));
    console.error("[worldid] verify failed:", verifyRes.status, err);
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
