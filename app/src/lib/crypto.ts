import { createPublicKey, publicEncrypt, constants, createHash } from "crypto";

const CRE_PUBLIC_KEY = process.env.CRE_PUBLIC_KEY || "";

export interface BetPayload {
  optionId: number;
  amount: bigint;
  payoutChainId: string;
  payoutAddress: string;
}

/**
 * Encrypt bet payload with CRE's RSA public key.
 * Frontend does this client-side; this server version is for testing only.
 */
export function encryptForCRE(payload: BetPayload): Buffer {
  const json = JSON.stringify({
    ...payload,
    amount: payload.amount.toString(),
  });
  const key = createPublicKey(CRE_PUBLIC_KEY);
  return publicEncrypt({ key, padding: constants.RSA_PKCS1_OAEP_PADDING }, Buffer.from(json));
}

/**
 * keccak256 hash of arbitrary data, returns hex string with 0x prefix.
 */
export function keccak256(data: Buffer | string): string {
  const buf = typeof data === "string" ? Buffer.from(data) : data;
  return "0x" + createHash("sha3-256").update(buf).digest("hex");
}

/**
 * Compute ciphertextHash matching on-chain keccak256(ciphertext).
 */
export function ciphertextHash(ciphertext: Buffer): string {
  return keccak256(ciphertext);
}
