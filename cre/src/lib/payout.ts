export interface DecryptedBet {
  hashedUserId: string;
  optionId: number;
  scalarValue?: number;
  amount: bigint;
  payoutChainId: string;
  payoutAddress: string;
}

export interface PayoutEntry {
  hashedUserId: string;
  amount: bigint;
  payoutChainId: string;
  payoutAddress: string;
}

type MarketType = "Binary" | "Categorical" | "Scalar";

/**
 * Calculate payouts for a settled market.
 *
 * Binary/Categorical: Winners share the entire pool proportional to their bet amount.
 *   If no winners, everyone gets refunded.
 *
 * Scalar: Inverse-distance weighted distribution.
 *   Closer guesses to the result get proportionally more of the pool.
 *   If all guesses are the same distance, everyone gets refunded.
 */
export function calculatePayouts(
  marketType: MarketType,
  bets: DecryptedBet[],
  resultValue: bigint
): PayoutEntry[] {
  if (bets.length === 0) return [];

  if (marketType === "Binary" || marketType === "Categorical") {
    return calculateProportionalPayouts(bets, resultValue);
  }
  return calculateScalarPayouts(bets, resultValue);
}

function calculateProportionalPayouts(
  bets: DecryptedBet[],
  winningOption: bigint
): PayoutEntry[] {
  const totalPool = bets.reduce((sum, b) => sum + b.amount, 0n);
  const winners = bets.filter((b) => BigInt(b.optionId) === winningOption);

  // No winners or all winners -> refund everyone
  if (winners.length === 0 || winners.length === bets.length) {
    return bets.map((b) => ({
      hashedUserId: b.hashedUserId,
      amount: b.amount,
      payoutChainId: b.payoutChainId,
      payoutAddress: b.payoutAddress,
    }));
  }

  const winnerPool = winners.reduce((sum, b) => sum + b.amount, 0n);

  // Distribute total pool proportionally among winners
  // Use floor division, give remainder to last winner
  const payouts: PayoutEntry[] = [];
  let distributed = 0n;

  for (let i = 0; i < winners.length; i++) {
    const w = winners[i];
    let payout: bigint;

    if (i === winners.length - 1) {
      // Last winner gets remainder to ensure total = pool
      payout = totalPool - distributed;
    } else {
      payout = (w.amount * totalPool) / winnerPool;
      distributed += payout;
    }

    payouts.push({
      hashedUserId: w.hashedUserId,
      amount: payout,
      payoutChainId: w.payoutChainId,
      payoutAddress: w.payoutAddress,
    });
  }

  return payouts;
}

function calculateScalarPayouts(
  bets: DecryptedBet[],
  resultValue: bigint
): PayoutEntry[] {
  const totalPool = bets.reduce((sum, b) => sum + b.amount, 0n);

  // Calculate distances
  const distances = bets.map((b) => {
    const guess = b.scalarValue != null ? BigInt(b.scalarValue) : BigInt(b.optionId);
    const diff = guess - resultValue;
    return diff < 0n ? -diff : diff;
  });

  const maxDistance = distances.reduce((a, b) => (a > b ? a : b), 0n);

  // All same distance (including all exact) -> refund
  const allSame = distances.every((d) => d === distances[0]);
  if (allSame) {
    return bets.map((b) => ({
      hashedUserId: b.hashedUserId,
      amount: b.amount,
      payoutChainId: b.payoutChainId,
      payoutAddress: b.payoutAddress,
    }));
  }

  // Inverse distance weights: weight = (maxDistance - distance)
  // This gives 0 weight to the farthest, maxDistance weight to exact
  const weights = distances.map((d) => maxDistance - d);
  const totalWeight = weights.reduce((sum, w) => sum + w, 0n);

  const payouts: PayoutEntry[] = [];
  let distributed = 0n;

  for (let i = 0; i < bets.length; i++) {
    const b = bets[i];
    let payout: bigint;

    if (i === bets.length - 1) {
      payout = totalPool - distributed;
    } else {
      payout = (weights[i] * totalPool) / totalWeight;
      distributed += payout;
    }

    payouts.push({
      hashedUserId: b.hashedUserId,
      amount: payout,
      payoutChainId: b.payoutChainId,
      payoutAddress: b.payoutAddress,
    });
  }

  return payouts;
}
