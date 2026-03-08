"use client";

import { useEffect, useState } from "react";
import MarketCard, { type MarketSummary } from "@/components/mini/MarketCard";

type Status = "loading" | "error" | "ok";

export default function MiniAppHome() {
  const [markets, setMarkets] = useState<MarketSummary[]>([]);
  const [status, setStatus] = useState<Status>("loading");

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
      <div className="flex items-center justify-center py-20 text-zinc-500">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-600 border-t-violet-400" />
        <span className="ml-3 text-sm">Loading markets...</span>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="rounded-xl border border-red-900 bg-red-950/50 p-6 text-center text-sm text-red-400">
        Failed to load markets. Pull down to retry.
      </div>
    );
  }

  if (markets.length === 0) {
    return (
      <div className="py-20 text-center text-sm text-zinc-500">
        No markets yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wide">
        Active Markets
      </h2>
      {markets.map((m) => (
        <MarketCard key={m.marketId} market={m} />
      ))}
    </div>
  );
}
