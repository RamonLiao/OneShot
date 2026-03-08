import { privateDecrypt, constants } from "crypto";
import type { DecryptedBet } from "./payout";

/**
 * Decrypt a single bet ciphertext using the CRE private key.
 * This runs inside the TEE — the private key never leaves the enclave.
 */
export function decryptBet(
  ciphertextBase64: string,
  privateKeyPem: string
): DecryptedBet {
  const ciphertext = Buffer.from(ciphertextBase64, "base64");

  const decrypted = privateDecrypt(
    { key: privateKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    ciphertext
  );

  const parsed = JSON.parse(decrypted.toString("utf-8"));

  return {
    hashedUserId: parsed.hashedUserId || "",
    optionId: Number(parsed.optionId ?? 0),
    ...(parsed.scalarValue != null && { scalarValue: Number(parsed.scalarValue) }),
    amount: BigInt(parsed.amount),
    payoutChainId: parsed.payoutChainId,
    payoutAddress: parsed.payoutAddress,
  };
}

/**
 * Verify that a ciphertext matches its on-chain hash.
 * Uses keccak256 (sha3-256) to match Solidity's keccak256().
 */
export function verifyCiphertextHash(
  ciphertextBase64: string,
  expectedHash: string
): boolean {
  const { createHash } = require("crypto");
  const ciphertext = Buffer.from(ciphertextBase64, "base64");
  const hash = "0x" + createHash("sha3-256").update(ciphertext).digest("hex");
  return hash === expectedHash;
}
