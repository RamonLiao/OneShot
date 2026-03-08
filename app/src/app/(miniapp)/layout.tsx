"use client";

import { useEffect, useState } from "react";
import { MiniKit } from "@worldcoin/minikit-js";

export default function MiniAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    MiniKit.install(process.env.NEXT_PUBLIC_WORLD_APP_ID);
    setReady(true);
  }, []);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-400">
        Loading...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans">
      <header className="sticky top-0 z-50 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-sm px-4 py-3">
        <h1 className="text-lg font-bold tracking-tight">PrivaPoll</h1>
      </header>
      <main className="mx-auto max-w-lg px-4 py-4">{children}</main>
      {!MiniKit.isInstalled() && (
        <div className="fixed bottom-0 inset-x-0 bg-amber-900/90 text-amber-200 text-xs text-center py-2 px-4">
          Not running inside World App. Some features may not work.
        </div>
      )}
    </div>
  );
}
