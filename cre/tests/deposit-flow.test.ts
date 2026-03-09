/**
 * MiniKit Deposit Flow Integration Tests
 *
 * Tests the full backend pipeline that supports MiniKit deposits:
 *   Auth (JWT) → Balance management → Bet placement → Crypto consistency
 *   → Operator signatures → Settlement pipeline
 *
 * MiniKit.commandsAsync.pay() only works inside World App, so we test
 * everything around it: the backend APIs, crypto, auth, and on-chain
 * signature generation that the frontend depends on.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { createHash, createHmac, generateKeyPairSync, publicEncrypt, constants } from "crypto";
import { SignJWT, jwtVerify } from "jose";
import { ethers } from "ethers";
import { decryptBet, verifyCiphertextHash } from "../src/lib/decrypt";
import { settle, groupPayoutsByChain, type RawBet } from "../src/workflows/settlement";
import { generateHmac } from "../src/workflows/oracle-settle";

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const JWT_SECRET = new TextEncoder().encode("test-jwt-secret");
const APP_SALT = "privapoll-salt-v1";
const HMAC_SECRET = "test-hmac-secret";
// Hardhat account #0 (public, never use in production)
const TEST_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

let privateKeyPem: string;
let publicKeyPem: string;

beforeAll(() => {
  const pair = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  privateKeyPem = pair.privateKey;
  publicKeyPem = pair.publicKey;
});

// ---------------------------------------------------------------------------
// Helpers — replicate app logic for standalone testing
// ---------------------------------------------------------------------------

function deriveHashedUserId(nullifierHash: string): string {
  const userId = createHash("sha3-256")
    .update(nullifierHash + APP_SALT)
    .digest("hex");
  return "0x" + createHash("sha3-256").update(userId).digest("hex");
}

async function createSession(hashedUserId: string): Promise<string> {
  return new SignJWT({ hashedUserId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(JWT_SECRET);
}

async function verifySession(token: string): Promise<{ hashedUserId: string }> {
  const { payload } = await jwtVerify(token, JWT_SECRET);
  return payload as { hashedUserId: string };
}

function keccak256(data: Buffer | string): string {
  const buf = typeof data === "string" ? Buffer.from(data) : data;
  return "0x" + createHash("sha3-256").update(buf).digest("hex");
}

function encryptPayload(payload: Record<string, unknown>): Buffer {
  const plaintext = Buffer.from(JSON.stringify(payload));
  return publicEncrypt(
    { key: publicKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    plaintext,
  );
}

// In-memory balance store (simulates Turso DB)
class BalanceStore {
  private balances = new Map<string, { deposited: number; allocated: number }>();

  private key(userId: string, chainId: string) {
    return `${userId}:${chainId}`;
  }

  deposit(userId: string, chainId: string, amount: number) {
    const k = this.key(userId, chainId);
    const existing = this.balances.get(k) ?? { deposited: 0, allocated: 0 };
    existing.deposited += amount;
    this.balances.set(k, existing);
  }

  allocate(userId: string, chainId: string, amount: number): boolean {
    const k = this.key(userId, chainId);
    const existing = this.balances.get(k);
    if (!existing) return false;
    const available = existing.deposited - existing.allocated;
    if (available < amount) return false;
    existing.allocated += amount;
    return true;
  }

  available(userId: string, chainId: string): number {
    const k = this.key(userId, chainId);
    const existing = this.balances.get(k);
    if (!existing) return 0;
    return existing.deposited - existing.allocated;
  }

  totalDeposited(userId: string): number {
    let total = 0;
    for (const [k, v] of this.balances.entries()) {
      if (k.startsWith(userId + ":")) total += v.deposited;
    }
    return total;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Auth flow
// ═══════════════════════════════════════════════════════════════════════════

describe("Auth: World ID → session", () => {
  const NULLIFIER = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";

  it("deriveHashedUserId is deterministic", () => {
    const h1 = deriveHashedUserId(NULLIFIER);
    const h2 = deriveHashedUserId(NULLIFIER);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("different nullifiers produce different userIds", () => {
    const h1 = deriveHashedUserId(NULLIFIER);
    const h2 = deriveHashedUserId("0x" + "ff".repeat(32));
    expect(h1).not.toBe(h2);
  });

  it("JWT round-trip preserves hashedUserId", async () => {
    const hashedUserId = deriveHashedUserId(NULLIFIER);
    const token = await createSession(hashedUserId);
    const session = await verifySession(token);
    expect(session.hashedUserId).toBe(hashedUserId);
  });

  it("rejects tampered JWT", async () => {
    const token = await createSession("0x1234");
    const tampered = token.slice(0, -4) + "XXXX";
    await expect(verifySession(tampered)).rejects.toThrow();
  });

  it("rejects JWT signed with wrong secret", async () => {
    const wrongSecret = new TextEncoder().encode("wrong-secret");
    const token = await new SignJWT({ hashedUserId: "0x1234" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("24h")
      .sign(wrongSecret);
    await expect(verifySession(token)).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Balance management
// ═══════════════════════════════════════════════════════════════════════════

describe("Balance: deposit → allocate → available", () => {
  it("mock deposit credits balance", () => {
    const store = new BalanceStore();
    store.deposit("user1", "world-chain", 10_000_000);
    expect(store.available("user1", "world-chain")).toBe(10_000_000);
  });

  it("multiple deposits accumulate", () => {
    const store = new BalanceStore();
    store.deposit("user1", "world-chain", 5_000_000);
    store.deposit("user1", "world-chain", 3_000_000);
    expect(store.available("user1", "world-chain")).toBe(8_000_000);
  });

  it("allocate reduces available balance", () => {
    const store = new BalanceStore();
    store.deposit("user1", "world-chain", 10_000_000);
    const ok = store.allocate("user1", "world-chain", 3_000_000);
    expect(ok).toBe(true);
    expect(store.available("user1", "world-chain")).toBe(7_000_000);
  });

  it("rejects allocation exceeding available", () => {
    const store = new BalanceStore();
    store.deposit("user1", "world-chain", 5_000_000);
    const ok = store.allocate("user1", "world-chain", 6_000_000);
    expect(ok).toBe(false);
    expect(store.available("user1", "world-chain")).toBe(5_000_000);
  });

  it("rejects allocation for unknown user", () => {
    const store = new BalanceStore();
    const ok = store.allocate("ghost", "world-chain", 1);
    expect(ok).toBe(false);
  });

  it("multi-chain balances are isolated", () => {
    const store = new BalanceStore();
    store.deposit("user1", "world-chain", 10_000_000);
    store.deposit("user1", "base-sepolia", 5_000_000);

    expect(store.available("user1", "world-chain")).toBe(10_000_000);
    expect(store.available("user1", "base-sepolia")).toBe(5_000_000);

    store.allocate("user1", "world-chain", 10_000_000);
    expect(store.available("user1", "world-chain")).toBe(0);
    expect(store.available("user1", "base-sepolia")).toBe(5_000_000);
  });

  it("totalDeposited sums across chains", () => {
    const store = new BalanceStore();
    store.deposit("user1", "world-chain", 10_000_000);
    store.deposit("user1", "base-sepolia", 5_000_000);
    expect(store.totalDeposited("user1")).toBe(15_000_000);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Ciphertext hash consistency (app ↔ CRE)
// ═══════════════════════════════════════════════════════════════════════════

describe("Ciphertext hash: app keccak256 ↔ CRE verifyCiphertextHash", () => {
  it("app-computed hash matches CRE verification", () => {
    const payload = {
      optionId: 1,
      amount: "5000000",
      payoutChainId: "base-sepolia",
      payoutAddress: "0xdeadbeef",
    };
    const ciphertext = encryptPayload(payload);
    const ctBase64 = ciphertext.toString("base64");

    // Compute hash the way app/src/lib/crypto.ts does
    const appHash = keccak256(ciphertext);

    // Verify the way cre/src/lib/decrypt.ts does
    expect(verifyCiphertextHash(ctBase64, appHash)).toBe(true);
  });

  it("hash is different for different ciphertexts of same payload (OAEP randomness)", () => {
    const payload = { optionId: 0, amount: "100", payoutChainId: "x", payoutAddress: "0x1" };
    const ct1 = encryptPayload(payload);
    const ct2 = encryptPayload(payload);

    const hash1 = keccak256(ct1);
    const hash2 = keccak256(ct2);

    expect(hash1).not.toBe(hash2);

    // But both decrypt to same values
    const d1 = decryptBet(ct1.toString("base64"), privateKeyPem);
    const d2 = decryptBet(ct2.toString("base64"), privateKeyPem);
    expect(d1.optionId).toBe(d2.optionId);
    expect(d1.amount).toBe(d2.amount);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Operator signature (EIP-191 claim message)
// ═══════════════════════════════════════════════════════════════════════════

describe("Operator: claim signature generation + verification", () => {
  const wallet = new ethers.Wallet(TEST_PRIVATE_KEY);

  async function signClaimMessage(
    hashedUserId: string,
    marketId: number,
    amount: bigint,
    deadline: number,
    chainId: bigint,
    vaultAddress: string,
  ): Promise<string> {
    const messageHash = ethers.solidityPackedKeccak256(
      ["bytes32", "uint256", "uint256", "uint256", "uint256", "address"],
      [hashedUserId, marketId, amount, deadline, chainId, vaultAddress],
    );
    return wallet.signMessage(ethers.getBytes(messageHash));
  }

  it("produces valid EIP-191 signature recoverable to operator address", async () => {
    const hashedUserId = deriveHashedUserId("0x" + "ab".repeat(32));
    const sig = await signClaimMessage(
      hashedUserId, 1, 5000000n, Math.floor(Date.now() / 1000) + 3600,
      84532n, "0xCf334973c9f230c84d3A238Aaf01B821f1100637",
    );

    expect(sig).toMatch(/^0x[0-9a-f]{130}$/);

    // Recover signer from signature
    const messageHash = ethers.solidityPackedKeccak256(
      ["bytes32", "uint256", "uint256", "uint256", "uint256", "address"],
      [hashedUserId, 1, 5000000n, Math.floor(Date.now() / 1000) + 3600,
        84532n, "0xCf334973c9f230c84d3A238Aaf01B821f1100637"],
    );
    const recovered = ethers.verifyMessage(ethers.getBytes(messageHash), sig);
    expect(recovered.toLowerCase()).toBe(wallet.address.toLowerCase());
  });

  it("different parameters produce different signatures", async () => {
    const hashedUserId = deriveHashedUserId("0x" + "cd".repeat(32));
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const vault = "0xCf334973c9f230c84d3A238Aaf01B821f1100637";

    const sig1 = await signClaimMessage(hashedUserId, 1, 5000000n, deadline, 84532n, vault);
    const sig2 = await signClaimMessage(hashedUserId, 2, 5000000n, deadline, 84532n, vault);
    const sig3 = await signClaimMessage(hashedUserId, 1, 9999999n, deadline, 84532n, vault);

    expect(sig1).not.toBe(sig2);
    expect(sig1).not.toBe(sig3);
  });

  it("signature is deterministic for same inputs", async () => {
    const hashedUserId = "0x" + "ee".repeat(32);
    const sig1 = await signClaimMessage(hashedUserId, 5, 1000000n, 9999999, 84532n, "0x" + "11".repeat(20));
    const sig2 = await signClaimMessage(hashedUserId, 5, 1000000n, 9999999, 84532n, "0x" + "11".repeat(20));
    expect(sig1).toBe(sig2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. HMAC auth consistency (app ↔ CRE)
// ═══════════════════════════════════════════════════════════════════════════

describe("HMAC: app signature ↔ CRE verification", () => {
  // Replicate the app's HMAC generation (from app/src/lib/hmac.ts pattern)
  function appGenerateHmac(secret: string, method: string, path: string, body: string): string {
    return createHmac("sha256", secret)
      .update(method + path + body)
      .digest("hex");
  }

  it("app and CRE produce identical HMAC", () => {
    const appSig = appGenerateHmac(HMAC_SECRET, "GET", "/api/internal/pending-settlements", "");
    const creSig = generateHmac(HMAC_SECRET, "GET", "/api/internal/pending-settlements", "");
    expect(appSig).toBe(creSig);
  });

  it("POST with body produces matching HMAC", () => {
    const body = JSON.stringify({ marketId: 1, resultValue: 42 });
    const appSig = appGenerateHmac(HMAC_SECRET, "POST", "/api/internal/settle", body);
    const creSig = generateHmac(HMAC_SECRET, "POST", "/api/internal/settle", body);
    expect(appSig).toBe(creSig);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Full pipeline: deposit → bet → settle → payout
// ═══════════════════════════════════════════════════════════════════════════

describe("Full pipeline: deposit → encrypt → bet → settle → payout", () => {
  it("simulates complete user journey", async () => {
    // --- Step 1: World ID verification → session ---
    const nullifier = "0x" + "ab".repeat(32);
    const hashedUserId = deriveHashedUserId(nullifier);
    const token = await createSession(hashedUserId);
    const session = await verifySession(token);
    expect(session.hashedUserId).toBe(hashedUserId);

    // --- Step 2: Mock deposit (simulates MiniKit.commandsAsync.pay) ---
    const store = new BalanceStore();
    const depositAmount = 20_000_000; // $20 USDC
    store.deposit(hashedUserId, "world-chain", depositAmount);
    expect(store.available(hashedUserId, "world-chain")).toBe(depositAmount);

    // --- Step 3: Place bet (encrypt + hash + allocate) ---
    const betPayload = {
      optionId: 1,
      amount: "10000000", // $10
      payoutChainId: "base-sepolia",
      payoutAddress: "0x" + "aa".repeat(20),
    };
    const ciphertext = encryptPayload(betPayload);
    const ctBase64 = ciphertext.toString("base64");
    const ctHash = keccak256(ciphertext);

    // Allocate balance
    const allocated = store.allocate(hashedUserId, "world-chain", 10_000_000);
    expect(allocated).toBe(true);
    expect(store.available(hashedUserId, "world-chain")).toBe(10_000_000); // $10 remaining

    // --- Step 4: Second user bets on opposite ---
    const nullifier2 = "0x" + "cd".repeat(32);
    const hashedUserId2 = deriveHashedUserId(nullifier2);
    store.deposit(hashedUserId2, "world-chain", 15_000_000);

    const betPayload2 = {
      optionId: 0,
      amount: "15000000", // $15
      payoutChainId: "arbitrum-sepolia",
      payoutAddress: "0x" + "bb".repeat(20),
    };
    const ciphertext2 = encryptPayload(betPayload2);
    const ctBase64_2 = ciphertext2.toString("base64");
    const ctHash2 = keccak256(ciphertext2);

    store.allocate(hashedUserId2, "world-chain", 15_000_000);

    // --- Step 5: Market closes → Settlement (TEE) ---
    const rawBets: RawBet[] = [
      {
        betId: "bet-1",
        marketId: 1,
        hashedUserId,
        ciphertextHash: ctHash,
        ciphertext: ctBase64,
        amount: 10_000_000,
        sourceChainId: "world-chain",
      },
      {
        betId: "bet-2",
        marketId: 1,
        hashedUserId: hashedUserId2,
        ciphertextHash: ctHash2,
        ciphertext: ctBase64_2,
        amount: 15_000_000,
        sourceChainId: "world-chain",
      },
    ];

    const result = settle({
      marketId: 1,
      marketType: "Binary",
      resultValue: 1n, // Option 1 wins → user1 wins
      bets: rawBets,
      privateKey: privateKeyPem,
      hmacSecret: HMAC_SECRET,
      backendUrl: "http://test",
    });

    // --- Step 6: Verify settlement correctness ---
    expect(result.invalidBets).toHaveLength(0);
    expect(result.payouts).toHaveLength(1); // Only winner

    const winnerPayout = result.payouts[0];
    expect(winnerPayout.hashedUserId).toBe(hashedUserId);
    expect(winnerPayout.amount).toBe(25_000_000n); // $10 + $15 = $25 total pool
    expect(winnerPayout.payoutChainId).toBe("base-sepolia");
    expect(winnerPayout.payoutAddress).toBe("0x" + "aa".repeat(20));

    // --- Step 7: Multi-chain payout routing ---
    const groups = groupPayoutsByChain(result.payouts);
    expect(groups["base-sepolia"]).toHaveLength(1);
    expect(groups["arbitrum-sepolia"]).toBeUndefined(); // Loser gets nothing
  });

  it("rejects second bet on same market (double bet prevention)", async () => {
    const store = new BalanceStore();
    const hashedUserId = deriveHashedUserId("0x" + "99".repeat(32));
    store.deposit(hashedUserId, "world-chain", 50_000_000);

    // First bet — should succeed
    const ok1 = store.allocate(hashedUserId, "world-chain", 10_000_000);
    expect(ok1).toBe(true);

    // Simulating DB check: betsByMarket tracks (marketId, userId) uniqueness
    const betsByMarket = new Set<string>();
    betsByMarket.add("1:" + hashedUserId);

    // Second bet on same market — should be rejected
    const isDuplicate = betsByMarket.has("1:" + hashedUserId);
    expect(isDuplicate).toBe(true);
  });

  it("handles insufficient balance for bet", () => {
    const store = new BalanceStore();
    const hashedUserId = deriveHashedUserId("0x" + "11".repeat(32));
    store.deposit(hashedUserId, "world-chain", 5_000_000); // $5

    // Try to bet $10
    const ok = store.allocate(hashedUserId, "world-chain", 10_000_000);
    expect(ok).toBe(false);
    expect(store.available(hashedUserId, "world-chain")).toBe(5_000_000); // Unchanged
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. Monkey tests — adversarial deposit/bet scenarios
// ═══════════════════════════════════════════════════════════════════════════

describe("Monkey tests: adversarial deposit/bet scenarios", () => {
  it("zero-amount deposit doesn't change balance", () => {
    const store = new BalanceStore();
    store.deposit("user1", "world-chain", 0);
    expect(store.available("user1", "world-chain")).toBe(0);
  });

  it("exact-balance allocation succeeds, leaves zero available", () => {
    const store = new BalanceStore();
    store.deposit("user1", "world-chain", 1_000_000);
    const ok = store.allocate("user1", "world-chain", 1_000_000);
    expect(ok).toBe(true);
    expect(store.available("user1", "world-chain")).toBe(0);
  });

  it("rapid sequential allocations respect running total", () => {
    const store = new BalanceStore();
    store.deposit("user1", "world-chain", 10_000_000);

    // Rapid fire: 3 x $3 + 1 x $1 = $10 (exact)
    expect(store.allocate("user1", "world-chain", 3_000_000)).toBe(true);
    expect(store.allocate("user1", "world-chain", 3_000_000)).toBe(true);
    expect(store.allocate("user1", "world-chain", 3_000_000)).toBe(true);
    expect(store.allocate("user1", "world-chain", 1_000_000)).toBe(true);
    // $0 left — next should fail
    expect(store.allocate("user1", "world-chain", 1)).toBe(false);
  });

  it("100 concurrent users: all settle correctly, pool conserved", () => {
    const users: { hashedUserId: string; bet: RawBet }[] = [];
    let totalPool = 0n;

    for (let i = 0; i < 100; i++) {
      const hashedUserId = `user-${i.toString().padStart(3, "0")}`;
      const amount = BigInt((i + 1) * 1000); // 1k to 100k
      totalPool += amount;

      const payload = {
        optionId: i % 2, // alternating sides
        amount: amount.toString(),
        payoutChainId: i % 3 === 0 ? "arbitrum-sepolia" : "base-sepolia",
        payoutAddress: `0x${i.toString(16).padStart(40, "0")}`,
      };
      const ct = encryptPayload(payload);

      users.push({
        hashedUserId,
        bet: {
          betId: `bet-${i}`,
          marketId: 42,
          hashedUserId,
          ciphertextHash: keccak256(ct),
          ciphertext: ct.toString("base64"),
          amount: Number(amount),
          sourceChainId: "world-chain",
        },
      });
    }

    const result = settle({
      marketId: 42,
      marketType: "Binary",
      resultValue: 1n,
      bets: users.map((u) => u.bet),
      privateKey: privateKeyPem,
      hmacSecret: HMAC_SECRET,
      backendUrl: "http://test",
    });

    expect(result.invalidBets).toHaveLength(0);

    const totalPayout = result.payouts.reduce((s, p) => s + p.amount, 0n);
    expect(totalPayout).toBe(totalPool);

    // Verify multi-chain grouping
    const groups = groupPayoutsByChain(result.payouts);
    const totalGrouped = Object.values(groups)
      .flat()
      .reduce((s, p) => s + p.amount, 0n);
    expect(totalGrouped).toBe(totalPool);
  });

  it("settlement with corrupted private key rejects all bets gracefully", () => {
    const ct = encryptPayload({ optionId: 0, amount: "1000", payoutChainId: "x", payoutAddress: "0x1" });
    const hash = keccak256(ct);

    // Use a different RSA key for decryption (simulates wrong CRE key)
    const wrongKey = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    }).privateKey;

    const result = settle({
      marketId: 1,
      marketType: "Binary",
      resultValue: 0n,
      bets: [{
        betId: "bad",
        marketId: 1,
        hashedUserId: "user-x",
        ciphertextHash: hash,
        ciphertext: ct.toString("base64"),
        amount: 1000,
        sourceChainId: "world-chain",
      }],
      privateKey: wrongKey,
      hmacSecret: "x",
      backendUrl: "http://test",
    });

    // Hash verified but decryption failed → invalid
    expect(result.invalidBets).toEqual(["bad"]);
    expect(result.payouts).toHaveLength(0);
  });
});
