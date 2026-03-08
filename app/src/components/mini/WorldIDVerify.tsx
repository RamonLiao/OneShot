"use client";

import { useState } from "react";
import {
  MiniKit,
  type VerifyCommandInput,
  VerificationLevel,
} from "@worldcoin/minikit-js";

interface Props {
  onVerified: (session: {
    token: string;
    hashedUserId: string;
    crePublicKey: string;
  }) => void;
}

type Status = "idle" | "verifying" | "submitting" | "error";

const ACTION = "privapoll-auth";

export default function WorldIDVerify({ onVerified }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const isMiniKit = typeof window !== "undefined" && MiniKit.isInstalled();

  // ─── MiniKit flow (inside World App) ───
  async function handleMiniKitVerify() {
    setStatus("verifying");
    setErrorMsg("");
    try {
      const verifyPayload: VerifyCommandInput = {
        action: ACTION,
        verification_level: VerificationLevel.Orb,
      };
      const { finalPayload } =
        await MiniKit.commandsAsync.verify(verifyPayload);

      if (!finalPayload || finalPayload.status === "error") {
        throw new Error("World ID verification was cancelled or failed.");
      }

      const payload = finalPayload as {
        proof: string;
        merkle_root: string;
        nullifier_hash: string;
        verification_level: string;
      };

      setStatus("submitting");
      const res = await fetch("/api/worldid/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, action: ACTION }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Verification failed (${res.status})`);
      }
      const data = await res.json();
      onVerified(data);
    } catch (err: unknown) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Verification failed");
    }
  }

  // ─── Demo flow (browser, no World App) ───
  async function handleDemoVerify() {
    setStatus("submitting");
    setErrorMsg("");
    try {
      const res = await fetch("/api/worldid/demo", { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Demo login failed");
      }
      const data = await res.json();
      onVerified(data);
    } catch (err: unknown) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Demo login failed");
    }
  }

  const buttonDisabled = status === "verifying" || status === "submitting";
  const buttonLabel =
    status === "verifying"
      ? "Verifying..."
      : status === "submitting"
        ? "Confirming..."
        : "Verify with World ID";

  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-border-dim bg-surface-2 p-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-teal/20">
        <svg
          className="h-7 w-7 text-brand-teal"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z"
          />
        </svg>
      </div>

      <div>
        <p className="text-sm font-semibold text-text-primary">
          Verify your identity
        </p>
        <p className="mt-1 text-xs text-text-secondary">
          One person, one vote. Verify with World ID to place your bet.
        </p>
      </div>

      {isMiniKit ? (
        <button
          onClick={handleMiniKitVerify}
          disabled={buttonDisabled}
          className="w-full rounded-lg bg-brand-teal px-4 py-3 text-sm font-semibold text-surface-0 transition-colors hover:bg-brand-teal/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {buttonLabel}
        </button>
      ) : (
        <div className="flex w-full flex-col gap-2">
          <button
            onClick={handleDemoVerify}
            disabled={buttonDisabled}
            className="w-full rounded-lg bg-brand-teal px-4 py-3 text-sm font-semibold text-surface-0 transition-colors hover:bg-brand-teal/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {status === "submitting" ? "Logging in..." : "Enter Demo Mode"}
          </button>
          <p className="text-[10px] text-text-dim">
            World ID verification requires World App.
            Demo mode lets you explore the full experience.
          </p>
        </div>
      )}

      {status === "error" && (
        <p className="text-xs text-red-600 dark:text-red-400">{errorMsg}</p>
      )}
    </div>
  );
}
