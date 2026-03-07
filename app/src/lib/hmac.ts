import { createHmac, timingSafeEqual } from "crypto";

const HMAC_SECRET = process.env.BACKEND_HMAC_SECRET || "dev-hmac-secret";

/**
 * Verify HMAC signature from CRE internal API requests.
 * Expected header: X-HMAC-Signature: <hex>
 * Signature = HMAC-SHA256(secret, method + path + body)
 */
export function verifyHmac(
  method: string,
  path: string,
  body: string,
  signature: string
): boolean {
  const expected = createHmac("sha256", HMAC_SECRET)
    .update(method + path + body)
    .digest("hex");

  if (expected.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

/**
 * Generate HMAC signature (for testing / CRE workflow use).
 */
export function generateHmac(method: string, path: string, body: string): string {
  return createHmac("sha256", HMAC_SECRET)
    .update(method + path + body)
    .digest("hex");
}
