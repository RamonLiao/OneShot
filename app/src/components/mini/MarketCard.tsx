import Link from "next/link";

export interface MarketSummary {
  marketId: number;
  question: string;
  marketType: string;
  status: string;
  closeTime: number;
  totalBets: number;
  totalVolume: number;
  options: { id: number; label: string }[];
}

function timeRemaining(closeTime: number): string {
  const diff = closeTime * 1000 - Date.now();
  if (diff <= 0) return "Closed";
  const hours = Math.floor(diff / 3_600_000);
  const mins = Math.floor((diff % 3_600_000) / 60_000);
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  return `${hours}h ${mins}m`;
}

interface Props {
  market: MarketSummary;
  myBetAmount?: number; // in micro-USDC (6 decimals)
}

export default function MarketCard({ market, myBetAmount }: Props) {
  const remaining = timeRemaining(market.closeTime);
  const isOpen = market.status === "Open";
  const hasBet = myBetAmount != null && myBetAmount > 0;

  return (
    <Link href={`/market/${market.marketId}`}>
      <div
        className={`rounded-xl border p-4 transition-colors active:bg-surface-3 ${
          hasBet
            ? "border-brand-teal/40 bg-brand-teal/10 hover:border-brand-teal"
            : "border-border-dim bg-surface-2 hover:border-border-default"
        }`}
      >
        {/* Badge row */}
        <div className="mb-2 flex items-center gap-2">
          <span className="shrink-0 rounded-full bg-brand-teal/20 px-2 py-0.5 text-[11px] font-medium text-brand-teal uppercase tracking-wide">
            {market.marketType}
          </span>
          {hasBet && (
            <span className="shrink-0 rounded-full bg-brand-teal/30 px-2 py-0.5 text-[11px] font-medium text-brand-teal">
              ${(myBetAmount / 1e6).toFixed(2)} bet
            </span>
          )}
          <span
            className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
              isOpen
                ? "bg-brand-green/20 text-brand-green"
                : "bg-surface-3 text-text-secondary"
            }`}
          >
            {isOpen ? remaining : "Closed"}
          </span>
        </div>

        {/* Question */}
        <p className="text-sm font-semibold leading-snug text-text-primary">
          {market.question}
        </p>

        {/* Stats */}
        <div className="mt-3 flex gap-4 text-xs text-text-secondary">
          <span>{market.totalBets} bets</span>
          <span>${(market.totalVolume / 1e6).toFixed(2)} volume</span>
        </div>
      </div>
    </Link>
  );
}
