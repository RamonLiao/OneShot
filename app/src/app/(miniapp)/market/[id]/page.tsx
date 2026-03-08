"use client";

import { useEffect, useState, use, useCallback } from "react";
import WorldIDVerify from "@/components/mini/WorldIDVerify";
import BetForm from "@/components/mini/BetForm";
import MiniKitDeposit from "@/components/mini/MiniKitDeposit";
import {
  loadSession,
  saveSession,
  type Session,
} from "@/lib/session";

interface MarketDetail {
  marketId: number;
  question: string;
  options: string[];
  marketType: string;
  scalarLow?: number;
  scalarHigh?: number;
  status: string;
  closeTime: number;
  totalBets: number;
  totalVolume: number;
}

interface ExistingBet {
  betId: string;
  amount: number;
  sourceChainId: string;
  createdAt: number;
}

type LoadStatus = "loading" | "error" | "ok";

export default function MarketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [market, setMarket] = useState<MarketDetail | null>(null);
  const [loadStatus, setLoadStatus] = useState<LoadStatus>("loading");
  const [session, setSession] = useState<Session | null>(null);
  const [showDeposit, setShowDeposit] = useState(false);
  const [existingBet, setExistingBet] = useState<ExistingBet | null>(null);
  const [betLoading, setBetLoading] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    const cached = loadSession();
    if (cached) setSession(cached);
  }, []);

  useEffect(() => {
    fetch(`/api/markets/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        setMarket(data);
        setLoadStatus("ok");
      })
      .catch(() => setLoadStatus("error"));
  }, [id]);

  const fetchExistingBet = useCallback(() => {
    if (!session) return;
    setBetLoading(true);
    fetch(`/api/bet/${id}`, {
      headers: { Authorization: `Bearer ${session.token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.hasBet) setExistingBet(data.bet);
        else setExistingBet(null);
      })
      .catch(() => {})
      .finally(() => setBetLoading(false));
  }, [session, id]);

  useEffect(() => {
    fetchExistingBet();
  }, [fetchExistingBet]);

  async function handleCancel() {
    if (!session || !existingBet) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/bet/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "Cancel failed");
        return;
      }
      setExistingBet(null);
    } finally {
      setCancelling(false);
    }
  }

  if (loadStatus === "loading") {
    return (
      <div className="flex items-center justify-center py-20 text-zinc-500">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-600 border-t-violet-400" />
      </div>
    );
  }

  if (loadStatus === "error" || !market) {
    return (
      <div className="rounded-xl border border-red-900 bg-red-950/50 p-6 text-center text-sm text-red-400">
        Market not found.
      </div>
    );
  }

  const isOpen = market.status === "Open";
  const closeDate = new Date(market.closeTime * 1000);

  return (
    <div className="flex flex-col gap-5">
      <a href="/" className="text-xs text-zinc-500 hover:text-zinc-300">
        &larr; Back to markets
      </a>

      {/* Market info */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <div className="mb-2 flex items-center gap-2">
          <span className="shrink-0 rounded-full bg-violet-900/60 px-2 py-0.5 text-[11px] font-medium text-violet-300 uppercase tracking-wide">
            {market.marketType}
          </span>
          <span
            className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
              isOpen
                ? "bg-emerald-900/60 text-emerald-300"
                : "bg-zinc-800 text-zinc-500"
            }`}
          >
            {isOpen ? "Open" : market.status}
          </span>
        </div>

        <h2 className="text-base font-semibold leading-snug text-zinc-100 break-words">
          {market.question}
        </h2>

        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
          <span>{market.totalBets} bets</span>
          <span>${(market.totalVolume / 1e6).toFixed(2)} volume</span>
          <span>Closes {closeDate.toLocaleDateString()}</span>
        </div>
      </div>

      {/* Action area */}
      {!isOpen ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-center text-sm text-zinc-500">
          This market is no longer accepting bets.
        </div>
      ) : !session ? (
        <WorldIDVerify
          onVerified={(data) => {
            saveSession(data);
            setSession(data);
          }}
        />
      ) : betLoading ? (
        <div className="flex items-center justify-center py-10 text-zinc-500">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-600 border-t-violet-400" />
        </div>
      ) : existingBet ? (
        /* ── Existing position ── */
        <div className="rounded-xl border border-violet-800/50 bg-violet-950/30 p-5 flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-violet-300">Your Position</h3>
          <div className="flex flex-col gap-1.5 text-xs text-zinc-300">
            <div className="flex justify-between">
              <span className="text-zinc-500">Amount</span>
              <span className="font-medium">${(existingBet.amount / 1e6).toFixed(2)} USDC</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Placed</span>
              <span>{new Date(existingBet.createdAt * 1000).toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Bet ID</span>
              <span className="font-mono text-[11px] text-zinc-500 truncate ml-4 max-w-[180px]">
                {existingBet.betId}
              </span>
            </div>
          </div>
          <p className="text-[11px] text-zinc-600">
            Your prediction is encrypted. It will be revealed at settlement.
          </p>
          <button
            type="button"
            onClick={handleCancel}
            disabled={cancelling}
            className="mt-1 w-full rounded-lg border border-red-800/60 py-2.5 text-xs font-medium text-red-400 hover:bg-red-950/40 transition-colors disabled:opacity-50"
          >
            {cancelling ? "Cancelling..." : "Cancel Bet & Refund"}
          </button>
        </div>
      ) : (
        /* ── New bet form ── */
        <div className="flex flex-col gap-4">
          {showDeposit ? (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-zinc-200">Deposit USDC</h3>
                <button
                  type="button"
                  onClick={() => setShowDeposit(false)}
                  className="text-xs text-zinc-500 hover:text-zinc-300"
                >
                  Close
                </button>
              </div>
              <MiniKitDeposit
                hashedUserId={session.hashedUserId}
                token={session.token}
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowDeposit(true)}
              className="self-start text-xs text-violet-400 hover:text-violet-300 underline underline-offset-2"
            >
              Deposit USDC
            </button>
          )}

          <BetForm
            marketId={market.marketId}
            options={market.options}
            marketType={market.marketType}
            scalarLow={market.scalarLow}
            scalarHigh={market.scalarHigh}
            token={session.token}
            crePublicKey={session.crePublicKey}
            onBetPlaced={fetchExistingBet}
          />
        </div>
      )}
    </div>
  );
}
