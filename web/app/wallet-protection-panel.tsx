"use client";

import { useAuthorizationSignature, useUser } from "@privy-io/react-auth";
import { useCallback, useEffect, useState } from "react";

import { useSafePayWallet } from "@/lib/wallet/useSafePayWallet";

type PolicyRule = {
  name: string;
  method: string;
  action: string;
  conditions: Array<{
    field_source?: string;
    field?: string;
    operator?: string;
    value?: string | string[];
  }>;
};

type ProtectionData = {
  configured: boolean;
  assigned: boolean;
  expectedPolicyId?: string;
  message?: string;
  policy?: {
    id: string;
    name: string;
    chainType: string;
    rules: PolicyRule[];
  };
};

export function WalletProtectionPanel() {
  const { address, authenticated, getAuthToken, provider } = useSafePayWallet();
  const { user } = useUser();
  const { generateAuthorizationSignature } = useAuthorizationSignature();
  const [protection, setProtection] = useState<ProtectionData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fetchProtection = useCallback(async (): Promise<ProtectionData> => {
    if (!address || !getAuthToken) throw new Error("Connect a Privy embedded wallet to check its policy.");
    const token = await getAuthToken();
    if (!token) {
      throw new Error("Privy did not provide an access token for the policy status request.");
    }
    const response = await fetch(`/api/wallet-protection?address=${encodeURIComponent(address)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const result: unknown = await response.json();
    if (!response.ok) {
      const message = result as { error?: string };
      throw new Error(message.error ?? "Unable to read the Privy wallet policy.");
    }
    return result as ProtectionData;
  }, [address, getAuthToken]);

  useEffect(() => {
    if (provider !== "privy" || !authenticated) return;
    void fetchProtection().then((result) => {
      setProtection(result);
    }).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Unable to read the Privy wallet policy.");
    });
  }, [provider, authenticated, fetchProtection]);

  const enableProtection = async () => {
    if (!address || !protection?.expectedPolicyId || !getAuthToken) return;
    const embeddedWallet = user?.linkedAccounts.find((account) =>
      account.type === "wallet" &&
      (account.walletClientType === "privy" || account.walletClientType === "privy-v2") &&
      account.address.toLowerCase() === address.toLowerCase(),
    );
    if (!embeddedWallet || !("id" in embeddedWallet) || !embeddedWallet.id) {
      setError("Privy did not expose a wallet ID for this embedded wallet; policy attachment cannot be authorized.");
      return;
    }
    const walletId = embeddedWallet.id;

    setBusy(true);
    setError(null);
    try {
      const requestExpiry = String(Date.now() + 60_000);
      const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
      if (!appId) throw new Error("Set NEXT_PUBLIC_PRIVY_APP_ID before attaching the Privy policy.");
      const url = `https://api.privy.io/v1/wallets/${encodeURIComponent(walletId)}`;
      const signed = await generateAuthorizationSignature({
        version: 1,
        method: "PATCH",
        url,
        body: { policy_ids: [protection.expectedPolicyId] },
        headers: {
          "privy-app-id": appId,
          "privy-request-expiry": requestExpiry,
        },
      });
      const token = await getAuthToken();
      if (!token) throw new Error("Privy did not provide an access token for the policy update.");
      const response = await fetch("/api/wallet-protection", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          address,
          authorizationSignature: signed.signature,
          requestExpiry,
        }),
      });
      const result: unknown = await response.json();
      if (!response.ok) {
        const message = result as { error?: string };
        throw new Error(message.error ?? "Privy rejected the wallet policy update.");
      }
      setProtection(result as ProtectionData);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to attach the Privy wallet policy.");
    } finally {
      setBusy(false);
    }
  };

  if (provider !== "privy" || !authenticated) return null;

  return (
    <section className="mt-5 rounded-2xl border border-slate-700 bg-slate-950/60 p-4 text-sm text-slate-300">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-white">Wallet protection</h2>
          <p className="mt-1">
            {protection?.assigned
              ? `Privy reports policy “${protection.policy?.name ?? "unnamed"}” attached to this embedded wallet.`
              : protection?.configured
                ? "No configured SafePay policy is attached to this embedded wallet yet."
                : protection?.message ?? "Checking the Privy wallet policy…"}
          </p>
        </div>
        <div className="flex gap-2">
          {!protection?.assigned && protection?.expectedPolicyId ? (
            <button
              type="button"
              onClick={() => void enableProtection()}
              disabled={busy}
              className="rounded-lg border border-amber-500/50 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-500/10 disabled:opacity-50"
            >
              {busy ? "Applying…" : "Enable policy"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setError(null);
              void fetchProtection().then(setProtection).catch((cause: unknown) => setError(
                cause instanceof Error ? cause.message : "Unable to refresh Privy policy status.",
              ));
            }}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium hover:border-slate-500"
          >
            Refresh
          </button>
        </div>
      </div>
      {error ? <p role="alert" className="mt-3 text-red-300">{error}</p> : null}
      {protection?.policy ? (
        <div className="mt-4 space-y-3">
          <p className="break-all text-xs text-slate-400">
            Policy ID: {protection.policy.id} · chain type: {protection.policy.chainType}
          </p>
          {protection.policy.rules.map((rule, index) => (
            <div key={`${rule.name}-${index}`} className="rounded-lg border border-slate-800 p-3">
              <p className="font-medium text-slate-100">{rule.name}</p>
              <p className="mt-1 text-xs text-slate-400">{rule.action} · {rule.method}</p>
              {rule.conditions.map((condition, conditionIndex) => (
                <p key={`${condition.field_source}-${condition.field}-${conditionIndex}`} className="mt-1 break-all text-xs text-slate-400">
                  {condition.field_source}.{condition.field} {condition.operator} {JSON.stringify(condition.value)}
                </p>
              ))}
            </div>
          ))}
        </div>
      ) : null}
      <p className="mt-3 text-xs text-slate-500">
        Rules above are read from Privy. A displayed policy is not a substitute for verifying its allowlist and transaction cap in the Privy Dashboard.
      </p>
    </section>
  );
}
