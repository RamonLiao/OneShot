"use client";

import { useState } from "react";

interface Props {
  hashedUserId: string;
  token: string;
}

type Status = "idle" | "submitting" | "success" | "error";

export default function MiniKitDeposit({ hashedUserId, token }: Props) {
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [newBalance, setNewBalance] = useState<number | null>(null);

  async function handleDeposit() {
    const amountNum = parseFloat(amount);
    if (!amountNum || amountNum <= 0) {
      setErrorMsg("Enter a valid amount");
      return;
    }

    setStatus("submitting");
    setErrorMsg("");

    try {
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
            token_amount: tokenToDecimals(
              amountNum,
              Tokens.USDC
            ).toString(),
          },
        ],
        description: "Deposit to PrivaPoll",
      });

      if (result.finalPayload.status !== "success") {
        throw new Error("Payment was not completed");
      }

      // Confirm deposit with backend
      const res = await fetch("/api/deposits/confirm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          reference,
          hashedUserId,
          amount: Math.round(amountNum * 1e6), // USDC 6 decimals
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Confirm failed (${res.status})`);
      }

      const data = await res.json();
      setNewBalance(data.newBalance);
      setStatus("success");
    } catch (err: unknown) {
      setStatus("error");
      setErrorMsg(
        err instanceof Error ? err.message : "Deposit failed"
      );
    }
  }

  if (status === "success") {
    return (
      <div className="rounded-xl border border-emerald-800 bg-emerald-950/50 p-6 text-center">
        <p className="text-sm font-semibold text-emerald-300">
          Deposit successful!
        </p>
        {newBalance !== null && (
          <p className="mt-1 text-xs text-zinc-400">
            Balance: ${(newBalance / 1e6).toFixed(2)} USDC
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <label className="mb-1.5 block text-xs font-medium text-zinc-400 uppercase tracking-wide">
          Deposit Amount (USDC)
        </label>
        <input
          type="number"
          step="0.01"
          min="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="10.00"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-violet-500 focus:outline-none"
        />
      </div>

      {(status === "error" || errorMsg) && (
        <p className="text-xs text-red-400">{errorMsg}</p>
      )}

      <button
        type="button"
        onClick={handleDeposit}
        disabled={status === "submitting"}
        className="w-full rounded-lg bg-violet-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {status === "submitting" ? "Processing..." : "Deposit via World App"}
      </button>
    </div>
  );
}
