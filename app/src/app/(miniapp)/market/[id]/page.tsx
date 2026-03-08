"use client";

import { useEffect, useState, use } from "react";
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
      {/* Back link */}
      <a href="/" className="text-xs text-zinc-500 hover:text-zinc-300">
        &larr; Back to markets
      </a>

      {/* Market info */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 overflow-hidden">
        <div className="mb-2 flex items-center gap-2 flex-wrap">
          <span className="rounded-full bg-violet-900/60 px-2 py-0.5 text-[11px] font-medium text-violet-300 uppercase tracking-wide">
            {market.marketType}
          </span>
          <span
            className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium ${
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
      ) : (
        <div className="flex flex-col gap-4">
          {/* Deposit toggle */}
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

          {/* Bet form */}
          <BetForm
            marketId={market.marketId}
            options={market.options}
            marketType={market.marketType}
            scalarLow={market.scalarLow}
            scalarHigh={market.scalarHigh}
            token={session.token}
            crePublicKey={session.crePublicKey}
          />
        </div>
      )}
    </div>
  );
}
