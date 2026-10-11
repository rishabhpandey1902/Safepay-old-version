"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { isAddress, type Address } from "viem";

import { safePayEscrowAbi } from "@/lib/contracts";
import { formatTokenDisplay } from "@/lib/token";
import { useSafePayWallet } from "@/lib/wallet/useSafePayWallet";
import { RoleSignInLink } from "@/lib/wallet/role-sign-in-link";
import { useTokenConfig } from "../../token-provider";

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
  evidenceHash: `0x${string}`;
  evidenceURI: string;
  submittedAt: bigint;
  disputeRaisedBy: Address;
  disputeReasonHash: `0x${string}`;
  disputeReasonURI: string;
};

const addressIs = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

function externalHref(uri: string) {
  if (uri.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${uri.slice("ipfs://".length)}`;
  try {
    const parsed = new URL(uri);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function Reference({ label, value }: { label: string; value: string }) {
  const href = externalHref(value);
  if (!value) return <p className="mt-2 text-sm text-slate-400">No link provided.</p>;
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className="mt-2 inline-block break-all text-sm text-teal-300 underline decoration-teal-700 underline-offset-4 hover:text-teal-200">
      {label}
    </a>
  ) : (
    <p className="mt-2 break-all text-sm text-slate-300">{value}</p>
  );
}

export default function DisputePage() {
  const params = useParams<{ id: string }>();
  const agreementId = Number(params?.id ?? "0");
  const { ready, authenticated, address, publicClient, chainName, chainId } = useSafePayWallet();
  const tokenConfig = useTokenConfig();
  const [agreement, setAgreement] = useState<AgreementDetails | null>(null);
  const [milestones, setMilestones] = useState<MilestoneData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const contractAddress = process.env.NEXT_PUBLIC_SAFE_PAY_ESCROW_ADDRESS as Address | undefined;
  const formatAmount = (value: bigint) =>
    tokenConfig.status === "ready"
      ? formatTokenDisplay(value, tokenConfig.metadata)
      : "—";
  const configurationError =
    !contractAddress ||
    !isAddress(contractAddress) ||
    contractAddress === "0x0000000000000000000000000000000000000000"
      ? "Set NEXT_PUBLIC_SAFE_PAY_ESCROW_ADDRESS before viewing disputes."
      : null;
  const routeError = !Number.isSafeInteger(agreementId) || agreementId <= 0
    ? "This agreement id is not valid."
    : null;
  const visibleError = error ?? configurationError ?? routeError ??
    (tokenConfig.status === "error" ? tokenConfig.error : null);

  useEffect(() => {
    if (tokenConfig.status === "loading") return;
    if (tokenConfig.status === "error") return;
    if (configurationError || routeError || !contractAddress) return;

    const loadDispute = async () => {
      try {
        setLoading(true);
        const details = await publicClient.readContract({
          address: contractAddress,
          abi: safePayEscrowAbi,
          functionName: "getAgreement",
          args: [BigInt(agreementId)],
        }) as AgreementDetails;
        if (details.token.toLowerCase() !== tokenConfig.metadata.address.toLowerCase()) {
          throw new Error("This agreement uses a token different from NEXT_PUBLIC_SAFE_PAY_TOKEN_ADDRESS.");
        }
        const milestoneData = await Promise.all(
          Array.from({ length: Number(details.milestoneCount) }, (_, index) =>
            publicClient.readContract({
              address: contractAddress,
              abi: safePayEscrowAbi,
              functionName: "getMilestone",
              args: [BigInt(agreementId), BigInt(index)],
            }),
          ),
        );
        setAgreement(details);
        setMilestones(milestoneData as MilestoneData[]);
        setError(null);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load dispute details.");
      } finally {
        setLoading(false);
      }
    };

    void loadDispute();
  }, [agreementId, configurationError, contractAddress, publicClient, routeError, tokenConfig]);

  if (!ready) {
    return <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-slate-100">Loading SafePay…</main>;
  }

  if (!authenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 py-10 text-slate-100">
        <section className="w-full max-w-lg border-l-2 border-teal-500 bg-slate-900 p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-300">SafePay / Dispute</p>
          <h1 className="mt-4 text-2xl font-semibold">Sign in to view this dispute</h1>
          <RoleSignInLink className="mt-6 inline-block bg-teal-600 px-4 py-3 text-sm font-semibold text-white hover:bg-teal-500">Choose a wallet role and sign in</RoleSignInLink>
        </section>
      </main>
    );
  }

  const disputed = milestones
    .map((milestone, index) => ({ milestone, index }))
    .filter(({ milestone }) => Number(milestone.status) === 3);

  return (
    <main className="min-h-screen bg-slate-950 px-5 py-8 text-slate-100 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-slate-800 pb-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-300">SafePay / Dispute record</p>
            <h1 className="mt-2 text-3xl font-semibold">Agreement #{agreementId}</h1>
            <p className="mt-2 break-all text-sm text-slate-400">{address ?? "No wallet address"} · {chainName}{chainId ? ` (chain ${chainId})` : ""}</p>
          </div>
          <div className="flex gap-3 text-sm">
            <Link href={`/agreement/${agreementId}`} className="border border-slate-700 px-3 py-2 text-slate-200 hover:border-teal-500">Agreement</Link>
            <Link href="/resolver" className="border border-slate-700 px-3 py-2 text-slate-200 hover:border-teal-500">Resolver view</Link>
          </div>
        </header>

        {visibleError ? <div role="alert" className="mb-5 border border-red-500/40 bg-red-950/50 px-4 py-3 text-sm text-red-200">{visibleError}</div> : null}
        {loading && !visibleError ? <p className="py-12 text-slate-300">Loading dispute record…</p> : agreement ? (
          <>
            <section className="mb-6 grid gap-4 border-b border-slate-800 pb-6 sm:grid-cols-3">
              <div><p className="text-xs uppercase tracking-widest text-slate-400">Client</p><p className="mt-2 break-all text-sm">{agreement.client}</p></div>
              <div><p className="text-xs uppercase tracking-widest text-slate-400">Contractor</p><p className="mt-2 break-all text-sm">{agreement.contractor}</p></div>
              <div><p className="text-xs uppercase tracking-widest text-slate-400">Resolver</p><p className="mt-2 break-all text-sm">{agreement.resolver}</p></div>
            </section>

            {disputed.length === 0 ? (
              <section className="border border-slate-800 bg-slate-900/70 p-8 text-center">
                <h2 className="text-lg font-medium">No open disputes</h2>
                <p className="mt-2 text-sm text-slate-400">This agreement has no milestones currently marked as disputed.</p>
              </section>
            ) : (
              <div className="space-y-6">
                {disputed.map(({ milestone, index }) => {
                  const disputeRaisedByClient = addressIs(milestone.disputeRaisedBy, agreement.client);
                  const raiser = disputeRaisedByClient ? "Client" : addressIs(milestone.disputeRaisedBy, agreement.contractor) ? "Contractor" : "Unknown participant";
                  return (
                    <article key={index} className="border border-slate-800 bg-slate-900/70">
                      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-5 py-4">
                        <h2 className="text-lg font-semibold">Milestone {index + 1}</h2>
                        <span className="border border-amber-500/40 bg-amber-950/40 px-2.5 py-1 text-xs font-medium text-amber-200">Disputed</span>
                      </header>
                      <div className="grid gap-px bg-slate-800 md:grid-cols-2">
                        <section className="bg-slate-900 p-5">
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-300">Contractor submission</p>
                          <p className="mt-3 text-sm text-slate-300">Evidence fingerprint</p>
                          <code className="mt-1 block break-all text-xs text-slate-100">{milestone.evidenceHash}</code>
                          <Reference label="Open contractor evidence" value={milestone.evidenceURI} />
                        </section>
                        <section className="bg-slate-900 p-5">
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-300">Dispute filed by {raiser}</p>
                          <p className="mt-3 text-sm text-slate-300">Reason fingerprint</p>
                          <code className="mt-1 block break-all text-xs text-slate-100">{milestone.disputeReasonHash}</code>
                          <Reference label="Open dispute note or evidence" value={milestone.disputeReasonURI} />
                          <p className="mt-3 break-all text-xs text-slate-400">{milestone.disputeRaisedBy}</p>
                        </section>
                      </div>
                      <p className="px-5 py-3 text-xs text-slate-400">The contract records fingerprints and links, not the note text itself. The other party&apos;s separate response is not stored on-chain.</p>
                      {address && addressIs(address, agreement.resolver) ? (
                        <footer className="border-t border-slate-800 px-5 py-3 text-right">
                          <Link href="/resolver" className="text-sm font-medium text-teal-300 hover:text-teal-200">Open resolver actions</Link>
                        </footer>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            )}
            <p className="mt-5 text-sm text-slate-400">Milestone amount: {formatAmount(disputed[0]?.milestone.amount ?? BigInt(0))}{disputed.length > 1 ? " for the first listed dispute" : ""}</p>
          </>
        ) : null}
      </div>
    </main>
  );
}