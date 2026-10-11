"use client";

import type { Address } from "viem";

import { useWalletSession, type SafePayWalletClient } from "./session";

export type SafePayWallet = {
  address: Address | undefined;
  walletClient: SafePayWalletClient | undefined;
  publicClient: ReturnType<typeof useWalletSession>["publicClient"];
  provider: "privy" | "dynamic" | null;
  role: "client" | "freelancer" | null;
  authenticated: boolean;
  ready: boolean;
  chainId: number | undefined;
  chainName: string;
  error: string | undefined;
  otpSent: boolean;
  login: (() => Promise<void>) | undefined;
  getAuthToken: (() => Promise<string | null>) | undefined;
  sendLoginCode: ((email: string) => Promise<void>) | undefined;
  verifyLoginCode: ((code: string) => Promise<void>) | undefined;
  selectRole: ReturnType<typeof useWalletSession>["selectRole"];
  clearRole: ReturnType<typeof useWalletSession>["clearRole"];
  setOtpSent: ReturnType<typeof useWalletSession>["setOtpSent"];
  logout: () => Promise<void>;
};

export function useSafePayWallet(): SafePayWallet {
  const session = useWalletSession();
  return {
    address: session.address,
    walletClient: session.walletClient,
    publicClient: session.publicClient,
    provider: session.provider,
    role: session.role,
    authenticated: session.authenticated,
    ready: session.ready,
    chainId: session.chainId,
    chainName: session.chainName ?? (session.authenticated ? "Network status unavailable" : "Monad Testnet"),
    error: session.error,
    otpSent: session.otpSent,
    login: session.login,
    getAuthToken: session.getAuthToken,
    sendLoginCode: session.sendLoginCode,
    verifyLoginCode: session.verifyLoginCode,
    selectRole: session.selectRole,
    clearRole: session.clearRole,
    setOtpSent: session.setOtpSent,
    logout: session.logout,
  };
}
