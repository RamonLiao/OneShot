const SESSION_KEY = "oneshot-session";
const WALLETS_KEY = "oneshot-wallets-v2";

export interface Session {
  token: string;
  hashedUserId: string;
  crePublicKey: string;
}

export interface Wallet {
  name: string;
  address: string;
  chain: string;
}

export const SUPPORTED_CHAINS = [
  { id: "world-chain", label: "World Chain" },
  { id: "base-sepolia", label: "Base Sepolia" },
  { id: "arbitrum-sepolia", label: "Arbitrum Sepolia" },
  { id: "optimism-sepolia", label: "Optimism Sepolia" },
] as const;

export function saveSession(s: Session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(s));
}
export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

export function getWallets(): Wallet[] {
  try {
    const raw = localStorage.getItem(WALLETS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
export function addWallet(w: Wallet) {
  const list = getWallets();
  if (!list.some((x) => x.address === w.address && x.chain === w.chain)) {
    list.push(w);
    localStorage.setItem(WALLETS_KEY, JSON.stringify(list));
  }
}
export function removeWallet(address: string, chain: string) {
  const list = getWallets().filter(
    (w) => !(w.address === address && w.chain === chain),
  );
  localStorage.setItem(WALLETS_KEY, JSON.stringify(list));
}
