"use client";

import { useEffect, useState } from "react";
import MarketCard, { type MarketSummary } from "@/components/mini/MarketCard";
import { loadSession } from "@/lib/session";

type Status = "loading" | "error" | "ok";

export default function Home() {
  const [markets, setMarkets] = useState<MarketSummary[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [balance, setBalance] = useState<number | null>(null);
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    const session = loadSession();
    if (session) {
      setHasSession(true);
      fetch("/api/positions", {
        headers: { Authorization: `Bearer ${session.token}` },
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data?.balance != null) setBalance(data.balance);
        })
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    fetch("/api/markets")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        setMarkets(data.markets);
        setStatus("ok");
      })
      .catch(() => setStatus("error"));
  }, []);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-500">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-600 border-t-violet-400" />
        <span className="ml-3 text-sm">Loading markets...</span>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <div className="rounded-xl border border-red-900 bg-red-950/50 p-6 text-center text-sm text-red-400">
          Failed to load markets.
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans">
      <header className="sticky top-0 z-50 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-sm px-4 py-3">
        <h1 className="text-lg font-bold tracking-tight">OneShot</h1>
      </header>
      <main className="mx-auto max-w-lg px-4 py-4">
        {hasSession ? (
          balance != null ? (
            <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-sm">
              <span className="text-zinc-400">Your balance: </span>
              <span className="font-semibold text-zinc-100">
                ${(balance / 1e6).toFixed(2)} USDC
              </span>
            </div>
          ) : null
        ) : (
          <p className="mb-4 text-xs text-zinc-600">
            Verify with World ID to see your balance
          </p>
        )}
        {markets.length === 0 ? (
          <div className="py-20 text-center text-sm text-zinc-500">No markets yet.</div>
        ) : (
          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wide">
              Active Markets
            </h2>
            {markets.map((m) => (
              <MarketCard key={m.marketId} market={m} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
