"use client";

import { useState, useEffect } from "react";
import {
  getWallets,
  addWallet,
  removeWallet,
  loadSession,
  clearSession,
  SUPPORTED_CHAINS,
  type Wallet,
} from "@/lib/session";

export default function SettingsPage() {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [newName, setNewName] = useState("");
  const [newAddr, setNewAddr] = useState("");
  const [newChain, setNewChain] = useState<string>(SUPPORTED_CHAINS[0].id);
  const [addrError, setAddrError] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    setWallets(getWallets());
    setLoggedIn(!!loadSession());
  }, []);

  function handleAdd() {
    const addr = newAddr.trim();
    if (!addr.startsWith("0x") || addr.length !== 42) {
      setAddrError("Invalid address (must start with 0x, 42 chars)");
      return;
    }
    const name = newName.trim() || `Wallet ${wallets.length + 1}`;
    addWallet({ name, address: addr, chain: newChain });
    setWallets(getWallets());
    setNewAddr("");
    setNewName("");
    setAddrError("");
  }

  function handleRemove(w: Wallet) {
    removeWallet(w.address, w.chain);
    setWallets(getWallets());
  }

  function handleLogout() {
    clearSession();
    setLoggedIn(false);
  }

  const chainLabel = (id: string) =>
    SUPPORTED_CHAINS.find((c) => c.id === id)?.label ?? id;

  return (
    <div className="flex flex-col gap-6">
      <a href="/" className="text-xs text-text-secondary hover:text-text-primary">
        &larr; Back to markets
      </a>

      <h2 className="text-base font-semibold text-text-primary">Settings</h2>

      {/* Session status */}
      <div className="rounded-xl border border-border-dim bg-surface-2 p-4">
        <h3 className="mb-2 text-sm font-medium text-text-primary">Session</h3>
        {loggedIn ? (
          <div className="flex items-center justify-between">
            <span className="text-xs text-brand-green">
              Verified with World ID
            </span>
            <button
              onClick={handleLogout}
              className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/50 transition-colors"
            >
              Log out
            </button>
          </div>
        ) : (
          <span className="text-xs text-text-secondary">Not verified</span>
        )}
      </div>

      {/* Wallets */}
      <div className="rounded-xl border border-border-dim bg-surface-2 p-4">
        <h3 className="mb-3 text-sm font-medium text-text-primary">
          Saved Wallets
        </h3>

        {wallets.length === 0 ? (
          <p className="text-xs text-text-secondary mb-3">No wallets saved yet.</p>
        ) : (
          <ul className="mb-3 flex flex-col gap-2">
            {wallets.map((w, i) => (
              <li
                key={`${w.chain}-${w.address}-${i}`}
                className="rounded-lg border border-border-dim bg-surface-0 px-3 py-2.5"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-text-primary">
                    {w.name}
                  </span>
                  <button
                    onClick={() => handleRemove(w)}
                    className="shrink-0 text-xs text-red-400 hover:text-red-300"
                  >
                    Remove
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[10px] text-text-secondary">
                    {chainLabel(w.chain)}
                  </span>
                  <span className="text-[11px] font-mono text-text-secondary truncate">
                    {w.address}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Add wallet form */}
        <div className="flex flex-col gap-2 border-t border-border-dim pt-3">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Wallet name (optional)"
            className="w-full rounded-lg border border-border-default bg-surface-0 px-3 py-2 text-xs text-text-primary placeholder:text-text-dim focus:border-brand-teal focus:outline-none"
          />
          <input
            type="text"
            value={newAddr}
            onChange={(e) => {
              setNewAddr(e.target.value);
              setAddrError("");
            }}
            placeholder="0x..."
            className="w-full rounded-lg border border-border-default bg-surface-0 px-3 py-2 text-xs font-mono text-text-primary placeholder:text-text-dim focus:border-brand-teal focus:outline-none"
          />
          <select
            value={newChain}
            onChange={(e) => setNewChain(e.target.value)}
            className="w-full rounded-lg border border-border-default bg-surface-0 px-3 py-2 text-xs text-text-primary focus:border-brand-teal focus:outline-none"
          >
            {SUPPORTED_CHAINS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <button
            onClick={handleAdd}
            className="w-full rounded-lg bg-brand-teal px-4 py-2 text-xs font-semibold text-surface-0 hover:bg-brand-teal/90 transition-colors"
          >
            Add Wallet
          </button>
          {addrError && (
            <p className="text-xs text-red-400">{addrError}</p>
          )}
        </div>
      </div>
    </div>
  );
}
