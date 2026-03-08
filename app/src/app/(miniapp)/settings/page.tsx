"use client";

import { useState, useEffect } from "react";
import {
  getWallets,
  addWallet,
  removeWallet,
  loadSession,
  clearSession,
} from "@/lib/session";

export default function SettingsPage() {
  const [wallets, setWallets] = useState<string[]>([]);
  const [newAddr, setNewAddr] = useState("");
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
    addWallet(addr);
    setWallets(getWallets());
    setNewAddr("");
    setAddrError("");
  }

  function handleRemove(addr: string) {
    removeWallet(addr);
    setWallets(getWallets());
  }

  function handleLogout() {
    clearSession();
    setLoggedIn(false);
  }

  return (
    <div className="flex flex-col gap-6">
      <a href="/" className="text-xs text-zinc-500 hover:text-zinc-300">
        &larr; Back to markets
      </a>

      <h2 className="text-base font-semibold text-zinc-100">Settings</h2>

      {/* Session status */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <h3 className="mb-2 text-sm font-medium text-zinc-300">Session</h3>
        {loggedIn ? (
          <div className="flex items-center justify-between">
            <span className="text-xs text-emerald-400">Verified with World ID</span>
            <button
              onClick={handleLogout}
              className="rounded-lg border border-red-800 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-950/50 transition-colors"
            >
              Log out
            </button>
          </div>
        ) : (
          <span className="text-xs text-zinc-500">Not verified</span>
        )}
      </div>

      {/* Wallets */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <h3 className="mb-3 text-sm font-medium text-zinc-300">Saved Wallets</h3>

        {wallets.length === 0 ? (
          <p className="text-xs text-zinc-500 mb-3">No wallets saved yet.</p>
        ) : (
          <ul className="mb-3 flex flex-col gap-2">
            {wallets.map((w) => (
              <li
                key={w}
                className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2"
              >
                <span className="text-xs font-mono text-zinc-300 truncate mr-2">
                  {w}
                </span>
                <button
                  onClick={() => handleRemove(w)}
                  className="shrink-0 text-xs text-red-400 hover:text-red-300"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex gap-2">
          <input
            type="text"
            value={newAddr}
            onChange={(e) => {
              setNewAddr(e.target.value);
              setAddrError("");
            }}
            placeholder="0x..."
            className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs font-mono text-zinc-100 placeholder:text-zinc-600 focus:border-violet-500 focus:outline-none"
          />
          <button
            onClick={handleAdd}
            className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white hover:bg-violet-500 transition-colors"
          >
            Add
          </button>
        </div>
        {addrError && (
          <p className="mt-1 text-xs text-red-400">{addrError}</p>
        )}
      </div>
    </div>
  );
}
