import { NextRequest, NextResponse } from "next/server";
import { deriveHashedUserId, createSession } from "@/lib/auth";
import { dbRun } from "@/lib/db";
import { randomUUID } from "crypto";

const APP_ID = process.env.WORLD_APP_ID || "";
const RP_ID = process.env.WORLD_RP_ID || "";

export async function POST(req: NextRequest) {
  const { nullifier_hash, proof, merkle_root, verification_level, action } = await req.json();

  if (!nullifier_hash || !proof || !merkle_root) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const rpId = RP_ID || APP_ID;
  const verifyUrl = `https://developer.world.org/api/v4/verify/${rpId}`;

  // Map verification_level to identifier (orb, device, etc.)
  const identifier = verification_level || "orb";

  const verifyRes = await fetch(verifyUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      protocol_version: "3.0",
      nonce: randomUUID(),
      action: action || "privapoll-auth",
      environment: "production",
      responses: [
        {
          identifier,
          merkle_root,
          nullifier: nullifier_hash,
          proof,
        },
      ],
    }),
  });

  if (!verifyRes.ok) {
    const err = await verifyRes.json().catch(() => ({}));
    const detail = `status=${verifyRes.status} rp=${rpId} code=${err?.code || "?"} msg=${err?.message || err?.detail || JSON.stringify(err)}`;
    console.error("[worldid] v4 verify failed:", detail);
    return NextResponse.json({ error: detail }, { status: 401 });
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
