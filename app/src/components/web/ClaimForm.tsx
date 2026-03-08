"use client";

import { useState, useEffect, useCallback } from "react";
import {
  useAccount,
  useChainId,
  useWriteContract,
  useWaitForTransactionReceipt,
  useSwitchChain,
} from "wagmi";
import { VAULT_ADDRESSES, VAULT_ABI, SUPPORTED_CHAINS } from "@/lib/wagmi-config";

interface Payout {
  marketId: number;
  chainId: string;
  amount: number;
  claimed: number;
  claimTxHash: string | null;
  question: string;
}

interface ClaimState {
  step: "idle" | "preparing" | "claiming" | "confirming" | "success" | "error";
  errorMsg: string;
  txHash: string | undefined;
}

// Map backend chainId strings to viem chain IDs
const CHAIN_ID_MAP: Record<string, number> = {
  "base-sepolia": 84532,
  "arbitrum-sepolia": 421614,
  "optimism-sepolia": 11155420,
};

export default function ClaimForm({ jwt }: { jwt: string }) {
  const { isConnected } = useAccount();
  const currentChainId = useChainId();
  const { switchChain } = useSwitchChain();

  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");
  const [claimStates, setClaimStates] = useState<Record<string, ClaimState>>({});

  // Active claim tracking
  const [activeClaimKey, setActiveClaimKey] = useState<string | null>(null);

  const {
    writeContract,
    data: claimTxHash,
    error: claimError,
    reset: resetClaim,
  } = useWriteContract();

  const { isSuccess: claimConfirmed } = useWaitForTransactionReceipt({
    hash: claimTxHash,
  });

  // Fetch positions
  const fetchPayouts = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/positions", {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPayouts(data.payouts || []);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Failed to fetch");
    } finally {
      setLoading(false);
    }
  }, [jwt]);

  useEffect(() => {
    if (jwt) fetchPayouts();
  }, [jwt, fetchPayouts]);

  // Track claim confirmation
  useEffect(() => {
    if (claimTxHash && activeClaimKey) {
      updateClaimState(activeClaimKey, { step: "confirming", txHash: claimTxHash });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claimTxHash]);

  useEffect(() => {
    if (claimConfirmed && activeClaimKey) {
      updateClaimState(activeClaimKey, { step: "success", txHash: claimTxHash });
      setActiveClaimKey(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claimConfirmed]);

  useEffect(() => {
    if (claimError && activeClaimKey) {
      updateClaimState(activeClaimKey, {
        step: "error",
        errorMsg: claimError.message.slice(0, 200),
      });
      setActiveClaimKey(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claimError]);

  function updateClaimState(key: string, partial: Partial<ClaimState>) {
    setClaimStates((prev) => ({
      ...prev,
      [key]: { ...prev[key], ...partial } as ClaimState,
    }));
  }

  async function handleClaim(payout: Payout) {
    const key = `${payout.marketId}-${payout.chainId}`;
    const numericChainId = CHAIN_ID_MAP[payout.chainId];
    if (!numericChainId) {
      updateClaimState(key, { step: "error", errorMsg: `Unknown chain: ${payout.chainId}`, txHash: undefined });
      return;
    }

    // Switch chain if needed
    if (currentChainId !== numericChainId) {
      switchChain({ chainId: numericChainId });
      return;
    }

    resetClaim();
    setActiveClaimKey(key);
    updateClaimState(key, { step: "preparing", errorMsg: "", txHash: undefined });

    try {
      // 1. prepare-claim API
      const res = await fetch("/api/payout/prepare-claim", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({ marketId: payout.marketId, chainId: payout.chainId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const { hashedUserId, marketId, amount, deadline, signature } = await res.json();

      // 2. Call Vault.claim on-chain
      const vaultAddress = VAULT_ADDRESSES[numericChainId];
      updateClaimState(key, { step: "claiming" });

      writeContract({
        address: vaultAddress,
        abi: VAULT_ABI,
        functionName: "claim",
        args: [
          hashedUserId as `0x${string}`,
          BigInt(marketId),
          BigInt(amount),
          BigInt(deadline),
          signature as `0x${string}`,
        ],
        chainId: numericChainId,
      });
    } catch (e) {
      updateClaimState(key, {
        step: "error",
        errorMsg: e instanceof Error ? e.message : "Claim failed",
      });
      setActiveClaimKey(null);
    }
  }

  if (!isConnected) {
    return <p className="text-gray-500">Connect your wallet to claim payouts.</p>;
  }

  if (loading) {
    return <p className="text-gray-400">Loading positions...</p>;
  }

  if (fetchError) {
    return <p className="text-red-400">Error: {fetchError}</p>;
  }

  const claimable = payouts.filter((p) => !p.claimed);
  const claimed = payouts.filter((p) => p.claimed);

  return (
    <div className="space-y-6">
      {claimable.length === 0 && claimed.length === 0 && (
        <p className="text-gray-500">No payouts found.</p>
      )}

      {claimable.length > 0 && (
        <div>
          <h3 className="text-sm text-gray-400 mb-3 uppercase tracking-wide">Claimable</h3>
          <div className="space-y-3">
            {claimable.map((p) => {
              const key = `${p.marketId}-${p.chainId}`;
              const cs = claimStates[key] || { step: "idle", errorMsg: "", txHash: undefined };
              const numericChainId = CHAIN_ID_MAP[p.chainId];
              const chainName = SUPPORTED_CHAINS.find((c) => c.id === numericChainId)?.name || p.chainId;

              return (
                <div key={key} className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-white font-medium truncate">{p.question}</p>
                      <p className="text-sm text-gray-400 mt-1">
                        {(p.amount / 1e6).toFixed(2)} USDC on {chainName}
                      </p>
                    </div>
                    <button
                      onClick={() => handleClaim(p)}
                      disabled={cs.step === "preparing" || cs.step === "claiming" || cs.step === "confirming" || cs.step === "success"}
                      className="shrink-0 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white px-4 py-1.5 rounded-lg text-sm font-medium transition-colors"
                    >
                      {cs.step === "preparing"
                        ? "Preparing..."
                        : cs.step === "claiming"
                        ? "Confirm in wallet..."
                        : cs.step === "confirming"
                        ? "Confirming..."
                        : cs.step === "success"
                        ? "Claimed"
                        : currentChainId !== numericChainId
                        ? "Switch & Claim"
                        : "Claim"}
                    </button>
                  </div>
                  {cs.step === "success" && cs.txHash && (
                    <p className="text-green-400 text-xs mt-2 font-mono break-all">tx: {cs.txHash}</p>
                  )}
                  {cs.step === "error" && (
                    <p className="text-red-400 text-xs mt-2">{cs.errorMsg}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {claimed.length > 0 && (
        <div>
          <h3 className="text-sm text-gray-400 mb-3 uppercase tracking-wide">Already Claimed</h3>
          <div className="space-y-2">
            {claimed.map((p) => (
              <div
                key={`${p.marketId}-${p.chainId}`}
                className="bg-gray-900/50 border border-gray-800/50 rounded-lg p-3 opacity-60"
              >
                <p className="text-white text-sm truncate">{p.question}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {(p.amount / 1e6).toFixed(2)} USDC -- claimed
                  {p.claimTxHash && <span className="font-mono ml-1">({p.claimTxHash.slice(0, 10)}...)</span>}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
