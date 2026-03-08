const SESSION_KEY = "oneshot-session";
const WALLETS_KEY = "oneshot-wallets";

export interface Session {
  token: string;
  hashedUserId: string;
  crePublicKey: string;
}

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

export function getWallets(): string[] {
  try {
    const raw = localStorage.getItem(WALLETS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
export function addWallet(addr: string) {
  const list = getWallets();
  if (!list.includes(addr)) {
    list.push(addr);
    localStorage.setItem(WALLETS_KEY, JSON.stringify(list));
  }
}
export function removeWallet(addr: string) {
  const list = getWallets().filter((w) => w !== addr);
  localStorage.setItem(WALLETS_KEY, JSON.stringify(list));
}
