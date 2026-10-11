"use client";

import { DynamicProvider } from "@dynamic-labs-sdk/react-hooks";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PrivyProvider, usePrivy, useWallets } from "@privy-io/react-auth";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createPublicClient, createWalletClient, custom, http, type Address } from "viem";

import { monadTestnet } from "@/lib/monad";
import { dynamicClient } from "@/lib/wallet/dynamic-client";
import { WalletSessionProvider, useWalletSession } from "@/lib/wallet/session";
import { createWalletClientForWalletAccount } from "@dynamic-labs-sdk/evm/viem";
import {
  getNetworksData,
  switchActiveNetwork,
  type WalletAccount,
} from "@dynamic-labs-sdk/client";
import {
  useGetWalletAccounts,
  useGetActiveNetworkData,
  useInitStatus,
  useLogout,
  useOnEvent,
  useSendEmailOTP,
  useUser,
  useVerifyOTP,
} from "@dynamic-labs-sdk/react-hooks";
import { createWaasWalletAccounts, getChainsMissingWaasWalletAccounts } from "@dynamic-labs-sdk/client/waas";
import { TokenProvider } from "./token-provider";
import type { SafePayWalletClient } from "@/lib/wallet/session";

const rpcUrl = process.env.NEXT_PUBLIC_MONAD_RPC_URL ?? monadTestnet.rpcUrls.default.http[0];
const publicClient = createPublicClient({ chain: monadTestnet, transport: http(rpcUrl) });
const privyAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <TokenProvider>
      <WalletSessionProvider publicClient={publicClient}>
        <WalletRuntime queryClient={queryClient}>{children}</WalletRuntime>
      </WalletSessionProvider>
    </TokenProvider>
  );
}

function WalletRuntime({ children, queryClient }: { children: ReactNode; queryClient: QueryClient }) {
  const { role } = useWalletSession();

  if (role === "client" && privyAppId) {
    return (
      <PrivyProvider
        appId={privyAppId}
        config={{
          loginMethods: ["email"],
          embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
          defaultChain: monadTestnet,
          supportedChains: [monadTestnet],
          appearance: { theme: "dark", accentColor: "#7c3aed", landingHeader: "SafePay" },
        }}
      >
        <PrivyWalletBridge>{children}</PrivyWalletBridge>
      </PrivyProvider>
    );
  }

  if (role === "freelancer" && dynamicClient) {
    return (
      <QueryClientProvider client={queryClient}>
        <DynamicProvider client={dynamicClient}>
          <DynamicWalletBridge>{children}</DynamicWalletBridge>
        </DynamicProvider>
      </QueryClientProvider>
    );
  }

  return children;
}

function PrivyWalletBridge({ children }: { children: ReactNode }) {
  const { ready, authenticated, login, logout, getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  const { setWalletState, clearRole } = useWalletSession();
  const wallet = wallets.find(
    (candidate) => candidate.walletClientType === "privy" || candidate.walletClientType === "privy-v2",
  );

  const loginUser = useCallback(async () => login({ loginMethods: ["email"] }), [login]);
  const getAuthToken = useCallback(() => getAccessToken(), [getAccessToken]);
  const logoutUser = useCallback(async () => {
    await logout();
    clearRole();
  }, [logout, clearRole]);

  useEffect(() => {
    let active = true;
    let subscribedProvider: Awaited<ReturnType<NonNullable<typeof wallet>["getEthereumProvider"]>> | undefined;
    let onChainChanged: ((chain: string | number) => void) | undefined;
    const loadWallet = async () => {
      if (!ready || !authenticated) {
        setWalletState({ authenticated, sdkReady: ready, login: loginUser, getAuthToken, logoutSdk: logoutUser });
        return;
      }
      if (!wallet) {
        setWalletState({
          authenticated,
          sdkReady: ready,
          login: loginUser,
          getAuthToken,
          logoutSdk: logoutUser,
          error: wallets.length > 0
            ? "Client transactions require a Privy embedded wallet. External wallets are not used for client escrow actions."
            : "Privy has not provided an embedded wallet for this account.",
        });
        return;
      }
      try {
        let provider = await wallet.getEthereumProvider();
        subscribedProvider = provider;
        const chainHex = await provider.request({ method: "eth_chainId" }) as string;
        if (Number.parseInt(chainHex, 16) !== monadTestnet.id) {
          await wallet.switchChain(monadTestnet.id);
          provider = await wallet.getEthereumProvider();
          subscribedProvider = provider;
        }
        const updatedChainHex = await provider.request({ method: "eth_chainId" }) as string;
        if (!active) return;
        onChainChanged = (chain: string | number) => {
          const nextChainId = typeof chain === "number"
            ? chain
            : chain.startsWith("0x")
              ? Number.parseInt(chain, 16)
              : Number(chain);
          setWalletState((current) => ({
            ...current,
            walletClient: undefined,
            chainId: nextChainId,
            chainName: nextChainId === monadTestnet.id ? monadTestnet.name : "Switching to Monad Testnet",
            error: nextChainId === monadTestnet.id ? undefined : "Wallet network changed; switching back to Monad Testnet.",
          }));
          void (async () => {
            try {
              if (nextChainId !== monadTestnet.id) await wallet.switchChain(monadTestnet.id);
              const currentProvider = await wallet.getEthereumProvider();
              const currentChain = await currentProvider.request({ method: "eth_chainId" }) as string;
              const confirmedChainId = Number.parseInt(currentChain, 16);
              if (confirmedChainId !== monadTestnet.id) {
                throw new Error(`Privy selected chain ${confirmedChainId}; SafePay requires Monad Testnet (${monadTestnet.id}).`);
              }
              if (!active) return;
              setWalletState({
                address: wallet.address as Address,
                walletClient: createWalletClient({
                  account: wallet.address as Address,
                  chain: monadTestnet,
                  transport: custom(currentProvider),
                }) as SafePayWalletClient,
                chainId: confirmedChainId,
                chainName: monadTestnet.name,
                authenticated: true,
                sdkReady: ready,
                login: loginUser,
                getAuthToken,
                logoutSdk: logoutUser,
              });
            } catch (error) {
              if (active) {
                setWalletState((current) => ({
                  ...current,
                  walletClient: undefined,
                  error: error instanceof Error ? error.message : "Could not switch the wallet back to Monad Testnet.",
                }));
              }
            }
          })();
        };
        provider.on("chainChanged", onChainChanged);
        setWalletState({
          address: wallet.address as Address,
          walletClient: createWalletClient({
            account: wallet.address as Address,
            chain: monadTestnet,
            transport: custom(provider),
          }) as SafePayWalletClient,
          chainId: Number.parseInt(updatedChainHex, 16),
          chainName: monadTestnet.name,
          authenticated,
          sdkReady: ready,
          login: loginUser,
          getAuthToken,
          logoutSdk: logoutUser,
        });
      } catch (error) {
        if (active) {
          setWalletState({
            address: wallet.address as Address,
            authenticated,
            sdkReady: ready,
            getAuthToken,
            error: error instanceof Error ? error.message : "Could not switch to Monad Testnet.",
            login: loginUser,
            logoutSdk: logoutUser,
          });
        }
      }
    };
    void loadWallet();
    return () => {
      active = false;
      if (subscribedProvider && onChainChanged) {
        subscribedProvider.removeListener("chainChanged", onChainChanged);
      }
    };
  }, [ready, authenticated, wallet, wallets.length, setWalletState, loginUser, getAuthToken, logoutUser]);

  return <><WalletStatus />{children}</>;
}

function DynamicWaasBootstrap() {
  useOnEvent({
    event: "userChanged",
    listener: async ({ user }) => {
      if (!user) return;
      const missingChains = getChainsMissingWaasWalletAccounts();
      if (missingChains.length > 0) await createWaasWalletAccounts({ chains: missingChains });
    },
  });
  return null;
}

function DynamicWalletBridge({ children }: { children: ReactNode }) {
  const { data: initStatus } = useInitStatus();
  const { data: user } = useUser();
  const { data: accounts = [] } = useGetWalletAccounts();
  const { mutateAsync: sendEmailOTP } = useSendEmailOTP();
  const { mutateAsync: verifyOTP } = useVerifyOTP();
  const { mutateAsync: logout } = useLogout();
  const { setWalletState, clearRole, setOtpSent } = useWalletSession();
  const [otpVerification, setOtpVerification] = useState<Awaited<ReturnType<typeof sendEmailOTP>> | null>(null);
  const account = accounts.find((candidate) => candidate.chain === "EVM");
  const sendCode = useCallback(async (email: string) => {
    setOtpVerification(await sendEmailOTP({ email }));
    setOtpSent(true);
  }, [sendEmailOTP, setOtpSent]);
  const verifyCode = useCallback(async (code: string) => {
    if (!otpVerification) throw new Error("Request an email code first.");
    await verifyOTP({ otpVerification, verificationToken: code });
  }, [otpVerification, verifyOTP]);
  const logoutUser = useCallback(async () => {
    await logout();
    clearRole();
    setOtpSent(false);
  }, [logout, clearRole, setOtpSent]);

  useEffect(() => {
    if (user && account) return;
    setWalletState({
      authenticated: Boolean(user),
      sdkReady: initStatus === "finished",
      sendLoginCode: sendCode,
      verifyLoginCode: verifyCode,
      logoutSdk: logoutUser,
      error: user && !account ? "Dynamic sign-in is active, waiting for its EVM wallet." : undefined,
    });
  }, [user, account, initStatus, setWalletState, sendCode, verifyCode, logoutUser]);

  return (
    <>
      <DynamicWaasBootstrap />
      {user && account ? (
        <DynamicConnectedWalletBridge
          account={account}
          initStatus={initStatus === "finished"}
          sendCode={sendCode}
          verifyCode={verifyCode}
          logoutUser={logoutUser}
        >
          {children}
        </DynamicConnectedWalletBridge>
      ) : <>{children}</>}
    </>
  );
}

function DynamicConnectedWalletBridge({
  account,
  initStatus,
  sendCode,
  verifyCode,
  logoutUser,
  children,
}: {
  account: WalletAccount;
  initStatus: boolean;
  sendCode: (email: string) => Promise<void>;
  verifyCode: (code: string) => Promise<void>;
  logoutUser: () => Promise<void>;
  children: ReactNode;
}) {
  const { data: activeNetwork, error: activeNetworkError } = useGetActiveNetworkData({ walletAccount: account });
  const { setWalletState } = useWalletSession();
  const networkId = getNetworksData().find(
    (entry) => entry.chain === "EVM" && entry.testnet && /monad/i.test(`${entry.name} ${entry.displayName}`),
  )?.networkId;

  useEffect(() => {
    let active = true;
    const connect = async () => {
      try {
        if (!networkId) {
          throw new Error("Enable Monad Testnet (chain ID 10143) in the Dynamic dashboard before using this wallet.");
        }
        if (activeNetworkError) throw activeNetworkError;
        const activeNetworkId = activeNetwork?.networkData?.networkId;
        if (!activeNetworkId) {
          setWalletState({
            address: account.address as Address,
            chainName: "Checking Dynamic network",
            authenticated: true,
            sdkReady: initStatus,
            sendLoginCode: sendCode,
            verifyLoginCode: verifyCode,
            logoutSdk: logoutUser,
          });
          return;
        }
        if (activeNetworkId !== networkId) {
          setWalletState((current) => ({
            ...current,
            walletClient: undefined,
            chainId: undefined,
            chainName: "Switching to Monad Testnet",
          }));
          await switchActiveNetwork({ networkId, walletAccount: account });
          return;
        }
        const walletClient = await createWalletClientForWalletAccount({ walletAccount: account });
        const chainId = await walletClient.getChainId();
        if (chainId !== monadTestnet.id) {
          throw new Error(`Dynamic selected chain ${chainId}; SafePay requires Monad Testnet (${monadTestnet.id}).`);
        }
        if (!active) return;
        setWalletState({
          address: account.address as Address,
          walletClient: walletClient as SafePayWalletClient,
          chainId,
          chainName: activeNetwork.networkData?.displayName,
          authenticated: true,
          sdkReady: initStatus,
          sendLoginCode: sendCode,
          verifyLoginCode: verifyCode,
          logoutSdk: logoutUser,
        });
      } catch (error) {
        if (active) {
          setWalletState({
            address: account.address as Address,
            authenticated: true,
            sdkReady: initStatus,
            sendLoginCode: sendCode,
            verifyLoginCode: verifyCode,
            logoutSdk: logoutUser,
            error: error instanceof Error ? error.message : "Could not connect the Dynamic wallet to Monad Testnet.",
          });
        }
      }
    };
    void connect();
    return () => { active = false; };
  }, [account, activeNetwork?.networkData?.networkId, activeNetwork?.networkData?.displayName, activeNetworkError, networkId, initStatus, sendCode, verifyCode, logoutUser, setWalletState]);

  return <><WalletStatus />{children}</>;
}

function WalletStatus() {
  const { address, provider, chainName, chainId, authenticated, error } = useWalletSession();
  if (!authenticated) return null;

  return (
    <aside className="sticky top-0 z-50 border-b border-slate-800 bg-slate-950/95 px-4 py-2 text-xs text-slate-300 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold text-violet-300">{provider === "privy" ? "Privy" : "Dynamic"}</span>
        <span className="break-all">{address ?? "Wallet connecting…"}</span>
        <span>{chainName ?? "Monad Testnet"}{chainId ? ` · chain ${chainId}` : ""}</span>
        {error ? <span role="alert" className="text-red-300">{error}</span> : null}
      </div>
    </aside>
  );
}
