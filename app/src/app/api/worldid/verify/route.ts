import { NextRequest, NextResponse } from "next/server";
import { verifyCloudProof, type ISuccessResult } from "@worldcoin/minikit-js";
import { deriveHashedUserId, createSession } from "@/lib/auth";
import { dbRun } from "@/lib/db";

const APP_ID = (process.env.WORLD_APP_ID || "") as `app_${string}`;

export async function POST(req: NextRequest) {
  const { nullifier_hash, proof, merkle_root, verification_level, action } = await req.json();

  if (!nullifier_hash || !proof || !merkle_root) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  try {
    const verifyRes = await verifyCloudProof(
      {
        proof,
        merkle_root,
        nullifier_hash,
        verification_level,
      } as ISuccessResult,
      APP_ID,
      action || "privapoll-auth",
    );

    if (!verifyRes.success) {
      return NextResponse.json(
        { error: `verify failed: ${verifyRes.code} ${verifyRes.detail}` },
        { status: 401 },
      );
    }
  } catch (err) {
    return NextResponse.json(
      { error: `verify exception: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
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
