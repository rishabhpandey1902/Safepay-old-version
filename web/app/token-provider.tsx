"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { createPublicClient, http } from "viem";
import type { ReactNode } from "react";

import { monadTestnet } from "@/lib/monad";
import { readTokenMetadata, type TokenMetadata } from "@/lib/token";

type TokenStatus =
  | { status: "loading"; metadata: null; error: null }
  | { status: "ready"; metadata: TokenMetadata; error: null }
  | { status: "error"; metadata: null; error: string };

const TokenContext = createContext<TokenStatus>({
  status: "loading",
  metadata: null,
  error: null,
});

export function useTokenConfig(): TokenStatus {
  return useContext(TokenContext);
}

export function TokenProvider({ children }: { children: ReactNode }) {
  const [tokenState, setTokenState] = useState<TokenStatus>({
    status: "loading",
    metadata: null,
    error: null,
  });
  const publicClient = useMemo(
    () =>
      createPublicClient({
        chain: monadTestnet,
        transport: http(
          process.env.NEXT_PUBLIC_MONAD_RPC_URL ??
            monadTestnet.rpcUrls.default.http[0],
        ),
      }),
    [],
  );

  useEffect(() => {
    let active = true;
    void readTokenMetadata(publicClient)
      .then((metadata) => {
        if (active) setTokenState({ status: "ready", metadata, error: null });
      })
      .catch((error: unknown) => {
        if (active) {
          setTokenState({
            status: "error",
            metadata: null,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => {
      active = false;
    };
  }, [publicClient]);

  return (
    <TokenContext.Provider value={tokenState}>
      {children}
      <details className="fixed bottom-3 right-3 z-50 max-w-[min(24rem,calc(100vw-1.5rem))] rounded-xl border border-slate-700 bg-slate-950/95 p-3 text-xs text-slate-200 shadow-xl">
        <summary className="cursor-pointer font-semibold">Admin / token diagnostics</summary>
        <div className="mt-3 space-y-1 break-all">
          <p>Network: Monad testnet ({monadTestnet.id})</p>
          <p>Token: {tokenState.metadata?.address ?? process.env.NEXT_PUBLIC_SAFE_PAY_TOKEN_ADDRESS ?? "not configured"}</p>
          <p>Symbol: {tokenState.metadata?.symbol ?? "unavailable"}</p>
          <p>Decimals: {tokenState.metadata?.decimals ?? "unavailable"}</p>
          <p>Status: {tokenState.status}</p>
          {tokenState.error ? (
            <p className="text-red-300">Token check failed: {tokenState.error}</p>
          ) : null}
        </div>
      </details>
    </TokenContext.Provider>
  );
}
