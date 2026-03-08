"use client";

import { useState } from "react";
import { getWallets, type Wallet } from "@/lib/session";

interface Props {
  marketId: number;
  options: string[];
  marketType: string;
  scalarLow?: number;
  scalarHigh?: number;
  token: string;
  crePublicKey: string;
  walletAddress?: string;
}

type Status = "idle" | "submitting" | "success" | "error";

const QUICK_AMOUNTS = [1, 5, 10, 20];

/**
 * RSA-OAEP encrypt the bet payload using the CRE public key.
 * crePublicKey is expected as a base64-encoded SPKI DER key
 * (PEM without header/footer/newlines).
 */
async function encryptPayload(
  payload: {
    optionId?: number;
    scalarValue?: number;
    amount: string;
    payoutChainId: string;
    payoutAddress: string;
  },
  crePublicKey: string,
): Promise<string> {
  const spkiDer = Uint8Array.from(atob(crePublicKey), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "spki",
    spkiDer.buffer,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"],
  );
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertextBuf = await crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    key,
    plaintext,
  );
  return btoa(String.fromCharCode(...new Uint8Array(ciphertextBuf)));
}

export default function BetForm({
  marketId,
  options,
  marketType,
  scalarLow,
  scalarHigh,
  token,
  crePublicKey,
  walletAddress,
}: Props) {
  const isScalar = marketType === "Scalar";
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [scalarValue, setScalarValue] = useState<number>(scalarLow ?? 0);
  const [amount, setAmount] = useState("");
  const [savedWallets] = useState<Wallet[]>(() => getWallets());
  const [walletMode, setWalletMode] = useState<"saved" | "manual">(
    "saved",
  );
  const [selectedWalletIdx, setSelectedWalletIdx] = useState(0);
  const [payoutAddress, setPayoutAddress] = useState(walletAddress ?? "");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [betId, setBetId] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (isScalar) {
      if (scalarLow != null && scalarHigh != null && (scalarValue < scalarLow || scalarValue > scalarHigh)) {
        setErrorMsg(`Value must be between ${scalarLow} and ${scalarHigh}`);
        return;
      }
    } else if (selectedOption === null) {
      setErrorMsg("Select an option");
      return;
    }
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      setErrorMsg("Enter a valid amount");
      return;
    }
    const finalAddress =
      walletMode === "saved" && savedWallets.length > 0
        ? savedWallets[selectedWalletIdx]?.address
        : payoutAddress;
    const finalChain =
      walletMode === "saved" && savedWallets.length > 0
        ? savedWallets[selectedWalletIdx]?.chain
        : "world-chain";

    if (!finalAddress || !finalAddress.startsWith("0x")) {
      setErrorMsg("Enter a valid payout address");
      return;
    }

    setStatus("submitting");
    setErrorMsg("");

    try {
      let ciphertext = "";
      const betPayload = {
        ...(isScalar
          ? { scalarValue }
          : { optionId: options.indexOf(selectedOption!) }),
        amount: String(Math.round(amountNum * 1e6)),
        payoutChainId: finalChain,
        payoutAddress: finalAddress,
      };

      if (crePublicKey) {
        // Strip PEM headers if present (legacy sessions may have them)
        const cleanKey = crePublicKey
          .replace(/-----BEGIN [A-Z ]+-----/g, "")
          .replace(/-----END [A-Z ]+-----/g, "")
          .replace(/\s+/g, "");
        try {
          ciphertext = await encryptPayload(betPayload, cleanKey);
        } catch {
          setStatus("error");
          setErrorMsg("Encryption failed — try logging out and back in from Settings");
          return;
        }
      }

      const res = await fetch("/api/bet", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          marketId,
          ciphertext,
          amount: Math.round(amountNum * 1e6),
          sourceChainId: finalChain,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Request failed (${res.status})`);
      }

      const data = await res.json();
      setBetId(data.betId);
      setStatus("success");
    } catch (err: unknown) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Failed to place bet");
    }
  }

  if (status === "success") {
    return (
      <div className="rounded-xl border border-emerald-800 bg-emerald-950/50 p-6 text-center">
        <div className="mb-2 text-2xl">OK</div>
        <p className="text-sm font-semibold text-emerald-300">Bet placed!</p>
        <p className="mt-1 text-xs text-zinc-500 break-all">ID: {betId}</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {/* Prediction input */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-zinc-400 uppercase tracking-wide">
          Your prediction
        </label>
        {isScalar ? (
          <div className="flex flex-col gap-3">
            <input
              type="range"
              min={scalarLow ?? 0}
              max={scalarHigh ?? 100}
              value={scalarValue}
              onChange={(e) => setScalarValue(Number(e.target.value))}
              className="w-full accent-violet-500"
            />
            <div className="flex items-center gap-3">
              <input
                type="text"
                inputMode="decimal"
                value={scalarValue}
                onChange={(e) => setScalarValue(Number(e.target.value))}
                className="w-24 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-violet-500 focus:outline-none"
              />
              <span className="text-xs text-zinc-500">
                Range: {scalarLow ?? 0} - {scalarHigh ?? 100}
              </span>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {options.map((label, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setSelectedOption(label)}
                className={`rounded-lg border px-4 py-3 text-sm font-semibold transition-colors ${
                  selectedOption === label
                    ? "border-violet-500 bg-violet-600/20 text-violet-300"
                    : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Amount */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-zinc-400 uppercase tracking-wide">
          Amount (USDC)
        </label>
        <input
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="10.00"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-violet-500 focus:outline-none"
        />
        <div className="mt-2 grid grid-cols-4 gap-2">
          {QUICK_AMOUNTS.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setAmount(String(v))}
              className={`rounded-lg border py-1.5 text-xs font-medium transition-colors ${
                amount === String(v)
                  ? "border-violet-500 bg-violet-600/20 text-violet-300"
                  : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-500"
              }`}
            >
              ${v}
            </button>
          ))}
        </div>
      </div>

      {/* Payout address */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-zinc-400 uppercase tracking-wide">
          Your wallet (for payouts)
        </label>
        {savedWallets.length > 0 && (
          <div className="mb-2 flex gap-2 text-xs">
            <button
              type="button"
              onClick={() => setWalletMode("saved")}
              className={`underline-offset-2 ${walletMode === "saved" ? "text-violet-400 underline" : "text-zinc-500 hover:text-zinc-300"}`}
            >
              Saved wallets
            </button>
            <button
              type="button"
              onClick={() => setWalletMode("manual")}
              className={`underline-offset-2 ${walletMode === "manual" ? "text-violet-400 underline" : "text-zinc-500 hover:text-zinc-300"}`}
            >
              Enter manually
            </button>
          </div>
        )}
        {savedWallets.length > 0 && walletMode === "saved" ? (
          <select
            value={selectedWalletIdx}
            onChange={(e) => setSelectedWalletIdx(Number(e.target.value))}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-xs text-zinc-100 focus:border-violet-500 focus:outline-none"
          >
            {savedWallets.map((w, i) => (
              <option key={`${w.chain}-${w.address}`} value={i}>
                {w.name} ({w.chain})
              </option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            value={payoutAddress}
            onChange={(e) => setPayoutAddress(e.target.value)}
            placeholder="0x..."
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-xs font-mono text-zinc-100 placeholder:text-zinc-600 focus:border-violet-500 focus:outline-none truncate"
          />
        )}
      </div>

      {/* Error */}
      {(status === "error" || errorMsg) && (
        <p className="text-xs text-red-400">{errorMsg}</p>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={status === "submitting"}
        className="mt-1 w-full rounded-lg bg-violet-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {status === "submitting" ? "Placing bet..." : "Place Bet"}
      </button>

      <p className="text-center text-[10px] text-zinc-600">
        Your bet is encrypted before submission. No one can see your choice until
        settlement.
      </p>
    </form>
  );
}
