import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { baseSepolia, arbitrumSepolia, optimismSepolia } from "viem/chains";
import { http } from "wagmi";

export const SUPPORTED_CHAINS = [baseSepolia, arbitrumSepolia, optimismSepolia] as const;

export const wagmiConfig = getDefaultConfig({
  appName: "PrivaPoll",
  projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID || "PLACEHOLDER_PROJECT_ID",
  chains: [baseSepolia, arbitrumSepolia, optimismSepolia],
  transports: {
    [baseSepolia.id]: http(),
    [arbitrumSepolia.id]: http(),
    [optimismSepolia.id]: http(),
  },
  ssr: true,
});

// Vault addresses per chain
export const VAULT_ADDRESSES: Record<number, `0x${string}`> = {
  [baseSepolia.id]: (process.env.NEXT_PUBLIC_VAULT_BASE || "0x") as `0x${string}`,
  [arbitrumSepolia.id]: (process.env.NEXT_PUBLIC_VAULT_ARBITRUM || "0x") as `0x${string}`,
  [optimismSepolia.id]: (process.env.NEXT_PUBLIC_VAULT_OPTIMISM || "0x") as `0x${string}`,
};

// USDC addresses per chain (may differ per testnet)
export const USDC_ADDRESSES: Record<number, `0x${string}`> = {
  [baseSepolia.id]: (process.env.NEXT_PUBLIC_USDC_BASE || process.env.NEXT_PUBLIC_USDC_ADDRESS || "0x") as `0x${string}`,
  [arbitrumSepolia.id]: (process.env.NEXT_PUBLIC_USDC_ARBITRUM || process.env.NEXT_PUBLIC_USDC_ADDRESS || "0x") as `0x${string}`,
  [optimismSepolia.id]: (process.env.NEXT_PUBLIC_USDC_OPTIMISM || process.env.NEXT_PUBLIC_USDC_ADDRESS || "0x") as `0x${string}`,
};

export const VAULT_ABI = [
  { name: "deposit", type: "function", stateMutability: "nonpayable", inputs: [{ name: "hashedUserId", type: "bytes32" }, { name: "amount", type: "uint256" }], outputs: [] },
  { name: "claim", type: "function", stateMutability: "nonpayable", inputs: [{ name: "hashedUserId", type: "bytes32" }, { name: "marketId", type: "uint256" }, { name: "amount", type: "uint256" }, { name: "deadline", type: "uint256" }, { name: "backendSig", type: "bytes" }], outputs: [] },
  { name: "available", type: "function", stateMutability: "view", inputs: [{ name: "hashedUserId", type: "bytes32" }], outputs: [{ type: "uint256" }] },
  { name: "claimable", type: "function", stateMutability: "view", inputs: [{ name: "hashedUserId", type: "bytes32" }, { name: "marketId", type: "uint256" }], outputs: [{ type: "uint256" }] },
] as const;

export const ERC20_ABI = [
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { name: "allowance", type: "function", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;
