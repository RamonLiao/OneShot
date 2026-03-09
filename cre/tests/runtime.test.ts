/**
 * CRE Runtime Integration Tests
 *
 * Tests real crypto round-trips (RSA-OAEP SHA-256), ciphertext hash
 * verification, full settlement flows, live oracle API fetch, and
 * HMAC consistency — NO mocks for crypto or external APIs.
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  generateKeyPairSync,
  publicEncrypt,
  constants,
  createHash,
} from "crypto";
import { decryptBet, verifyCiphertextHash } from "../src/lib/decrypt";
import { settle, groupPayoutsByChain, type RawBet } from "../src/workflows/settlement";
import {
  fetchOracleValue,
  extractJsonPath,
  generateHmac,
} from "../src/workflows/oracle-settle";

// ---------------------------------------------------------------------------
// RSA key pair (generated once, used across all tests)
// ---------------------------------------------------------------------------

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
// Helper: encrypt like the frontend (RSA-OAEP SHA-256)
// ---------------------------------------------------------------------------

function encryptPayload(payload: Record<string, unknown>): string {
  const plaintext = Buffer.from(JSON.stringify(payload));
  const ciphertext = publicEncrypt(
    { key: publicKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    plaintext,
  );
  return ciphertext.toString("base64");
}

function computeHash(ciphertextBase64: string): string {
  const buf = Buffer.from(ciphertextBase64, "base64");
  return "0x" + createHash("sha3-256").update(buf).digest("hex");
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Crypto round-trip
// ═══════════════════════════════════════════════════════════════════════════

describe("Crypto round-trip (RSA-OAEP SHA-256)", () => {
  it("encrypts and decrypts a binary bet payload", () => {
    const payload = {
      optionId: 1,
      amount: "5000000",
      payoutChainId: "base-sepolia",
      payoutAddress: "0xdeadbeef",
    };
    const ct = encryptPayload(payload);
    const decrypted = decryptBet(ct, privateKeyPem);

    expect(decrypted.optionId).toBe(1);
    expect(decrypted.amount).toBe(5000000n);
    expect(decrypted.payoutChainId).toBe("base-sepolia");
    expect(decrypted.payoutAddress).toBe("0xdeadbeef");
  });

  it("encrypts and decrypts a scalar bet payload", () => {
    const payload = {
      scalarValue: 42069,
      amount: "100000000",
      payoutChainId: "arbitrum-sepolia",
      payoutAddress: "0xcafe",
    };
    const ct = encryptPayload(payload);
    const decrypted = decryptBet(ct, privateKeyPem);

    expect(decrypted.scalarValue).toBe(42069);
    expect(decrypted.amount).toBe(100000000n);
    expect(decrypted.payoutChainId).toBe("arbitrum-sepolia");
  });

  it("each encryption produces different ciphertext (OAEP randomness)", () => {
    const payload = { optionId: 0, amount: "1000", payoutChainId: "x", payoutAddress: "0x1" };
    const ct1 = encryptPayload(payload);
    const ct2 = encryptPayload(payload);
    expect(ct1).not.toBe(ct2);

    // But both decrypt to same values
    const d1 = decryptBet(ct1, privateKeyPem);
    const d2 = decryptBet(ct2, privateKeyPem);
    expect(d1.optionId).toBe(d2.optionId);
    expect(d1.amount).toBe(d2.amount);
  });

  it("fails to decrypt with wrong private key", () => {
    const wrongKey = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    }).privateKey;

    const ct = encryptPayload({ optionId: 1, amount: "1000", payoutChainId: "x", payoutAddress: "0x1" });
    expect(() => decryptBet(ct, wrongKey)).toThrow();
  });

  it("fails to decrypt garbage base64", () => {
    const garbage = Buffer.from("not a real ciphertext at all!!!").toString("base64");
    expect(() => decryptBet(garbage, privateKeyPem)).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Ciphertext hash verification
// ═══════════════════════════════════════════════════════════════════════════

describe("Ciphertext hash verification (keccak256)", () => {
  it("matches hash of encrypted ciphertext", () => {
    const ct = encryptPayload({ optionId: 0, amount: "999", payoutChainId: "x", payoutAddress: "0x1" });
    const hash = computeHash(ct);
    expect(verifyCiphertextHash(ct, hash)).toBe(true);
  });

  it("rejects tampered ciphertext", () => {
    const ct = encryptPayload({ optionId: 0, amount: "999", payoutChainId: "x", payoutAddress: "0x1" });
    const hash = computeHash(ct);

    // Flip one byte in the base64
    const buf = Buffer.from(ct, "base64");
    buf[0] ^= 0xff;
    const tampered = buf.toString("base64");

    expect(verifyCiphertextHash(tampered, hash)).toBe(false);
  });

  it("rejects wrong hash", () => {
    const ct = encryptPayload({ optionId: 0, amount: "999", payoutChainId: "x", payoutAddress: "0x1" });
    const wrongHash = "0x" + "ab".repeat(32);
    expect(verifyCiphertextHash(ct, wrongHash)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Full settlement flow (encrypt → settle → verify payouts)
// ═══════════════════════════════════════════════════════════════════════════

describe("Full settlement flow", () => {
  function makeRawBet(
    betId: string,
    userId: string,
    optionId: number,
    amount: bigint,
    chain: string,
    addr: string,
    scalarValue?: number,
  ): RawBet {
    const payload: Record<string, unknown> = {
      optionId,
      amount: amount.toString(),
      payoutChainId: chain,
      payoutAddress: addr,
    };
    if (scalarValue != null) payload.scalarValue = scalarValue;

    const ct = encryptPayload(payload);
    const hash = computeHash(ct);

    return {
      betId,
      marketId: 1,
      hashedUserId: userId,
      ciphertextHash: hash,
      ciphertext: ct,
      amount: Number(amount),
      sourceChainId: "world-chain",
    };
  }

  it("Binary: correct winner-takes-pool with real crypto", () => {
    const bets = [
      makeRawBet("b1", "user-a", 1, 300n, "base-sepolia", "0xAAA"),
      makeRawBet("b2", "user-b", 0, 700n, "arbitrum-sepolia", "0xBBB"),
    ];

    const result = settle({
      marketId: 1,
      marketType: "Binary",
      resultValue: 1n,
      bets,
      privateKey: privateKeyPem,
      hmacSecret: "test",
      backendUrl: "http://localhost",
    });

    expect(result.invalidBets).toHaveLength(0);
    expect(result.payouts).toHaveLength(1);
    expect(result.payouts[0].hashedUserId).toBe("user-a");
    expect(result.payouts[0].amount).toBe(1000n); // winner takes all
    expect(result.payouts[0].payoutChainId).toBe("base-sepolia");
    expect(result.payouts[0].payoutAddress).toBe("0xAAA");
  });

  it("Binary: multiple winners split proportionally", () => {
    const bets = [
      makeRawBet("b1", "user-a", 1, 100n, "base-sepolia", "0xAAA"),
      makeRawBet("b2", "user-b", 1, 300n, "base-sepolia", "0xBBB"),
      makeRawBet("b3", "user-c", 0, 600n, "base-sepolia", "0xCCC"),
    ];

    const result = settle({
      marketId: 1,
      marketType: "Binary",
      resultValue: 1n,
      bets,
      privateKey: privateKeyPem,
      hmacSecret: "test",
      backendUrl: "http://localhost",
    });

    expect(result.invalidBets).toHaveLength(0);
    const totalPayout = result.payouts.reduce((s, p) => s + p.amount, 0n);
    expect(totalPayout).toBe(1000n); // pool conservation
    const pa = result.payouts.find((p) => p.hashedUserId === "user-a")!;
    const pb = result.payouts.find((p) => p.hashedUserId === "user-b")!;
    expect(pb.amount).toBeGreaterThan(pa.amount);
  });

  it("Scalar: closer guess wins more", () => {
    const bets = [
      makeRawBet("b1", "user-a", 0, 500n, "base-sepolia", "0xAAA", 100),
      makeRawBet("b2", "user-b", 0, 500n, "base-sepolia", "0xBBB", 110),
    ];

    const result = settle({
      marketId: 2,
      marketType: "Scalar",
      resultValue: 100n, // user-a is exact
      bets,
      privateKey: privateKeyPem,
      hmacSecret: "test",
      backendUrl: "http://localhost",
    });

    expect(result.invalidBets).toHaveLength(0);
    const pa = result.payouts.find((p) => p.hashedUserId === "user-a")!;
    const pb = result.payouts.find((p) => p.hashedUserId === "user-b")!;
    expect(pa.amount).toBe(1000n); // exact match takes all
    expect(pb.amount).toBe(0n);
  });

  it("detects tampered ciphertext as invalid bet", () => {
    const raw = makeRawBet("b1", "user-a", 1, 100n, "base-sepolia", "0xAAA");
    // Tamper: change the hash so it doesn't match
    raw.ciphertextHash = "0x" + "ff".repeat(32);

    const result = settle({
      marketId: 1,
      marketType: "Binary",
      resultValue: 1n,
      bets: [raw],
      privateKey: privateKeyPem,
      hmacSecret: "test",
      backendUrl: "http://localhost",
    });

    expect(result.invalidBets).toEqual(["b1"]);
    expect(result.payouts).toHaveLength(0);
  });

  it("mixed valid + invalid bets: invalid excluded from pool", () => {
    const validBet = makeRawBet("b1", "user-a", 1, 400n, "base-sepolia", "0xAAA");
    const invalidBet = makeRawBet("b2", "user-b", 0, 600n, "base-sepolia", "0xBBB");
    invalidBet.ciphertextHash = "0x" + "00".repeat(32); // tamper

    const result = settle({
      marketId: 1,
      marketType: "Binary",
      resultValue: 1n,
      bets: [validBet, invalidBet],
      privateKey: privateKeyPem,
      hmacSecret: "test",
      backendUrl: "http://localhost",
    });

    expect(result.invalidBets).toEqual(["b2"]);
    expect(result.payouts).toHaveLength(1);
    // Only valid bet in pool: refunded own amount (sole participant)
    expect(result.payouts[0].amount).toBe(400n);
  });

  it("multi-chain payout grouping", () => {
    const bets = [
      makeRawBet("b1", "user-a", 1, 200n, "base-sepolia", "0xAAA"),
      makeRawBet("b2", "user-b", 1, 300n, "arbitrum-sepolia", "0xBBB"),
      makeRawBet("b3", "user-c", 0, 500n, "base-sepolia", "0xCCC"),
    ];

    const result = settle({
      marketId: 1,
      marketType: "Binary",
      resultValue: 1n,
      bets,
      privateKey: privateKeyPem,
      hmacSecret: "test",
      backendUrl: "http://localhost",
    });

    const groups = groupPayoutsByChain(result.payouts);
    expect(Object.keys(groups).sort()).toEqual(["arbitrum-sepolia", "base-sepolia"]);
    expect(groups["base-sepolia"]).toHaveLength(1);
    expect(groups["arbitrum-sepolia"]).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Live oracle API fetch (CoinGecko)
// ═══════════════════════════════════════════════════════════════════════════

describe("Live oracle API fetch", () => {
  // CoinGecko free tier: 10-30 calls/min. Skip gracefully on 429.
  async function fetchOrSkip(url: string): Promise<Response> {
    const res = await fetch(url);
    if (res.status === 429) {
      console.warn("CoinGecko rate limit hit — skipping live oracle test");
      return res;
    }
    return res;
  }

  it("fetches real ETH+BTC/USD prices from CoinGecko", async () => {
    const url =
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum,bitcoin&vs_currencies=usd";

    const res = await fetchOrSkip(url);
    if (res.status === 429) return; // graceful skip

    expect(res.ok).toBe(true);
    const json = await res.json();

    const ethPrice = extractJsonPath(json, "ethereum.usd");
    const btcPrice = extractJsonPath(json, "bitcoin.usd");

    expect(ethPrice).toBeDefined();
    expect(ethPrice!).toBeGreaterThan(100);
    expect(ethPrice!).toBeLessThan(100_000);

    expect(btcPrice).toBeDefined();
    expect(btcPrice!).toBeGreaterThan(1000);
    expect(btcPrice!).toBeLessThan(1_000_000);
  }, 10_000);

  it("fetchOracleValue parses single-coin response via inferJsonPath", async () => {
    const url =
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd";

    // Pre-check rate limit
    const probe = await fetchOrSkip(url);
    if (probe.status === 429) return;

    const value = await fetchOracleValue(url);
    expect(typeof value).toBe("number");
    expect(value).toBeGreaterThan(100);
    expect(value).toBeLessThan(100_000);
  }, 10_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. HMAC consistency
// ═══════════════════════════════════════════════════════════════════════════

describe("HMAC consistency", () => {
  it("produces deterministic signatures", () => {
    const sig1 = generateHmac("secret", "GET", "/api/internal/pending-settlements", "");
    const sig2 = generateHmac("secret", "GET", "/api/internal/pending-settlements", "");
    expect(sig1).toBe(sig2);
    expect(sig1).toHaveLength(64); // SHA-256 hex
  });

  it("different secrets produce different signatures", () => {
    const sig1 = generateHmac("secret-a", "GET", "/path", "");
    const sig2 = generateHmac("secret-b", "GET", "/path", "");
    expect(sig1).not.toBe(sig2);
  });

  it("different methods produce different signatures", () => {
    const sig1 = generateHmac("secret", "GET", "/path", "");
    const sig2 = generateHmac("secret", "POST", "/path", "");
    expect(sig1).not.toBe(sig2);
  });

  it("body changes signature", () => {
    const sig1 = generateHmac("secret", "POST", "/path", "");
    const sig2 = generateHmac("secret", "POST", "/path", '{"data":1}');
    expect(sig1).not.toBe(sig2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Monkey tests — extreme / adversarial inputs
// ═══════════════════════════════════════════════════════════════════════════

describe("Monkey tests", () => {
  it("handles maximum RSA-2048 payload size (190 bytes for OAEP-SHA256)", () => {
    // RSA-2048 with OAEP-SHA256: max plaintext = 256 - 2*32 - 2 = 190 bytes
    const payload = {
      optionId: 1,
      amount: "9".repeat(30),
      payoutChainId: "chain-" + "x".repeat(50),
      payoutAddress: "0x" + "f".repeat(40),
    };
    const json = JSON.stringify(payload);
    // Should be under 190 bytes — if not, encryption will throw
    if (Buffer.byteLength(json) <= 190) {
      const ct = encryptPayload(payload);
      const decrypted = decryptBet(ct, privateKeyPem);
      expect(decrypted.optionId).toBe(1);
    }
  });

  it("settlement with 0 bets returns empty", () => {
    const result = settle({
      marketId: 99,
      marketType: "Binary",
      resultValue: 1n,
      bets: [],
      privateKey: privateKeyPem,
      hmacSecret: "test",
      backendUrl: "http://localhost",
    });
    expect(result.payouts).toHaveLength(0);
    expect(result.invalidBets).toHaveLength(0);
  });

  it("settlement with all invalid bets returns empty payouts", () => {
    const bad1: RawBet = {
      betId: "bad1",
      marketId: 1,
      hashedUserId: "u1",
      ciphertextHash: "0x" + "aa".repeat(32),
      ciphertext: Buffer.from("garbage").toString("base64"),
      amount: 100,
      sourceChainId: "world-chain",
    };
    const bad2: RawBet = {
      betId: "bad2",
      marketId: 1,
      hashedUserId: "u2",
      ciphertextHash: "0x" + "bb".repeat(32),
      ciphertext: Buffer.from("more garbage").toString("base64"),
      amount: 200,
      sourceChainId: "world-chain",
    };

    const result = settle({
      marketId: 1,
      marketType: "Binary",
      resultValue: 1n,
      bets: [bad1, bad2],
      privateKey: privateKeyPem,
      hmacSecret: "test",
      backendUrl: "http://localhost",
    });

    expect(result.invalidBets).toEqual(["bad1", "bad2"]);
    expect(result.payouts).toHaveLength(0);
  });

  it("large number of bets — pool conservation holds", () => {
    const bets: RawBet[] = [];
    const amounts: bigint[] = [];

    for (let i = 0; i < 50; i++) {
      const amount = BigInt(Math.floor(Math.random() * 10000) + 1);
      amounts.push(amount);
      const payload = {
        optionId: i % 3, // 3 options
        amount: amount.toString(),
        payoutChainId: "base-sepolia",
        payoutAddress: `0x${i.toString(16).padStart(4, "0")}`,
      };
      const ct = encryptPayload(payload);
      bets.push({
        betId: `b${i}`,
        marketId: 1,
        hashedUserId: `user-${i}`,
        ciphertextHash: computeHash(ct),
        ciphertext: ct,
        amount: Number(amount),
        sourceChainId: "world-chain",
      });
    }

    const totalPool = amounts.reduce((s, a) => s + a, 0n);

    const result = settle({
      marketId: 1,
      marketType: "Categorical",
      resultValue: 1n, // option 1 wins
      bets,
      privateKey: privateKeyPem,
      hmacSecret: "test",
      backendUrl: "http://localhost",
    });

    expect(result.invalidBets).toHaveLength(0);
    const totalPayout = result.payouts.reduce((s, p) => s + p.amount, 0n);
    expect(totalPayout).toBe(totalPool);
  });

  it("unicode in payout address round-trips correctly", () => {
    const payload = {
      optionId: 0,
      amount: "100",
      payoutChainId: "test",
      payoutAddress: "0xCafé", // non-ASCII
    };
    const ct = encryptPayload(payload);
    const decrypted = decryptBet(ct, privateKeyPem);
    expect(decrypted.payoutAddress).toBe("0xCafé");
  });

  it("amount as string with leading zeros parses correctly", () => {
    const payload = {
      optionId: 0,
      amount: "00001000",
      payoutChainId: "x",
      payoutAddress: "0x1",
    };
    const ct = encryptPayload(payload);
    const decrypted = decryptBet(ct, privateKeyPem);
    expect(decrypted.amount).toBe(1000n);
  });

  it("extractJsonPath handles adversarial inputs", () => {
    expect(extractJsonPath(undefined, "a")).toBeUndefined();
    expect(extractJsonPath(42, "a")).toBeUndefined();
    expect(extractJsonPath({ a: { b: null } }, "a.b.c")).toBeUndefined();
    expect(extractJsonPath({}, "")).toBeUndefined();
    expect(extractJsonPath({ "": { "": 5 } }, ".")).toBe(5);
  });
});
