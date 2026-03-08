import { ethers } from "ethers";
import { SUPPORTED_CHAINS, type ChainConfig } from "./chains";
import { dbRun, dbBatch } from "./db";

const VAULT_EVENTS_ABI = [
  "event Deposited(bytes32 indexed hashedUserId, uint256 amount)",
];

// In-memory last-processed block per chain (hackathon; could persist to DB)
const lastBlock: Record<string, number> = {};

async function pollChain(chainId: string, chain: ChainConfig): Promise<number> {
  if (!chain.rpcUrl || !chain.vaultAddress) return 0;

  const provider = new ethers.JsonRpcProvider(chain.rpcUrl);
  const vault = new ethers.Contract(chain.vaultAddress, VAULT_EVENTS_ABI, provider);

  const latestBlock = await provider.getBlockNumber();
  const fromBlock = (lastBlock[chainId] ?? latestBlock) + 1;

  if (fromBlock > latestBlock) return 0;

  // Cap range to avoid RPC limits (2000 blocks per query)
  const toBlock = Math.min(fromBlock + 2000, latestBlock);

  const events = await vault.queryFilter(
    vault.filters.Deposited(),
    fromBlock,
    toBlock,
  );

  if (events.length > 0) {
    const statements = events.flatMap((ev) => {
      const log = ev as ethers.EventLog;
      const hashedUserId = log.args[0] as string;
      const amount = Number(log.args[1] as bigint);

      return [
        {
          sql: `INSERT OR IGNORE INTO users (hashedUserId, sessionExpiry) VALUES (?, 0)`,
          args: [hashedUserId],
        },
        {
          sql: `INSERT INTO balances (hashedUserId, chainId, deposited, allocated)
                VALUES (?, ?, ?, 0)
                ON CONFLICT(hashedUserId, chainId) DO UPDATE SET deposited = deposited + ?`,
          args: [hashedUserId, chainId, amount, amount],
        },
      ];
    });

    await dbBatch(statements);
  }

  lastBlock[chainId] = toBlock;

  return events.length;
}

export async function pollOnce(): Promise<Record<string, number>> {
  const results: Record<string, number> = {};

  for (const [chainId, chain] of Object.entries(SUPPORTED_CHAINS)) {
    try {
      results[chainId] = await pollChain(chainId, chain);
    } catch (err) {
      console.error(`[event-listener] Error polling ${chainId}:`, err);
      results[chainId] = -1;
    }
  }

  return results;
}

let timer: NodeJS.Timeout | null = null;

export function startEventListener(intervalMs = 15_000): NodeJS.Timeout {
  if (timer) return timer;

  // Fire immediately, then repeat
  pollOnce().catch((err) =>
    console.error("[event-listener] Initial poll error:", err),
  );

  timer = setInterval(() => {
    pollOnce().catch((err) =>
      console.error("[event-listener] Poll error:", err),
    );
  }, intervalMs);

  console.log(`[event-listener] Started, interval=${intervalMs}ms`);
  return timer;
}

export function stopEventListener(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    console.log("[event-listener] Stopped");
  }
}
