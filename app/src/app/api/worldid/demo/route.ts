import { NextResponse } from "next/server";
import { deriveHashedUserId, createSession } from "@/lib/auth";
import { dbRun } from "@/lib/db";
import { randomUUID } from "crypto";

/**
 * Demo login — generates a test session without World ID verification.
 * Each browser gets a unique but stable identity (based on random UUID).
 */
export async function POST() {
  // Generate a deterministic-looking nullifier for the demo user
  const demoNullifier = `demo_${randomUUID()}`;

  const hashedUserId = deriveHashedUserId(demoNullifier);
  const sessionExpiry = Math.floor(Date.now() / 1000) + 86400;

  await dbRun(
    `INSERT INTO users (hashedUserId, sessionExpiry) VALUES (?, ?)
     ON CONFLICT(hashedUserId) DO UPDATE SET sessionExpiry = ?`,
    hashedUserId,
    sessionExpiry,
    sessionExpiry,
  );

  const token = await createSession(hashedUserId);

  let crePublicKey = process.env.CRE_PUBLIC_KEY || "";
  if (crePublicKey.startsWith("LS0tLS")) {
    crePublicKey = Buffer.from(crePublicKey, "base64").toString("utf-8");
  }
  crePublicKey = crePublicKey
    .replace(/-----BEGIN [A-Z ]+-----/g, "")
    .replace(/-----END [A-Z ]+-----/g, "")
    .replace(/\s+/g, "");

  return NextResponse.json({ token, hashedUserId, crePublicKey });
}
