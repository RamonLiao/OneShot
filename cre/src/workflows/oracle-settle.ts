/**
 * CRE Oracle Auto-Settle Workflow (Workflow 3)
 *
 * Trigger: Cron (every 5 min)
 * Flow:
 *   1. Confidential HTTP → GET /api/internal/pending-settlements (HMAC auth)
 *   2. For each market needing settlement:
 *      a. Confidential HTTP → fetch external oracle API (e.g. CoinGecko)
 *      b. Parse JSON response via dot-path extraction
 *      c. Write on-chain: MarketRegistry.setResult(marketId, resultValue)
 *   3. Return summary of settled / skipped / errored markets
 *
 * The setResult() call emits MarketSettled, which triggers Workflow 2.
 */

import { createHmac } from "crypto";
import {
  createWalletClient,
  http,
  parseAbi,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PendingMarket {
  marketId: number;
  question: string;
  marketType: string;
  oracleApiUrl: string;
  closeTime: number;
}

export interface OracleSettleInput {
  backendUrl: string;
  hmacSecret: string; // CRE secret
  rpcUrl: string;
  marketRegistryAddress: string;
  trustedSignerPrivateKey: string; // CRE secret: for signing setResult tx
}

export interface OracleSettleResult {
  settled: { marketId: number; resultValue: number }[];
  skipped: { marketId: number; reason: string }[];
  errors: { marketId: number; error: string }[];
}

// ---------------------------------------------------------------------------
// HMAC helper (mirrors app/src/lib/hmac.ts signature scheme)
// ---------------------------------------------------------------------------

export function generateHmac(
  secret: string,
  method: string,
  path: string,
  body: string
): string {
  return createHmac("sha256", secret)
    .update(method + path + body)
    .digest("hex");
}

// ---------------------------------------------------------------------------
// JSON dot-path extraction  e.g. "ethereum.usd" → obj.ethereum.usd
// ---------------------------------------------------------------------------

export function extractJsonPath(obj: unknown, path: string): number | undefined {
  const segments = path.split(".");
  let current: unknown = obj;

  for (const seg of segments) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[seg];
  }

  const num = Number(current);
  return Number.isFinite(num) ? num : undefined;
}

/**
 * Infer the JSON path to extract from an oracle URL.
 * CoinGecko simple/price example:
 *   ids=ethereum&vs_currencies=usd → path = "ethereum.usd"
 *
 * Falls back to the first nested numeric value found.
 */
export function inferJsonPath(url: string, json: unknown): string | undefined {
  // Try CoinGecko pattern: ?ids=<coin>&vs_currencies=<currency>
  try {
    const parsed = new URL(url);
    const ids = parsed.searchParams.get("ids");
    const vs = parsed.searchParams.get("vs_currencies");
    if (ids && vs) {
      const candidate = `${ids}.${vs}`;
      if (extractJsonPath(json, candidate) !== undefined) return candidate;
    }
  } catch {
    // not a valid URL, skip
  }

  // Fallback: DFS for first numeric leaf
  return findFirstNumericPath(json, []);
}

function findFirstNumericPath(obj: unknown, path: string[]): string | undefined {
  if (obj == null) return undefined;
  if (typeof obj === "number" && Number.isFinite(obj)) return path.join(".");
  if (typeof obj === "object") {
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      const found = findFirstNumericPath(val, [...path, key]);
      if (found) return found;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Fetch helpers (separated for testability)
// ---------------------------------------------------------------------------

export async function fetchPendingMarkets(
  backendUrl: string,
  hmacSecret: string,
  fetchFn: typeof globalThis.fetch = globalThis.fetch
): Promise<PendingMarket[]> {
  const path = "/api/internal/pending-settlements";
  const method = "GET";
  const signature = generateHmac(hmacSecret, method, path, "");

  const res = await fetchFn(`${backendUrl}${path}`, {
    method,
    headers: {
      "x-hmac-signature": signature,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`Backend returned ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as { markets: PendingMarket[] };
  return data.markets ?? [];
}

export async function fetchOracleValue(
  oracleApiUrl: string,
  fetchFn: typeof globalThis.fetch = globalThis.fetch
): Promise<number> {
  const res = await fetchFn(oracleApiUrl);
  if (!res.ok) {
    throw new Error(`Oracle API returned ${res.status}: ${await res.text()}`);
  }

  const json: unknown = await res.json();
  const jsonPath = inferJsonPath(oracleApiUrl, json);
  if (!jsonPath) {
    throw new Error(`Could not find numeric value in oracle response`);
  }

  const value = extractJsonPath(json, jsonPath);
  if (value === undefined) {
    throw new Error(`extractJsonPath("${jsonPath}") returned undefined`);
  }

  return value;
}

// ---------------------------------------------------------------------------
// On-chain write
// ---------------------------------------------------------------------------

const MARKET_REGISTRY_ABI = parseAbi([
  "function setResult(uint256 marketId, int256 resultValue) external",
]);

export async function writeSetResult(
  rpcUrl: string,
  marketRegistryAddress: string,
  trustedSignerPrivateKey: string,
  marketId: number,
  resultValue: number
): Promise<TransactionReceipt> {
  const account = privateKeyToAccount(trustedSignerPrivateKey as Hex);

  const client = createWalletClient({
    account,
    transport: http(rpcUrl),
  });

  const hash = await client.writeContract({
    address: marketRegistryAddress as Hex,
    abi: MARKET_REGISTRY_ABI,
    functionName: "setResult",
    args: [BigInt(marketId), BigInt(Math.round(resultValue))],
  });

  // Wait for receipt — viem walletClient doesn't have waitForTransactionReceipt,
  // so we use a public client action via the same transport.
  const { createPublicClient } = await import("viem");
  const publicClient = createPublicClient({ transport: http(rpcUrl) });
  return publicClient.waitForTransactionReceipt({ hash });
}

// ---------------------------------------------------------------------------
// Main workflow
// ---------------------------------------------------------------------------

export async function oracleSettle(
  input: OracleSettleInput,
  fetchFn: typeof globalThis.fetch = globalThis.fetch
): Promise<OracleSettleResult> {
  const result: OracleSettleResult = {
    settled: [],
    skipped: [],
    errors: [],
  };

  // 1. Fetch pending settlements from backend
  let markets: PendingMarket[];
  try {
    markets = await fetchPendingMarkets(input.backendUrl, input.hmacSecret, fetchFn);
  } catch (err) {
    // Fatal: can't reach backend — return single error
    result.errors.push({
      marketId: -1,
      error: `Failed to fetch pending markets: ${(err as Error).message}`,
    });
    return result;
  }

  if (markets.length === 0) return result;

  // 2. Process each market
  for (const market of markets) {
    // Skip markets that haven't closed yet
    const nowSec = Math.floor(Date.now() / 1000);
    if (market.closeTime > nowSec) {
      result.skipped.push({ marketId: market.marketId, reason: "Market not yet closed" });
      continue;
    }

    // Skip markets without oracle URL
    if (!market.oracleApiUrl) {
      result.skipped.push({ marketId: market.marketId, reason: "No oracleApiUrl configured" });
      continue;
    }

    // 2a. Fetch oracle value
    let oracleValue: number;
    try {
      oracleValue = await fetchOracleValue(market.oracleApiUrl, fetchFn);
    } catch (err) {
      result.errors.push({
        marketId: market.marketId,
        error: `Oracle fetch failed: ${(err as Error).message}`,
      });
      continue;
    }

    // 2b. Write setResult on-chain
    try {
      await writeSetResult(
        input.rpcUrl,
        input.marketRegistryAddress,
        input.trustedSignerPrivateKey,
        market.marketId,
        oracleValue
      );
      result.settled.push({ marketId: market.marketId, resultValue: oracleValue });
    } catch (err) {
      result.errors.push({
        marketId: market.marketId,
        error: `setResult tx failed: ${(err as Error).message}`,
      });
    }
  }

  return result;
}
