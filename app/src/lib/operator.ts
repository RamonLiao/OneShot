import { ethers } from "ethers";
import { getControlChain, getChainConfig } from "./chains";

const OPERATOR_PK = process.env.OPERATOR_PRIVATE_KEY || "";

const BET_INGRESS_ABI = [
  "function placeBet(uint256 marketId, bytes32 hashedUserId, bytes32 ciphertextHash, uint256 amount, uint8 sourceChainId) external",
];

const VAULT_ABI = [
  "function allocate(bytes32 hashedUserId, uint256 amount) external",
  "function recordPayout(bytes32 hashedUserId, uint256 marketId, uint256 amount, bytes creSignature) external",
];

function getOperatorWallet(rpcUrl: string): ethers.Wallet {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  return new ethers.Wallet(OPERATOR_PK, provider);
}

/**
 * Send BetIngress.placeBet tx on control chain.
 */
export async function sendPlaceBet(
  marketId: number,
  hashedUserId: string,
  ciphertextHash: string,
  amount: bigint,
  sourceChainId: number
): Promise<string> {
  const chain = getControlChain();
  const wallet = getOperatorWallet(chain.rpcUrl);
  const ingress = new ethers.Contract(chain.betIngressAddress!, BET_INGRESS_ABI, wallet);
  const tx = await ingress.placeBet(marketId, hashedUserId, ciphertextHash, amount, sourceChainId);
  const receipt = await tx.wait();
  return receipt.hash;
}

/**
 * Send Vault.allocate tx on source chain.
 */
export async function sendAllocate(
  chainId: string,
  hashedUserId: string,
  amount: bigint
): Promise<string> {
  const chain = getChainConfig(chainId);
  const wallet = getOperatorWallet(chain.rpcUrl);
  const vault = new ethers.Contract(chain.vaultAddress, VAULT_ABI, wallet);
  const tx = await vault.allocate(hashedUserId, amount);
  const receipt = await tx.wait();
  return receipt.hash;
}

/**
 * Generate EIP-191 signature for Vault.claim.
 * Signs: keccak256(hashedUserId, marketId, amount, deadline, chainId, vaultAddress)
 */
export async function signClaimMessage(
  hashedUserId: string,
  marketId: number,
  amount: bigint,
  deadline: number,
  chainId: string
): Promise<string> {
  const chain = getChainConfig(chainId);
  const wallet = getOperatorWallet(chain.rpcUrl);

  const evmChainId = await wallet.provider!.getNetwork().then((n) => n.chainId);
  const messageHash = ethers.solidityPackedKeccak256(
    ["bytes32", "uint256", "uint256", "uint256", "uint256", "address"],
    [hashedUserId, marketId, amount, deadline, evmChainId, chain.vaultAddress]
  );
  return wallet.signMessage(ethers.getBytes(messageHash));
}
