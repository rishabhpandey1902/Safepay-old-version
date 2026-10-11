"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Account, Address, Chain, PublicClient, Transport, WalletClient } from "viem";

export type SafePayWalletClient = WalletClient<Transport, Chain, Account>;

export type SafePayRole = "client" | "freelancer";
export type SafePayProvider = "privy" | "dynamic";

type WalletState = {
  address?: Address;
  walletClient?: SafePayWalletClient;
  chainName?: string;
  chainId?: number;
  authenticated: boolean;
  sdkReady: boolean;
  error?: string;
  login?: () => Promise<void>;
  getAuthToken?: () => Promise<string | null>;
  sendLoginCode?: (email: string) => Promise<void>;
  verifyLoginCode?: (code: string) => Promise<void>;
  logoutSdk?: () => Promise<void>;
};

type SessionContextValue = WalletState & {
  role: SafePayRole | null;
  provider: SafePayProvider | null;
  ready: boolean;
  publicClient: PublicClient;
  otpSent: boolean;
  selectRole: (role: SafePayRole) => void;
  clearRole: () => void;
  setOtpSent: (sent: boolean) => void;
  setWalletState: (state: WalletState | ((current: WalletState) => WalletState)) => void;
  logout: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function WalletSessionProvider({
  children,
  publicClient,
}: {
  children: ReactNode;
  publicClient: PublicClient;
}) {
  const [role, setRole] = useState<SafePayRole | null>(null);
  const roleRef = useRef<SafePayRole | null>(null);
  const [roleLoaded, setRoleLoaded] = useState(false);
  const [walletState, setWalletStateValue] = useState<WalletState>({
    authenticated: false,
    sdkReady: false,
  });
  const [otpSent, setOtpSent] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const storedRole = window.sessionStorage.getItem("safepay-role");
      if (storedRole === "client" || storedRole === "freelancer") {
        roleRef.current = storedRole;
        // Restore after hydration so session-specific SDK providers do not cause an SSR mismatch.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setRole(storedRole);
      }
      setRoleLoaded(true);
    }
  }, []);

  const selectRole = useCallback((nextRole: SafePayRole) => {
    if (roleRef.current && roleRef.current !== nextRole) {
      throw new Error("Log out before changing wallet roles.");
    }
    window.sessionStorage.setItem("safepay-role", nextRole);
    roleRef.current = nextRole;
    setRole(nextRole);
    setWalletStateValue({ authenticated: false, sdkReady: false });
  }, []);

  const clearRole = useCallback(() => {
    window.sessionStorage.removeItem("safepay-role");
    roleRef.current = null;
    setRole(null);
    setOtpSent(false);
    setWalletStateValue({ authenticated: false, sdkReady: true });
  }, []);

  const setWalletState = useCallback((state: WalletState | ((current: WalletState) => WalletState)) => {
    setWalletStateValue(state);
  }, []);

  const logoutSdk = walletState.logoutSdk;
  const logout = useCallback(async () => {
    await logoutSdk?.();
    clearRole();
  }, [clearRole, logoutSdk]);

  const provider: SafePayProvider | null =
    role === "client" ? "privy" : role === "freelancer" ? "dynamic" : null;

  const value = useMemo<SessionContextValue>(() => ({
    ...walletState,
    role,
    provider,
    ready: roleLoaded && (!provider || walletState.sdkReady),
    publicClient,
    otpSent,
    selectRole,
    clearRole,
    setOtpSent,
    setWalletState,
    logout,
  }), [walletState, role, provider, roleLoaded, publicClient, otpSent, selectRole, clearRole, setOtpSent, setWalletState, logout]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useWalletSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error("WalletSessionProvider is missing.");
  return context;
}
