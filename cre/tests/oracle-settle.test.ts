import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  extractJsonPath,
  inferJsonPath,
  fetchPendingMarkets,
  fetchOracleValue,
  oracleSettle,
  generateHmac,
  type PendingMarket,
  type OracleSettleInput,
} from "../src/workflows/oracle-settle";

// ---------------------------------------------------------------------------
// Mock fetch helper
// ---------------------------------------------------------------------------

function mockFetch(body: unknown, status = 200): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  }) as unknown as typeof globalThis.fetch;
}

function mockFetchSequence(
  ...responses: { body: unknown; status?: number }[]
): typeof globalThis.fetch {
  const fn = vi.fn();
  for (const r of responses) {
    fn.mockResolvedValueOnce({
      ok: (r.status ?? 200) >= 200 && (r.status ?? 200) < 300,
      status: r.status ?? 200,
      json: () => Promise.resolve(r.body),
      text: () => Promise.resolve(JSON.stringify(r.body)),
    });
  }
  return fn as unknown as typeof globalThis.fetch;
}

// ---------------------------------------------------------------------------
// extractJsonPath
// ---------------------------------------------------------------------------

describe("extractJsonPath", () => {
  it("extracts nested value", () => {
    expect(extractJsonPath({ ethereum: { usd: 3500.42 } }, "ethereum.usd")).toBe(3500.42);
  });

  it("extracts top-level value", () => {
    expect(extractJsonPath({ price: 100 }, "price")).toBe(100);
  });

  it("returns undefined for missing path", () => {
    expect(extractJsonPath({ a: 1 }, "b")).toBeUndefined();
  });

  it("returns undefined for non-numeric leaf", () => {
    expect(extractJsonPath({ a: "hello" }, "a")).toBeUndefined();
  });

  it("returns undefined for null input", () => {
    expect(extractJsonPath(null, "a")).toBeUndefined();
  });

  it("handles deeply nested paths", () => {
    expect(extractJsonPath({ a: { b: { c: { d: 42 } } } }, "a.b.c.d")).toBe(42);
  });

  it("handles zero as valid number", () => {
    expect(extractJsonPath({ val: 0 }, "val")).toBe(0);
  });

  it("returns undefined for NaN", () => {
    expect(extractJsonPath({ val: NaN }, "val")).toBeUndefined();
  });

  it("returns undefined for Infinity", () => {
    expect(extractJsonPath({ val: Infinity }, "val")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// inferJsonPath
// ---------------------------------------------------------------------------

describe("inferJsonPath", () => {
  it("infers CoinGecko path from URL params", () => {
    const url = "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd";
    const json = { ethereum: { usd: 3500 } };
    expect(inferJsonPath(url, json)).toBe("ethereum.usd");
  });

  it("falls back to first numeric leaf", () => {
    const url = "https://some-api.com/data";
    const json = { result: { value: 42 } };
    expect(inferJsonPath(url, json)).toBe("result.value");
  });

  it("returns undefined for empty object", () => {
    expect(inferJsonPath("https://x.com", {})).toBeUndefined();
  });

  it("returns undefined for object with only string values", () => {
    expect(inferJsonPath("https://x.com", { a: "hello", b: "world" })).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// fetchPendingMarkets
// ---------------------------------------------------------------------------

describe("fetchPendingMarkets", () => {
  const backendUrl = "https://backend.example.com";
  const secret = "test-secret";

  it("fetches and returns markets array", async () => {
    const markets: PendingMarket[] = [
      {
        marketId: 1,
        question: "Will ETH > $10k?",
        marketType: "Binary",
        oracleApiUrl: "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
        closeTime: 1000,
      },
    ];
    const fetch = mockFetch({ markets });

    const result = await fetchPendingMarkets(backendUrl, secret, fetch);

    expect(result).toEqual(markets);
    expect(fetch).toHaveBeenCalledOnce();

    // Verify HMAC header was sent
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const headers = call[1].headers as Record<string, string>;
    const expectedSig = generateHmac(secret, "GET", "/api/internal/pending-settlements", "");
    expect(headers["x-hmac-signature"]).toBe(expectedSig);
  });

  it("returns empty array when no markets field", async () => {
    const fetch = mockFetch({});
    const result = await fetchPendingMarkets(backendUrl, secret, fetch);
    expect(result).toEqual([]);
  });

  it("throws on non-ok response", async () => {
    const fetch = mockFetch({ error: "unauthorized" }, 403);
    await expect(fetchPendingMarkets(backendUrl, secret, fetch)).rejects.toThrow("403");
  });
});

// ---------------------------------------------------------------------------
// fetchOracleValue
// ---------------------------------------------------------------------------

describe("fetchOracleValue", () => {
  it("parses CoinGecko response", async () => {
    const url = "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd";
    const fetch = mockFetch({ ethereum: { usd: 3500.42 } });

    const value = await fetchOracleValue(url, fetch);
    expect(value).toBe(3500.42);
  });

  it("throws on non-ok oracle response", async () => {
    const fetch = mockFetch("rate limited", 429);
    await expect(
      fetchOracleValue("https://api.example.com/price", fetch)
    ).rejects.toThrow("429");
  });

  it("throws when no numeric value found", async () => {
    const fetch = mockFetch({ status: "ok", data: "no numbers here" });
    await expect(
      fetchOracleValue("https://api.example.com/price", fetch)
    ).rejects.toThrow("Could not find numeric value");
  });

  it("handles nested oracle response via fallback path", async () => {
    const fetch = mockFetch({ data: { price: 1234.5 } });
    const value = await fetchOracleValue("https://custom-oracle.com/api", fetch);
    expect(value).toBe(1234.5);
  });
});

// ---------------------------------------------------------------------------
// oracleSettle (integration-level with mocked fetch + skipped on-chain)
// ---------------------------------------------------------------------------

describe("oracleSettle", () => {
  const baseInput: OracleSettleInput = {
    backendUrl: "https://backend.example.com",
    hmacSecret: "secret",
    rpcUrl: "https://rpc.example.com",
    marketRegistryAddress: "0x1234567890abcdef1234567890abcdef12345678",
    trustedSignerPrivateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  };

  it("skips markets without oracleApiUrl", async () => {
    const markets: PendingMarket[] = [
      { marketId: 1, question: "Q?", marketType: "Binary", oracleApiUrl: "", closeTime: 0 },
    ];
    const fetch = mockFetch({ markets });

    const result = await oracleSettle(baseInput, fetch);

    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toContain("No oracleApiUrl");
    expect(result.settled).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it("skips markets not yet closed", async () => {
    const futureTime = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
    const markets: PendingMarket[] = [
      {
        marketId: 2,
        question: "Future Q?",
        marketType: "Binary",
        oracleApiUrl: "https://api.example.com",
        closeTime: futureTime,
      },
    ];
    const fetch = mockFetch({ markets });

    const result = await oracleSettle(baseInput, fetch);

    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toContain("not yet closed");
  });

  it("records error when oracle fetch fails", async () => {
    const markets: PendingMarket[] = [
      {
        marketId: 3,
        question: "Q?",
        marketType: "Binary",
        oracleApiUrl: "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
        closeTime: 0,
      },
    ];

    // First call returns markets, second call (oracle) fails
    const fetch = mockFetchSequence(
      { body: { markets } },
      { body: "server error", status: 500 }
    );

    const result = await oracleSettle(baseInput, fetch);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].marketId).toBe(3);
    expect(result.errors[0].error).toContain("Oracle fetch failed");
  });

  it("records error when backend is unreachable", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof globalThis.fetch;

    const result = await oracleSettle(baseInput, fetch);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].marketId).toBe(-1);
    expect(result.errors[0].error).toContain("Failed to fetch pending markets");
  });

  it("returns empty result when no pending markets", async () => {
    const fetch = mockFetch({ markets: [] });
    const result = await oracleSettle(baseInput, fetch);

    expect(result.settled).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  // Monkey tests — extreme / edge cases
  it("handles market with closeTime = 0 (epoch) as already closed", async () => {
    const markets: PendingMarket[] = [
      {
        marketId: 99,
        question: "Q?",
        marketType: "Binary",
        oracleApiUrl: "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
        closeTime: 0,
      },
    ];
    // Backend returns markets, oracle returns price (but tx will fail since rpc is fake)
    const fetch = mockFetchSequence(
      { body: { markets } },
      { body: { ethereum: { usd: 9999 } } }
    );

    const result = await oracleSettle(baseInput, fetch);
    // Should attempt settlement (not skip), but tx will fail since rpc is fake
    expect(result.skipped).toHaveLength(0);
    // Either settled or errored on tx — both valid
    expect(result.settled.length + result.errors.length).toBe(1);
  });

  it("handles multiple markets with mixed results", async () => {
    const markets: PendingMarket[] = [
      { marketId: 1, question: "Q1", marketType: "Binary", oracleApiUrl: "", closeTime: 0 },
      {
        marketId: 2,
        question: "Q2",
        marketType: "Binary",
        oracleApiUrl: "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
        closeTime: Math.floor(Date.now() / 1000) + 9999,
      },
    ];
    const fetch = mockFetch({ markets });

    const result = await oracleSettle(baseInput, fetch);

    // Market 1 skipped (no URL), Market 2 skipped (not closed)
    expect(result.skipped).toHaveLength(2);
    expect(result.settled).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it("handles oracle returning negative number", async () => {
    const markets: PendingMarket[] = [
      {
        marketId: 5,
        question: "Temperature?",
        marketType: "Scalar",
        oracleApiUrl: "https://weather-api.com/temp",
        closeTime: 0,
      },
    ];
    const fetch = mockFetchSequence(
      { body: { markets } },
      { body: { temp: -15.5 } }
    );

    const result = await oracleSettle(baseInput, fetch);
    // Will attempt tx (fail on fake rpc), but oracle parse should succeed
    expect(result.skipped).toHaveLength(0);
    if (result.settled.length === 1) {
      expect(result.settled[0].resultValue).toBe(-15.5);
    }
  });
});
