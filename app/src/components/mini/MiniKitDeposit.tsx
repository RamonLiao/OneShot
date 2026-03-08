"use client";

import { useState } from "react";

interface Props {
  hashedUserId: string;
  token: string;
}

type Status = "idle" | "submitting" | "success" | "error";

const QUICK_AMOUNTS = [1, 5, 10, 20];
const IS_MOCK = process.env.NEXT_PUBLIC_MOCK_DEPOSIT === "true";

export default function MiniKitDeposit({ hashedUserId, token }: Props) {
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [newBalance, setNewBalance] = useState<number | null>(null);

  async function handleDeposit() {
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      setErrorMsg("Enter a valid amount");
      return;
    }

    setStatus("submitting");
    setErrorMsg("");

    try {
      if (IS_MOCK) {
        await handleMockDeposit(amountNum);
      } else {
        await handleRealDeposit(amountNum);
      }
    } catch (err: unknown) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Deposit failed");
    }
  }

  async function handleMockDeposit(amountNum: number) {
    const res = await fetch("/api/deposits/mock", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ amount: Math.round(amountNum * 1e6) }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Mock deposit failed (${res.status})`);
    }

    const data = await res.json();
    setNewBalance(data.newBalance);
    setStatus("success");
  }

  async function handleRealDeposit(amountNum: number) {
    const { MiniKit, tokenToDecimals, Tokens } = await import(
      "@worldcoin/minikit-js"
    );

    const reference = crypto.randomUUID();

    const result = await MiniKit.commandsAsync.pay({
      reference,
      to: process.env.NEXT_PUBLIC_VAULT_WORLD_ADDRESS!,
      tokens: [
        {
          symbol: Tokens.USDC,
          token_amount: tokenToDecimals(amountNum, Tokens.USDC).toString(),
        },
      ],
      description: "Deposit to OneShot",
    });

    if (result.finalPayload.status !== "success") {
      throw new Error("Payment was not completed");
    }

    const res = await fetch("/api/deposits/confirm", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        reference,
        hashedUserId,
        amount: Math.round(amountNum * 1e6),
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Confirm failed (${res.status})`);
    }

    const data = await res.json();
    setNewBalance(data.newBalance);
    setStatus("success");
  }

  if (status === "success") {
    return (
      <div className="rounded-xl border border-brand-green/60 bg-brand-green/10 p-6 text-center">
        <p className="text-sm font-semibold text-brand-green">
          Deposit successful!
        </p>
        {newBalance !== null && (
          <p className="mt-1 text-xs text-text-secondary">
            Balance: ${(newBalance / 1e6).toFixed(2)} USDC
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {IS_MOCK && (
        <div className="rounded-lg bg-brand-orange/15 border border-brand-orange/30 px-3 py-1.5 text-[11px] text-brand-orange">
          Demo mode — no real funds
        </div>
      )}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-text-secondary uppercase tracking-wide">
          Deposit Amount (USDC)
        </label>
        <input
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="10.00"
          className="w-full rounded-lg border border-border-default bg-surface-2 px-3 py-2.5 text-sm text-text-primary placeholder:text-text-dim focus:border-brand-teal focus:outline-none"
        />
        <div className="mt-2 grid grid-cols-4 gap-2">
          {QUICK_AMOUNTS.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setAmount(String(v))}
              className={`rounded-lg border py-1.5 text-xs font-medium transition-colors ${
                amount === String(v)
                  ? "border-brand-teal bg-brand-teal/15 text-brand-teal"
                  : "border-border-default bg-surface-2 text-text-secondary hover:border-border-default"
              }`}
            >
              ${v}
            </button>
          ))}
        </div>
      </div>

      {(status === "error" || errorMsg) && (
        <p className="text-xs text-red-400">{errorMsg}</p>
      )}

      <button
        type="button"
        onClick={handleDeposit}
        disabled={status === "submitting"}
        className="w-full rounded-lg bg-brand-teal px-4 py-3 text-sm font-semibold text-surface-0 transition-colors hover:bg-brand-teal/90 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {status === "submitting"
          ? "Processing..."
          : IS_MOCK
            ? "Add Demo Funds"
            : "Deposit via World App"}
      </button>
    </div>
  );
}
