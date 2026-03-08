"use client";

import { useState } from "react";
import {
  MiniKit,
  type VerifyCommandInput,
  VerificationLevel,
} from "@worldcoin/minikit-js";

interface Props {
  /** Called on successful verification with token + CRE public key */
  onVerified: (session: {
    token: string;
    hashedUserId: string;
    crePublicKey: string;
  }) => void;
}

type Status = "idle" | "verifying" | "submitting" | "error";

export default function WorldIDVerify({ onVerified }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleVerify() {
    if (!MiniKit.isInstalled()) {
      setStatus("error");
      setErrorMsg("Please open this app inside World App.");
      return;
    }

    setStatus("verifying");
    setErrorMsg("");

    try {
      const verifyPayload: VerifyCommandInput = {
        action: "privapoll-auth",
        verification_level: VerificationLevel.Orb,
      };

      const { finalPayload } =
        await MiniKit.commandsAsync.verify(verifyPayload);

      if (!finalPayload || finalPayload.status === "error") {
        throw new Error("World ID verification was cancelled or failed.");
      }

      // Type-narrow to single-action success payload
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
        body: JSON.stringify({
          proof: payload.proof,
          merkle_root: payload.merkle_root,
          nullifier_hash: payload.nullifier_hash,
          verification_level: payload.verification_level,
          action: "privapoll-auth",
        }),
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

  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-violet-900/40">
        <svg
          className="h-7 w-7 text-violet-400"
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
        <p className="text-sm font-semibold text-zinc-100">
          Verify your identity
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          One person, one vote. Verify with World ID to place your bet.
        </p>
      </div>

      <button
        onClick={handleVerify}
        disabled={status === "verifying" || status === "submitting"}
        className="w-full rounded-lg bg-violet-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {status === "verifying"
          ? "Verifying..."
          : status === "submitting"
            ? "Confirming..."
            : "Verify with World ID"}
      </button>

      {status === "error" && (
        <p className="text-xs text-red-400">{errorMsg}</p>
      )}
    </div>
  );
}
