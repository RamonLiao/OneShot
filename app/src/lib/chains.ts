export interface ChainConfig {
  chainId: string;
  name: string;
  rpcUrl: string;
  vaultAddress: string;
  betIngressAddress?: string;
  marketRegistryAddress?: string;
  isControlChain: boolean;
}

export const SUPPORTED_CHAINS: Record<string, ChainConfig> = {
  "base-sepolia": {
    chainId: "base-sepolia",
    name: "Base Sepolia",
    rpcUrl: process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org",
    vaultAddress: process.env.VAULT_BASE_ADDRESS || "",
    betIngressAddress: process.env.BET_INGRESS_ADDRESS || "",
    marketRegistryAddress: process.env.MARKET_REGISTRY_ADDRESS || "",
    isControlChain: true,
  },
  "arbitrum-sepolia": {
    chainId: "arbitrum-sepolia",
    name: "Arbitrum Sepolia",
    rpcUrl: process.env.ARBITRUM_SEPOLIA_RPC || "",
    vaultAddress: process.env.VAULT_ARBITRUM_ADDRESS || "",
    isControlChain: false,
  },
  "optimism-sepolia": {
    chainId: "optimism-sepolia",
    name: "Optimism Sepolia",
    rpcUrl: process.env.OPTIMISM_SEPOLIA_RPC || "",
    vaultAddress: process.env.VAULT_OPTIMISM_ADDRESS || "",
    isControlChain: false,
  },
};

export function getControlChain(): ChainConfig {
  const chain = Object.values(SUPPORTED_CHAINS).find((c) => c.isControlChain);
  if (!chain) throw new Error("No control chain configured");
  return chain;
}

export function getChainConfig(chainId: string): ChainConfig {
  const chain = SUPPORTED_CHAINS[chainId];
  if (!chain) throw new Error(`Unsupported chain: ${chainId}`);
  return chain;
}
