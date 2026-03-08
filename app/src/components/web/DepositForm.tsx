"use client";

import { useState, useEffect } from "react";
import {
  useAccount,
  useChainId,
  useWriteContract,
  useWaitForTransactionReceipt,
  useReadContract,
  useSwitchChain,
} from "wagmi";
import { parseUnits } from "viem";
import {
  SUPPORTED_CHAINS,
  VAULT_ADDRESSES,
  USDC_ADDRESSES,
  VAULT_ABI,
  ERC20_ABI,
} from "@/lib/wagmi-config";

type TxStep = "idle" | "approving" | "depositing" | "success" | "error";

export default function DepositForm() {
  const { address, isConnected } = useAccount();
  const currentChainId = useChainId();
  const { switchChain } = useSwitchChain();

  const [selectedChainId, setSelectedChainId] = useState<number>(SUPPORTED_CHAINS[0].id);
  const [amount, setAmount] = useState("");
  const [hashedUserId, setHashedUserId] = useState("");
  const [step, setStep] = useState<TxStep>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const vaultAddress = VAULT_ADDRESSES[selectedChainId];
  const usdcAddress = USDC_ADDRESSES[selectedChainId];
  const parsedAmount = amount ? parseUnits(amount, 6) : BigInt(0);

  // Read current allowance
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: usdcAddress,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: address && vaultAddress ? [address, vaultAddress] : undefined,
    query: { enabled: !!address && !!vaultAddress },
  });

  const needsApproval = allowance !== undefined && parsedAmount > BigInt(0) && (allowance as bigint) < parsedAmount;

  // Approve tx
  const {
    writeContract: writeApprove,
    data: approveTxHash,
    error: approveError,
    reset: resetApprove,
  } = useWriteContract();

  const { isSuccess: approveConfirmed } = useWaitForTransactionReceipt({
    hash: approveTxHash,
  });

  // Deposit tx
  const {
    writeContract: writeDeposit,
    data: depositTxHash,
    error: depositError,
    reset: resetDeposit,
  } = useWriteContract();

  const { isSuccess: depositConfirmed, isLoading: depositPending } =
    useWaitForTransactionReceipt({ hash: depositTxHash });

  // After approval confirmed, proceed to deposit
  useEffect(() => {
    if (approveConfirmed && step === "approving") {
      refetchAllowance();
      doDeposit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approveConfirmed]);

  // After deposit confirmed
  useEffect(() => {
    if (depositConfirmed && step === "depositing") {
      setStep("success");
    }
  }, [depositConfirmed, step]);

  // Handle errors
  useEffect(() => {
    if (approveError) {
      setStep("error");
      setErrorMsg(approveError.message.slice(0, 200));
    }
  }, [approveError]);

  useEffect(() => {
    if (depositError) {
      setStep("error");
      setErrorMsg(depositError.message.slice(0, 200));
    }
  }, [depositError]);

  function doDeposit() {
    setStep("depositing");
    writeDeposit({
      address: vaultAddress,
      abi: VAULT_ABI,
      functionName: "deposit",
      args: [hashedUserId as `0x${string}`, parsedAmount],
      chainId: selectedChainId,
    });
  }

  function handleSubmit() {
    setErrorMsg("");
    resetApprove();
    resetDeposit();

    if (!hashedUserId || !hashedUserId.startsWith("0x") || hashedUserId.length !== 66) {
      setErrorMsg("hashedUserId must be a 32-byte hex string (0x...)");
      setStep("error");
      return;
    }
    if (parsedAmount <= BigInt(0)) {
      setErrorMsg("Amount must be > 0");
      setStep("error");
      return;
    }

    // Switch chain if needed
    if (currentChainId !== selectedChainId) {
      switchChain({ chainId: selectedChainId });
      return;
    }

    if (needsApproval) {
      setStep("approving");
      writeApprove({
        address: usdcAddress,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [vaultAddress, parsedAmount],
        chainId: selectedChainId,
      });
    } else {
      doDeposit();
    }
  }

  function handleReset() {
    setStep("idle");
    setErrorMsg("");
    setAmount("");
    resetApprove();
    resetDeposit();
  }

  if (!isConnected) {
    return <p className="text-gray-500">Connect your wallet to deposit.</p>;
  }

  return (
    <div className="space-y-5">
      {/* Chain selector */}
      <div>
        <label className="block text-sm text-gray-400 mb-1">Chain</label>
        <select
          value={selectedChainId}
          onChange={(e) => setSelectedChainId(Number(e.target.value))}
          disabled={step !== "idle" && step !== "error"}
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
        >
          {SUPPORTED_CHAINS.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {/* Amount */}
      <div>
        <label className="block text-sm text-gray-400 mb-1">Amount (USDC)</label>
        <input
          type="number"
          step="0.000001"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={step !== "idle" && step !== "error"}
          placeholder="10.00"
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
        />
      </div>

      {/* hashedUserId */}
      <div>
        <label className="block text-sm text-gray-400 mb-1">Hashed User ID (bytes32)</label>
        <input
          type="text"
          value={hashedUserId}
          onChange={(e) => setHashedUserId(e.target.value)}
          disabled={step !== "idle" && step !== "error"}
          placeholder="0x..."
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono text-sm focus:outline-none focus:border-indigo-500"
        />
        <p className="text-xs text-gray-600 mt-1">
          In production this comes from World ID session. For hackathon, paste your hashed ID.
        </p>
      </div>

      {/* Status */}
      {step === "approving" && (
        <div className="text-yellow-400 text-sm">Approving USDC spend... confirm in wallet</div>
      )}
      {step === "depositing" && (
        <div className="text-yellow-400 text-sm">
          {depositPending ? "Waiting for confirmation..." : "Depositing... confirm in wallet"}
        </div>
      )}
      {step === "success" && (
        <div className="text-green-400 text-sm">
          Deposit successful!{" "}
          {depositTxHash && (
            <span className="font-mono text-xs break-all">tx: {depositTxHash}</span>
          )}
        </div>
      )}
      {step === "error" && (
        <div className="text-red-400 text-sm">Error: {errorMsg}</div>
      )}

      {/* Button */}
      {step === "success" ? (
        <button
          onClick={handleReset}
          className="w-full bg-gray-700 hover:bg-gray-600 text-white py-2.5 rounded-lg font-medium transition-colors"
        >
          New Deposit
        </button>
      ) : (
        <button
          onClick={handleSubmit}
          disabled={step === "approving" || step === "depositing"}
          className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:cursor-not-allowed text-white py-2.5 rounded-lg font-medium transition-colors"
        >
          {step === "approving"
            ? "Approving..."
            : step === "depositing"
            ? "Depositing..."
            : currentChainId !== selectedChainId
            ? "Switch Chain & Deposit"
            : needsApproval
            ? "Approve & Deposit"
            : "Deposit"}
        </button>
      )}
    </div>
  );
}
