/**
 * CRE Settlement Workflow (Workflow 2 — CORE)
 *
 * Trigger: EVM Log (MarketRegistry.MarketSettled)
 * Flow:
 *   1. Confidential HTTP → GET /api/internal/bets?marketId={id}
 *   2. TEE: decrypt each bet, verify ciphertextHash matches on-chain
 *   3. TEE: calculate payouts by market type
 *   4. Multi-chain writeReport to each Vault: recordPayout()
 *   5. Update control chain: markFullySettled()
 *
 * This file defines the workflow logic. The actual CRE SDK integration
 * depends on the @chainlink/cre-sdk API which needs to be validated
 * against the installed version.
 */

import { decryptBet, verifyCiphertextHash } from "../lib/decrypt";
import { calculatePayouts, type DecryptedBet, type PayoutEntry } from "../lib/payout";

export interface RawBet {
  betId: string;
  marketId: number;
  hashedUserId: string;
  ciphertextHash: string;
  ciphertext: string; // base64
  amount: number;
  sourceChainId: string;
}

export interface SettlementInput {
  marketId: number;
  marketType: "Binary" | "Categorical" | "Scalar";
  resultValue: bigint;
  bets: RawBet[];
  privateKey: string; // CRE secret: decryption private key
  hmacSecret: string; // CRE secret: HMAC for internal API auth
  backendUrl: string;
}

export interface SettlementResult {
  marketId: number;
  payouts: PayoutEntry[];
  invalidBets: string[]; // betIds that failed hash verification
}

/**
 * Core settlement logic that runs inside the TEE.
 *
 * 1. Decrypt all bets
 * 2. Verify each ciphertext hash matches on-chain hash
 * 3. Calculate payouts
 * 4. Return payout instructions for multi-chain write
 */
export function settle(input: SettlementInput): SettlementResult {
  const decryptedBets: DecryptedBet[] = [];
  const invalidBets: string[] = [];

  for (const raw of input.bets) {
    // Verify ciphertext hash matches what's on-chain
    if (!verifyCiphertextHash(raw.ciphertext, raw.ciphertextHash)) {
      invalidBets.push(raw.betId);
      continue;
    }

    try {
      const decrypted = decryptBet(raw.ciphertext, input.privateKey);
      // Override hashedUserId from the on-chain record (trust chain, not ciphertext)
      decrypted.hashedUserId = raw.hashedUserId;
      decryptedBets.push(decrypted);
    } catch {
      invalidBets.push(raw.betId);
    }
  }

  const payouts = calculatePayouts(input.marketType, decryptedBets, input.resultValue);

  return {
    marketId: input.marketId,
    payouts,
    invalidBets,
  };
}

/**
 * Group payouts by chain for multi-chain write.
 */
export function groupPayoutsByChain(
  payouts: PayoutEntry[]
): Record<string, PayoutEntry[]> {
  const groups: Record<string, PayoutEntry[]> = {};
  for (const p of payouts) {
    if (!groups[p.payoutChainId]) {
      groups[p.payoutChainId] = [];
    }
    groups[p.payoutChainId].push(p);
  }
  return groups;
}
