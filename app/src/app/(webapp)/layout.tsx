"use client";

import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, darkTheme, ConnectButton } from "@rainbow-me/rainbowkit";
import { wagmiConfig } from "@/lib/wagmi-config";
import "@rainbow-me/rainbowkit/styles.css";
import Link from "next/link";
import { useState } from "react";

export default function WebAppLayout({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={darkTheme({ accentColor: "#6366f1" })}>
          <div className="min-h-screen bg-[#0a0a0a] text-[#ededed]">
            <header className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
              <div className="flex items-center gap-6">
                <Link href="/" className="text-xl font-bold tracking-tight">
                  PrivaPoll
                </Link>
                <nav className="flex gap-4 text-sm text-gray-400">
                  <Link href="/deposit" className="hover:text-white transition-colors">
                    Deposit
                  </Link>
                  <Link href="/claim" className="hover:text-white transition-colors">
                    Claim
                  </Link>
                </nav>
              </div>
              <ConnectButton showBalance={false} />
            </header>
            <main className="max-w-2xl mx-auto px-6 py-10">{children}</main>
          </div>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
