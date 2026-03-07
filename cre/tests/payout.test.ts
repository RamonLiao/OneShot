import { describe, it, expect } from "vitest";
import { calculatePayouts, type DecryptedBet } from "../src/lib/payout";

describe("calculatePayouts", () => {
  const makeBet = (
    userId: string,
    optionId: number,
    amount: bigint,
    chainId = "base-sepolia",
    addr = "0x1234"
  ): DecryptedBet => ({
    hashedUserId: userId,
    optionId,
    amount,
    payoutChainId: chainId,
    payoutAddress: addr,
  });

  describe("Binary", () => {
    it("winners split pool proportionally", () => {
      const bets = [
        makeBet("u1", 1, 100n),
        makeBet("u2", 1, 300n),
        makeBet("u3", 0, 600n),
      ];
      const payouts = calculatePayouts("Binary", bets, 1n);
      expect(payouts).toHaveLength(2);
      expect(payouts.find((p) => p.hashedUserId === "u1")?.amount).toBe(250n);
      expect(payouts.find((p) => p.hashedUserId === "u2")?.amount).toBe(750n);
    });

    it("no winners = refund all", () => {
      const bets = [makeBet("u1", 0, 100n), makeBet("u2", 0, 200n)];
      const payouts = calculatePayouts("Binary", bets, 1n);
      expect(payouts).toHaveLength(2);
      expect(payouts.find((p) => p.hashedUserId === "u1")?.amount).toBe(100n);
      expect(payouts.find((p) => p.hashedUserId === "u2")?.amount).toBe(200n);
    });

    it("all winners = return own bets", () => {
      const bets = [makeBet("u1", 1, 100n), makeBet("u2", 1, 300n)];
      const payouts = calculatePayouts("Binary", bets, 1n);
      expect(payouts).toHaveLength(2);
      expect(payouts.find((p) => p.hashedUserId === "u1")?.amount).toBe(100n);
      expect(payouts.find((p) => p.hashedUserId === "u2")?.amount).toBe(300n);
    });

    it("single bet = refund", () => {
      const bets = [makeBet("u1", 0, 500n)];
      const payouts = calculatePayouts("Binary", bets, 1n);
      expect(payouts).toHaveLength(1);
      expect(payouts[0].amount).toBe(500n);
    });

    it("empty bets = empty payouts", () => {
      const payouts = calculatePayouts("Binary", [], 1n);
      expect(payouts).toHaveLength(0);
    });

    it("preserves payout chain and address", () => {
      const bets = [
        makeBet("u1", 1, 100n, "arbitrum-sepolia", "0xAAA"),
        makeBet("u2", 0, 100n, "base-sepolia", "0xBBB"),
      ];
      const payouts = calculatePayouts("Binary", bets, 1n);
      const p1 = payouts.find((p) => p.hashedUserId === "u1")!;
      expect(p1.payoutChainId).toBe("arbitrum-sepolia");
      expect(p1.payoutAddress).toBe("0xAAA");
    });

    it("total payout equals total pool", () => {
      const bets = [
        makeBet("u1", 1, 137n),
        makeBet("u2", 1, 263n),
        makeBet("u3", 0, 600n),
      ];
      const payouts = calculatePayouts("Binary", bets, 1n);
      const totalPayout = payouts.reduce((sum, p) => sum + p.amount, 0n);
      const totalPool = bets.reduce((sum, b) => sum + b.amount, 0n);
      expect(totalPayout).toBe(totalPool);
    });
  });

  describe("Categorical", () => {
    it("works like binary with multiple options", () => {
      const bets = [
        makeBet("u1", 0, 100n),
        makeBet("u2", 1, 200n),
        makeBet("u3", 2, 300n),
        makeBet("u4", 1, 100n),
      ];
      // Winner is option 1, winners are u2 (200) and u4 (100)
      const payouts = calculatePayouts("Categorical", bets, 1n);
      const totalPool = 700n;
      // u2 gets 200/300 * 700 = 466n (floor), u4 gets 100/300 * 700 = 233n
      const p2 = payouts.find((p) => p.hashedUserId === "u2")!;
      const p4 = payouts.find((p) => p.hashedUserId === "u4")!;
      expect(p2.amount + p4.amount).toBe(totalPool);
      expect(p2.amount).toBeGreaterThan(p4.amount);
    });
  });

  describe("Scalar", () => {
    it("closer guess gets more", () => {
      const bets = [makeBet("u1", 100, 500n), makeBet("u2", 110, 500n)];
      const payouts = calculatePayouts("Scalar", bets, 100n);
      const p1 = payouts.find((p) => p.hashedUserId === "u1")!;
      const p2 = payouts.find((p) => p.hashedUserId === "u2")!;
      expect(p1.amount).toBeGreaterThan(p2.amount);
      expect(p1.amount + p2.amount).toBe(1000n);
    });

    it("exact guess gets everything in 2-player", () => {
      const bets = [makeBet("u1", 50, 500n), makeBet("u2", 100, 500n)];
      const payouts = calculatePayouts("Scalar", bets, 50n);
      const p1 = payouts.find((p) => p.hashedUserId === "u1")!;
      const p2 = payouts.find((p) => p.hashedUserId === "u2")!;
      expect(p1.amount).toBe(1000n);
      expect(p2.amount).toBe(0n);
    });

    it("all same guess = refund", () => {
      const bets = [makeBet("u1", 75, 300n), makeBet("u2", 75, 200n)];
      const payouts = calculatePayouts("Scalar", bets, 100n);
      expect(payouts.find((p) => p.hashedUserId === "u1")?.amount).toBe(300n);
      expect(payouts.find((p) => p.hashedUserId === "u2")?.amount).toBe(200n);
    });
  });
});
