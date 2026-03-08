"use client";

import { useState, useCallback, useEffect } from "react";
import ClaimForm from "@/components/web/ClaimForm";

// IDKit types -- defined locally to avoid build issues when @worldcoin/idkit isn't installed
interface WorldIDResult {
  merkle_root: string;
  nullifier_hash: string;
  proof: string;
  verification_level: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IDKitModule = any;

export default function ClaimPage() {
  const [jwt, setJwt] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");
  const [idkitMod, setIdkitMod] = useState<IDKitModule>(null);

  // Dynamically import idkit to avoid build errors if not installed
  useEffect(() => {
    import("@worldcoin/idkit")
      .then((mod) => setIdkitMod(mod))
      .catch(() => {
        // idkit not available -- hackathon bypass only
      });
  }, []);

  const handleVerify = useCallback(async (result: WorldIDResult) => {
    setVerifying(true);
    setError("");
    try {
      const res = await fetch("/api/worldid/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merkle_root: result.merkle_root,
          nullifier_hash: result.nullifier_hash,
          proof: result.proof,
          verification_level: result.verification_level,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Verification failed" }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setJwt(data.token);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification failed");
    } finally {
      setVerifying(false);
    }
  }, []);

  const appId = process.env.NEXT_PUBLIC_WORLDCOIN_APP_ID || "app_staging_0000000000000000000000";

  const IDKitWidget = idkitMod?.IDKitWidget;
  const VerificationLevel = idkitMod?.VerificationLevel;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Claim Payouts</h1>
      <p className="text-gray-400 text-sm mb-8">
        Verify your identity with World ID, then claim your winnings from settled markets.
      </p>

      {!jwt ? (
        <div className="space-y-4">
          {IDKitWidget && VerificationLevel ? (
            <IDKitWidget
              app_id={appId}
              action="claim-payout"
              verification_level={VerificationLevel.Orb}
              onSuccess={handleVerify}
            >
              {({ open }: { open: () => void }) => (
                <button
                  onClick={open}
                  disabled={verifying}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white py-3 rounded-lg font-medium transition-colors"
                >
                  {verifying ? "Verifying..." : "Verify with World ID"}
                </button>
              )}
            </IDKitWidget>
          ) : (
            <p className="text-gray-500 text-sm">
              World ID widget not available. Use JWT bypass below.
            </p>
          )}

          {error && <p className="text-red-400 text-sm">{error}</p>}

          {/* Hackathon bypass: manual JWT input */}
          <div className="border-t border-gray-800 pt-4 mt-6">
            <p className="text-xs text-gray-600 mb-2">Hackathon bypass: paste JWT directly</p>
            <input
              type="text"
              placeholder="Bearer token..."
              onChange={(e) => setJwt(e.target.value.replace(/^Bearer\s+/i, ""))}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono text-xs focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-green-400 text-sm mb-6">
            <span>Verified</span>
            <span className="text-gray-600 font-mono text-xs">
              ({jwt.slice(0, 20)}...)
            </span>
          </div>
          <ClaimForm jwt={jwt} />
        </div>
      )}
    </div>
  );
}
