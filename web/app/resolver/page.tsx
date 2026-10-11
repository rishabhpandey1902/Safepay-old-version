"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  isAddress,
  type Address,
} from "viem";

import { safePayEscrowAbi } from "@/lib/contracts";
import { formatTokenDisplay, parseTokenAmount } from "@/lib/token";
import { useSafePayWallet } from "@/lib/wallet/useSafePayWallet";
import { RoleSignInLink } from "@/lib/wallet/role-sign-in-link";
import { useTokenConfig } from "../token-provider";

type AgreementDetails = {
  client: Address;
  contractor: Address;
  token: Address;
  resolver: Address;
  totalAmount: bigint;
  milestoneCount: bigint;
};

type MilestoneData = {
  amount: bigint;
  status: number;
  evidenceURI: string;
  disputeRaisedBy: Address;
  disputeReasonURI: string;
};

type DisputeEntry = {
  agreementId: number;
  milestoneIndex: number;
  agreement: AgreementDetails;
  milestone: MilestoneData;
};

type TxRow = { hash: `0x${string}`; status: "pending" | "confirmed" | "failed"; label: string };

const zeroAddress = "0x0000000000000000000000000000000000000000";
const explorerUrl = (hash: `0x${string}`) => `https://testnet.monadexplorer.com/tx/${hash}`;

function externalHref(uri: string) {
  if (uri.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${uri.slice("ipfs://".length)}`;
  try {
    const parsed = new URL(uri);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export default function ResolverPage() {
  const { ready, authenticated, address, walletClient, publicClient, chainName, chainId } = useSafePayWallet();
  const tokenConfig = useTokenConfig();
  const [entries, setEntries] = useState<DisputeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [splitAmounts, setSplitAmounts] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [txRows, setTxRows] = useState<TxRow[]>([]);
  const [refreshTick, setRefreshTick] = useState(0);

  const contractAddress = process.env.NEXT_PUBLIC_SAFE_PAY_ESCROW_ADDRESS as Address | undefined;
  const activeAddress = address?.toLowerCase() ?? "";
  const configurationError = !contractAddress || !isAddress(contractAddress) || contractAddress === zeroAddress
    ? "Set NEXT_PUBLIC_SAFE_PAY_ESCROW_ADDRESS before opening the resolver queue."
    : tokenConfig.status === "error"
      ? tokenConfig.error
    : null;
  const walletError = authenticated && !activeAddress ? "Your resolver wallet is not ready yet." : null;
  const visibleError = error ?? configurationError ?? walletError;

  useEffect(() => {
    if (tokenConfig.status === "loading") return;
    if (configurationError || !contractAddress || !authenticated || !activeAddress) return;

    const loadResolverQueue = async () => {
      try {
        setLoading(true);
        const count = Number(await publicClient.readContract({
          address: contractAddress,
          abi: safePayEscrowAbi,
          functionName: "agreementCount",
        }));
        const agreementReads = await Promise.all(
          Array.from({ length: count }, (_, index) =>
            publicClient.readContract({
              address: contractAddress,
              abi: safePayEscrowAbi,
              functionName: "getAgreement",
              args: [BigInt(index + 1)],
            }),
          ),
        );
        const queue: DisputeEntry[] = [];
        await Promise.all(agreementReads.map(async (rawAgreement, index) => {
          const agreement = rawAgreement as AgreementDetails;
          if (
            tokenConfig.status !== "ready" ||
            agreement.token.toLowerCase() !== tokenConfig.metadata.address.toLowerCase()
          ) return;
          if (agreement.resolver.toLowerCase() !== activeAddress) return;
          const milestoneReads = await Promise.all(
            Array.from({ length: Number(agreement.milestoneCount) }, (_, milestoneIndex) =>
              publicClient.readContract({
                address: contractAddress,
                abi: safePayEscrowAbi,
                functionName: "getMilestone",
                args: [BigInt(index + 1), BigInt(milestoneIndex)],
              }),
            ),
          );
          milestoneReads.forEach((rawMilestone, milestoneIndex) => {
            const milestone = rawMilestone as MilestoneData;
            if (Number(milestone.status) === 3) {
              queue.push({ agreementId: index + 1, milestoneIndex, agreement, milestone });
            }
          });
        }));
        setEntries(queue.sort((left, right) => right.agreementId - left.agreementId || left.milestoneIndex - right.milestoneIndex));
        setError(null);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load assigned disputes.");
      } finally {
        setLoading(false);
      }
    };

    void loadResolverQueue();
  }, [activeAddress, authenticated, configurationError, contractAddress, publicClient, refreshTick, tokenConfig]);

  const resolve = async (entry: DisputeEntry, resolution: 0 | 1 | 2) => {
    if (!contractAddress || !authenticated || !address || !walletClient) {
      setError("Connect the resolver wallet to continue.");
      return;
    }
    if (walletClient.account?.address.toLowerCase() !== activeAddress) {
      setError("The transaction wallet does not match the selected resolver address.");
      return;
    }
    const key = `${entry.agreementId}-${entry.milestoneIndex}`;
    const amountInput = splitAmounts[key]?.trim() ?? "";
    if (tokenConfig.status !== "ready") {
      setError(tokenConfig.status === "error" ? tokenConfig.error : "Settlement token metadata is still loading.");
      return;
    }
    let contractorAmount = BigInt(0);
    if (resolution === 2) {
      try {
        contractorAmount = parseTokenAmount(amountInput, tokenConfig.metadata.decimals);
      } catch {
        setError(`Enter a valid ${tokenConfig.metadata.symbol} amount for a split.`);
        return;
      }
      if (contractorAmount <= BigInt(0) || contractorAmount >= entry.milestone.amount) {
        setError("The contractor share must be greater than zero and less than the milestone amount.");
        return;
      }
    }

    setBusyKey(`${key}-${resolution}`);
    setError(null);
    try {
      const hash = await walletClient.writeContract({
        address: contractAddress,
        abi: safePayEscrowAbi,
        functionName: "resolveDispute",
        args: [BigInt(entry.agreementId), BigInt(entry.milestoneIndex), resolution, contractorAmount],
      }) as `0x${string}`;
      setTxRows((current) => [{ hash, label: `Agreement #${entry.agreementId}, milestone ${entry.milestoneIndex + 1}`, status: "pending" }, ...current]);
      try {
        await publicClient.waitForTransactionReceipt({ hash });
        setTxRows((current) => current.map((row) => row.hash === hash ? { ...row, status: "confirmed" } : row));
      } catch {
        setTxRows((current) => current.map((row) => row.hash === hash ? { ...row, status: "failed" } : row));
        throw new Error("The transaction was submitted, but its receipt could not be confirmed.");
      }
      setRefreshTick((current) => current + 1);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "The dispute could not be resolved.");
    } finally {
      setBusyKey(null);
    }
  };

  if (!ready) return <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-slate-100">Loading SafePay…</main>;

  if (!authenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 py-10 text-slate-100">
        <section className="w-full max-w-lg border-l-2 border-teal-500 bg-slate-900 p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-300">SafePay / Resolver</p>
          <h1 className="mt-4 text-2xl font-semibold">Resolver sign-in required</h1>
          <p className="mt-2 text-sm text-slate-400">Only the address assigned to a dispute can view its resolution actions.</p>
          <RoleSignInLink className="mt-6 inline-block bg-teal-600 px-4 py-3 text-sm font-semibold text-white hover:bg-teal-500">Choose a wallet role and sign in</RoleSignInLink>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 px-5 py-8 text-slate-100 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-slate-800 pb-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-300">SafePay / Resolver</p>
            <h1 className="mt-2 text-3xl font-semibold">Assigned disputes</h1>
            <p className="mt-2 break-all text-sm text-slate-400">Connected address: {address} · {chainName}{chainId ? ` (chain ${chainId})` : ""}</p>
          </div>
          <Link href="/dashboard" className="border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:border-teal-500">Dashboard</Link>
        </header>

        {visibleError ? <div role="alert" className="mb-5 border border-red-500/40 bg-red-950/50 px-4 py-3 text-sm text-red-200">{visibleError}</div> : null}
        {loading && !visibleError ? <p className="py-12 text-slate-300">Loading assigned disputes…</p> : visibleError ? null : entries.length === 0 ? (
          <section className="border border-slate-800 bg-slate-900/70 p-8 text-center">
            <h2 className="text-lg font-medium">No disputes assigned to this address</h2>
            <p className="mt-2 text-sm text-slate-400">Resolution controls appear only for disputes where this wallet is the appointed resolver.</p>
          </section>
        ) : (
          <div className="space-y-5">
            {entries.map((entry) => {
              const key = `${entry.agreementId}-${entry.milestoneIndex}`;
              const evidenceHref = externalHref(entry.milestone.evidenceURI);
              const reasonHref = externalHref(entry.milestone.disputeReasonURI);
              const amount = tokenConfig.status === "ready"
                ? formatTokenDisplay(entry.milestone.amount, tokenConfig.metadata)
                : "—";
              return (
                <article key={key} className="border border-slate-800 bg-slate-900/70">
                  <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-5 py-4">
                    <div>
                      <h2 className="text-lg font-semibold">Agreement #{entry.agreementId}, milestone {entry.milestoneIndex + 1}</h2>
                      <p className="mt-1 text-sm text-slate-400">Disputed amount: {amount}</p>
                    </div>
                    <Link href={`/dispute/${entry.agreementId}`} className="text-sm font-medium text-teal-300 hover:text-teal-200">View dispute record</Link>
                  </header>
                  <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
                    <div>
                      <p className="text-xs uppercase tracking-widest text-slate-400">Contractor evidence</p>
                      {evidenceHref ? <a href={evidenceHref} target="_blank" rel="noreferrer" className="mt-2 block break-all text-sm text-teal-300 underline">Open evidence link</a> : <p className="mt-2 break-all text-sm text-slate-300">{entry.milestone.evidenceURI || "No evidence link provided."}</p>}
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-widest text-slate-400">Dispute note or evidence</p>
                      {reasonHref ? <a href={reasonHref} target="_blank" rel="noreferrer" className="mt-2 block break-all text-sm text-amber-300 underline">Open dispute link</a> : <p className="mt-2 break-all text-sm text-slate-300">{entry.milestone.disputeReasonURI || "No dispute link provided."}</p>}
                    </div>
                  </div>
                  <div className="grid gap-3 border-t border-slate-800 px-5 py-4 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
                    <label className="block text-xs uppercase tracking-widest text-slate-400">
                      Contractor share for split ({tokenConfig.status === "ready" ? tokenConfig.metadata.symbol : "token"})
                      <input
                        inputMode="decimal"
                        value={splitAmounts[key] ?? ""}
                        onChange={(event) => setSplitAmounts((current) => ({ ...current, [key]: event.target.value }))}
                        placeholder={`Between 0 and the milestone amount (${tokenConfig.status === "ready" ? tokenConfig.metadata.symbol : "token"})`}
                        className="mt-2 w-full border border-slate-700 bg-slate-950 px-3 py-2 text-sm normal-case tracking-normal text-white outline-none focus:border-teal-500"
                      />
                    </label>
                    <button type="button" onClick={() => void resolve(entry, 0)} disabled={busyKey !== null} className="w-full bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50 sm:w-auto">{busyKey === `${key}-0` ? "Releasing…" : "Release to contractor"}</button>
                    <button type="button" onClick={() => void resolve(entry, 1)} disabled={busyKey !== null} className="w-full bg-slate-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-600 disabled:opacity-50 sm:w-auto">{busyKey === `${key}-1` ? "Refunding…" : "Refund client"}</button>
                    <button type="button" onClick={() => void resolve(entry, 2)} disabled={busyKey !== null} className="w-full bg-amber-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50 sm:w-auto">{busyKey === `${key}-2` ? "Splitting…" : "Split settlement"}</button>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {txRows.length > 0 ? (
          <section className="mt-8 border-t border-slate-800 pt-5">
            <h2 className="text-lg font-semibold">Resolution transactions</h2>
            <div className="mt-3 space-y-3">
              {txRows.map((row) => (
                <div key={row.hash} className="flex flex-wrap items-center justify-between gap-3 border border-slate-800 bg-slate-900 px-4 py-3 text-sm">
                  <span>{row.label} · {row.status}</span>
                  <a href={explorerUrl(row.hash)} target="_blank" rel="noreferrer" className="break-all text-teal-300 underline">{row.hash}</a>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}