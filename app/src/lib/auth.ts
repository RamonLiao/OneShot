import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { createHash } from "crypto";

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || "dev-secret");
const APP_SALT = process.env.APP_SALT || "privapoll-salt-v1";

export interface SessionPayload extends JWTPayload {
  hashedUserId: string;
}

/**
 * Derive hashedUserId from World ID nullifier_hash.
 * userId = keccak256(nullifier_hash || app_salt)
 * hashedUserId = keccak256(userId)
 */
export function deriveHashedUserId(nullifierHash: string): string {
  const userId = createHash("sha3-256")
    .update(nullifierHash + APP_SALT)
    .digest("hex");
  return "0x" + createHash("sha3-256").update(userId).digest("hex");
}

/**
 * Create a JWT session token for a verified user.
 */
export async function createSession(hashedUserId: string): Promise<string> {
  return new SignJWT({ hashedUserId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(JWT_SECRET);
}

/**
 * Verify and decode a JWT session token.
 */
export async function verifySession(token: string): Promise<SessionPayload> {
  const { payload } = await jwtVerify(token, JWT_SECRET);
  return payload as SessionPayload;
}

/**
 * Extract session from Authorization header.
 */
export async function getSessionFromHeader(
  authHeader: string | null
): Promise<SessionPayload | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  try {
    return await verifySession(authHeader.slice(7));
  } catch {
    return null;
  }
}
