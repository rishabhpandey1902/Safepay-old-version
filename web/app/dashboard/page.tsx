"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { isAddress, parseAbiItem, type Address } from "viem";

import { safePayEscrowAbi } from "@/lib/contracts";
import { formatTokenDisplay } from "@/lib/token";
import { useSafePayWallet } from "@/lib/wallet/useSafePayWallet";
import { RoleSignInLink } from "@/lib/wallet/role-sign-in-link";
import { useTokenConfig } from "../token-provider";

type AgreementSummary = {
  agreementId: number;
  client: Address;
  contractor: Address;
  token: Address;
  totalAmount: bigint;
  remainingBalance: bigint;
  clientCancellationFee: bigint;
  status: number;
  milestoneCount: bigint;
  fundedAt: bigint;
};

type MilestoneSummary = {
  agreementId: number;
  milestoneIndex: number;
  amount: bigint;
  status: number;
  evidenceURI: string;
  approvalDeadline: bigint;
  disputeDeadline: bigint;
};

type ActivityItem = {
  type: string;
  title: string;
  details: string;
  amount?: bigint;
  txHash: `0x${string}`;
  blockNumber: bigint;
  agreementId?: number;
};

const toAddressString = (value?: string) => value?.toLowerCase() ?? "";

export default function DashboardPage() {
  const { ready, authenticated, address, logout, publicClient, chainName, chainId } = useSafePayWallet();
  const [agreements, setAgreements] = useState<AgreementSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const tokenConfig = useTokenConfig();

  const contractAddress = process.env.NEXT_PUBLIC_SAFE_PAY_ESCROW_ADDRESS as Address | undefined;
  const activeAddress = toAddressString(address);

  const agreementCreatedEvent = parseAbiItem(
    "event AgreementCreated(uint256 indexed agreementId,address indexed client,address indexed contractor,address token,address resolver,uint256 totalAmount,uint256 approvalWindow,uint256 disputeWindow,uint256 clientCancellationFee,uint256 milestoneCount)",
  );
  const agreementFundedEvent = parseAbiItem(
    "event AgreementFunded(uint256 indexed agreementId,address indexed client,uint256 amount)",
  );
  const milestoneSubmittedEvent = parseAbiItem(
    "event MilestoneSubmitted(uint256 indexed agreementId,uint256 indexed milestoneIndex,bytes32 evidenceHash,string evidenceURI,uint256 approvalDeadline,uint256 disputeDeadline)",
  );
  const milestoneApprovedEvent = parseAbiItem(
    "event MilestoneApproved(uint256 indexed agreementId,uint256 indexed milestoneIndex,address indexed client)",
  );
  const milestoneReleasedEvent = parseAbiItem(
    "event MilestoneReleased(uint256 indexed agreementId,uint256 indexed milestoneIndex,address indexed caller,uint256 amount,bool automatic)",
  );
  const milestoneDisputedEvent = parseAbiItem(
    "event MilestoneDisputed(uint256 indexed agreementId,uint256 indexed milestoneIndex,address indexed raisedBy,bytes32 reasonHash,string reasonURI)",
  );
  const disputeResolvedEvent = parseAbiItem(
    "event DisputeResolved(uint256 indexed agreementId,uint256 indexed milestoneIndex,address indexed resolver,uint8 resolution,uint256 contractorAmount,uint256 clientAmount)",
  );
  const agreementCancelledEvent = parseAbiItem(
    "event AgreementCancelled(uint256 indexed agreementId,address indexed cancelledBy,uint256 contractorFee,uint256 clientRefund)",
  );
  const agreementSettledEvent = parseAbiItem(
    "event AgreementSettled(uint256 indexed agreementId)",
  );

  useEffect(() => {
    if (tokenConfig.status === "loading") return;
    if (tokenConfig.status === "error") return;
    if (!contractAddress || !isAddress(contractAddress) || contractAddress === "0x0000000000000000000000000000000000000000") {
      setError("Set NEXT_PUBLIC_SAFE_PAY_ESCROW_ADDRESS before viewing the dashboard.");
      setLoading(false);
      return;
    }

    const loadDashboard = async () => {
      try {
        setLoading(true);

        const agreementCount = await publicClient.readContract({
          address: contractAddress,
          abi: safePayEscrowAbi,
          functionName: "agreementCount",
        });

        const count = Number(agreementCount);
        const entries = await Promise.all(
          Array.from({ length: count }, (_, index) =>
            publicClient.readContract({
              address: contractAddress,
              abi: safePayEscrowAbi,
              functionName: "getAgreement",
              args: [BigInt(index + 1)],
            }),
          ),
        );

        const agreementList = entries
          .map((entry: any, index) => ({
            agreementId: index + 1,
            client: entry.client,
            contractor: entry.contractor,
            token: entry.token,
            totalAmount: entry.totalAmount,
            remainingBalance: entry.remainingBalance,
            clientCancellationFee: entry.clientCancellationFee,
            status: Number(entry.status),
            milestoneCount: entry.milestoneCount,
            fundedAt: entry.fundedAt,
          }))
          .filter(
            (entry) =>
              entry.client &&
              entry.contractor &&
              entry.token.toLowerCase() === tokenConfig.metadata.address.toLowerCase(),
          )
          .sort((left, right) => right.agreementId - left.agreementId);

        setAgreements(agreementList);
        const configuredAgreementIds = new Set(agreementList.map((entry) => entry.agreementId));

        const logPromises = [
          publicClient.getLogs({ address: contractAddress, event: agreementCreatedEvent, fromBlock: BigInt(0), toBlock: "latest" }),
          publicClient.getLogs({ address: contractAddress, event: agreementFundedEvent, fromBlock: BigInt(0), toBlock: "latest" }),
          publicClient.getLogs({ address: contractAddress, event: milestoneSubmittedEvent, fromBlock: BigInt(0), toBlock: "latest" }),
          publicClient.getLogs({ address: contractAddress, event: milestoneApprovedEvent, fromBlock: BigInt(0), toBlock: "latest" }),
          publicClient.getLogs({ address: contractAddress, event: milestoneReleasedEvent, fromBlock: BigInt(0), toBlock: "latest" }),
          publicClient.getLogs({ address: contractAddress, event: milestoneDisputedEvent, fromBlock: BigInt(0), toBlock: "latest" }),
          publicClient.getLogs({ address: contractAddress, event: disputeResolvedEvent, fromBlock: BigInt(0), toBlock: "latest" }),
          publicClient.getLogs({ address: contractAddress, event: agreementCancelledEvent, fromBlock: BigInt(0), toBlock: "latest" }),
          publicClient.getLogs({ address: contractAddress, event: agreementSettledEvent, fromBlock: BigInt(0), toBlock: "latest" }),
        ];

        const [created, funded, submitted, approved, released, disputed, resolved, cancelled, settled] = await Promise.all(logPromises);

        const buildActivity = (log: any, type: string, title: string, details: string, amount?: bigint, agreementId?: number) => ({
          type,
          title,
          details,
          amount: amount ?? BigInt(0),
          txHash: log.transactionHash as `0x${string}`,
          blockNumber: log.blockNumber,
          agreementId: agreementId ?? Number(log.args?.agreementId ?? 0),
        });

        const combined: ActivityItem[] = [
          ...created.filter((log) => configuredAgreementIds.has(Number(log.args.agreementId))).map((log) => {
            const args = (log as any).args;
            return buildActivity(
              log,
              "AgreementCreated",
              "Agreement created",
              `Agreement #${Number(args.agreementId)} created for ${formatTokenDisplay(args.totalAmount ?? BigInt(0), tokenConfig.metadata)}`,
              args.totalAmount as bigint,
              Number(args.agreementId),
            );
          }),
          ...funded.filter((log) => configuredAgreementIds.has(Number(log.args.agreementId))).map((log) => {
            const args = (log as any).args;
            return buildActivity(
              log,
              "AgreementFunded",
              "Agreement funded",
              `Agreement #${Number(args.agreementId)} funded for ${formatTokenDisplay(args.amount ?? BigInt(0), tokenConfig.metadata)}`,
              args.amount as bigint,
              Number(args.agreementId),
            );
          }),
          ...submitted.filter((log) => configuredAgreementIds.has(Number(log.args.agreementId))).map((log) => {
            const args = (log as any).args;
            return buildActivity(
              log,
              "MilestoneSubmitted",
              "Milestone submitted",
              `Agreement #${Number(args.agreementId)} milestone ${Number(args.milestoneIndex)} is ready for review`,
              BigInt(0),
              Number(args.agreementId),
            );
          }),
          ...approved.filter((log) => configuredAgreementIds.has(Number(log.args.agreementId))).map((log) => {
            const args = (log as any).args;
            return buildActivity(
              log,
              "MilestoneApproved",
              "Milestone approved",
              `Agreement #${Number(args.agreementId)} milestone ${Number(args.milestoneIndex)} approved`,
              BigInt(0),
              Number(args.agreementId),
            );
          }),
          ...released.filter((log) => configuredAgreementIds.has(Number(log.args.agreementId))).map((log) => {
            const args = (log as any).args;
            return buildActivity(
              log,
              "MilestoneReleased",
              "Milestone released",
              `Agreement #${Number(args.agreementId)} milestone ${Number(args.milestoneIndex)} released`,
              args.amount as bigint,
              Number(args.agreementId),
            );
          }),
          ...disputed.filter((log) => configuredAgreementIds.has(Number(log.args.agreementId))).map((log) => {
            const args = (log as any).args;
            return buildActivity(
              log,
              "MilestoneDisputed",
              "Milestone disputed",
              `Agreement #${Number(args.agreementId)} milestone ${Number(args.milestoneIndex)} is in dispute`,
              BigInt(0),
              Number(args.agreementId),
            );
          }),
          ...resolved.filter((log) => configuredAgreementIds.has(Number(log.args.agreementId))).map((log) => {
            const args = (log as any).args;
            return buildActivity(
              log,
              "DisputeResolved",
              "Dispute resolved",
              `Agreement #${Number(args.agreementId)} dispute resolved`,
              args.clientAmount ?? BigInt(0),
              Number(args.agreementId),
            );
          }),
          ...cancelled.filter((log) => configuredAgreementIds.has(Number(log.args.agreementId))).map((log) => {
            const args = (log as any).args;
            return buildActivity(
              log,
              "AgreementCancelled",
              "Agreement cancelled",
              `Agreement #${Number(args.agreementId)} cancelled`,
              args.clientRefund ?? BigInt(0),
              Number(args.agreementId),
            );
          }),
          ...settled.filter((log) => configuredAgreementIds.has(Number(log.args.agreementId))).map((log) => {
            const args = (log as any).args;
            return buildActivity(
              log,
              "AgreementSettled",
              "Agreement settled",
              `Agreement #${Number(args.agreementId)} settled`,
              BigInt(0),
              Number(args.agreementId),
            );
          }),
        ].sort((left, right) => Number(right.blockNumber - left.blockNumber));

        setActivity(combined.slice(0, 12));
        setError(null);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load your SafePay dashboard.");
      } finally {
        setLoading(false);
      }
    };

    void loadDashboard();
  }, [contractAddress, publicClient, authenticated, activeAddress, tokenConfig]);

  const formatAmount = (value: bigint) =>
    tokenConfig.status === "ready"
      ? formatTokenDisplay(value, tokenConfig.metadata)
      : "—";
  const dashboardLoading = loading && tokenConfig.status !== "error";

  const activeAgreements = agreements.filter((agreement) => {
    const isRelevant = agreement.client === activeAddress || agreement.contractor === activeAddress;
    return isRelevant && agreement.status === 1;
  });

  const awaitingApproval = agreements.filter((agreement) => {
    if (agreement.client !== activeAddress) return false;
    return agreement.status === 1;
  });

  const upcomingReleases = agreements.filter((agreement) => {
    if (agreement.contractor !== activeAddress) return false;
    return agreement.status === 1;
  });

  if (!ready) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 px-8 py-6 text-slate-50">
          <span className="text-lg font-medium">Loading SafePay dashboard…</span>
        </div>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 py-10">
        <div className="w-full max-w-xl rounded-3xl border border-slate-800 bg-slate-900 p-8 text-slate-50">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-violet-400">SafePay</p>
          <h1 className="mt-4 text-3xl font-semibold">Sign in to view your dashboard</h1>
          <p className="mt-3 text-slate-300">See the agreements you are managing and the milestones that need attention.</p>
          <RoleSignInLink className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-violet-600 px-4 py-3 text-base font-semibold text-white transition hover:bg-violet-500">Choose a wallet role and sign in</RoleSignInLink>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-10 text-slate-50">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-violet-400">SafePay</p>
            <h1 className="mt-2 text-3xl font-semibold">Dashboard</h1>
            <p className="mt-2 break-all text-sm text-slate-400">
              {address ?? "No wallet address"} · {chainName}{chainId ? ` (chain ${chainId})` : ""}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/create" className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-500">
              Create SafePay
            </Link>
            <button type="button" onClick={() => void logout()} className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-slate-500">
              Log out
            </button>
          </div>
        </div>

        {error || tokenConfig.status === "error" ? (
          <div className="mb-6 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error ?? tokenConfig.error}
          </div>
        ) : null}

        {dashboardLoading ? (
          <div className="rounded-3xl border border-slate-800 bg-slate-900 p-8 text-slate-200">Loading your agreements…</div>
        ) : (
          <div className="space-y-8">
            <section className="grid gap-4 md:grid-cols-4">
              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Active</p>
                <p className="mt-3 text-3xl font-semibold text-white">{activeAgreements.length}</p>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Awaiting my approval</p>
                <p className="mt-3 text-3xl font-semibold text-white">{awaitingApproval.length}</p>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Upcoming releases</p>
                <p className="mt-3 text-3xl font-semibold text-white">{upcomingReleases.length}</p>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Recent activity</p>
                <p className="mt-3 text-3xl font-semibold text-white">{activity.length}</p>
              </div>
            </section>

            <div className="grid gap-8 xl:grid-cols-[1.2fr_0.8fr]">
              <section className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-xl font-semibold text-white">Active agreements</h2>
                  <Link href="/create" className="text-sm font-medium text-violet-300 transition hover:text-violet-200">
                    Create SafePay
                  </Link>
                </div>

                {activeAgreements.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/40 p-8 text-center text-slate-300">
                    <p className="text-lg font-medium text-white">No active agreements yet</p>
                    <p className="mt-2">Create an agreement draft. Contract actions require a verified SafePay deployment.</p>
                    <Link href="/create" className="mt-5 inline-flex items-center justify-center rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-500">
                      Create SafePay
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {activeAgreements.map((agreement) => (
                      <Link
                        key={agreement.agreementId}
                        href={`/agreement/${agreement.agreementId}`}
                        className="block rounded-2xl border border-slate-700 bg-slate-950/60 p-4 transition hover:border-violet-500/50"
                      >
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <p className="text-sm uppercase tracking-[0.2em] text-slate-400">Agreement #{agreement.agreementId}</p>
                            <p className="mt-2 text-lg font-semibold text-white">{formatAmount(agreement.totalAmount)}</p>
                          </div>
                          <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-200">
                            Active
                          </span>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-3 text-sm text-slate-300">
                          <span>Client: {agreement.client.slice(0, 6)}...{agreement.client.slice(-4)}</span>
                          <span>Contractor: {agreement.contractor.slice(0, 6)}...{agreement.contractor.slice(-4)}</span>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </section>

              <section className="space-y-8">
                <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
                  <h2 className="text-xl font-semibold text-white">Awaiting my approval</h2>
                  {awaitingApproval.length === 0 ? (
                    <div className="mt-4 rounded-2xl border border-dashed border-slate-700 bg-slate-950/40 p-4 text-sm text-slate-300">
                      Nothing is waiting for your approval.
                    </div>
                  ) : (
                    <div className="mt-4 space-y-3">
                      {awaitingApproval.map((agreement) => (
                        <Link key={agreement.agreementId} href={`/agreement/${agreement.agreementId}`} className="block rounded-2xl border border-slate-700 bg-slate-950/60 p-3 text-sm text-slate-300 hover:border-violet-500/50">
                          Agreement #{agreement.agreementId} • {formatAmount(agreement.totalAmount)}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
                  <h2 className="text-xl font-semibold text-white">Upcoming releases</h2>
                  {upcomingReleases.length === 0 ? (
                    <div className="mt-4 rounded-2xl border border-dashed border-slate-700 bg-slate-950/40 p-4 text-sm text-slate-300">
                      There are no pending releases for you right now.
                    </div>
                  ) : (
                    <div className="mt-4 space-y-3">
                      {upcomingReleases.map((agreement) => (
                        <Link key={agreement.agreementId} href={`/agreement/${agreement.agreementId}`} className="block rounded-2xl border border-slate-700 bg-slate-950/60 p-3 text-sm text-slate-300 hover:border-violet-500/50">
                          Agreement #{agreement.agreementId} • {formatAmount(agreement.remainingBalance)} remaining
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            </div>

            <section className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
              <h2 className="text-xl font-semibold text-white">Recent activity</h2>
              {activity.length === 0 ? (
                <div className="mt-4 rounded-2xl border border-dashed border-slate-700 bg-slate-950/40 p-6 text-center text-slate-300">
                  No activity yet. Your SafePay timeline will appear here.
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  {activity.map((entry, index) => (
                    <div key={`${entry.txHash}-${index}`} className="rounded-2xl border border-slate-700 bg-slate-950/60 p-4">
                      <div className="flex items-center justify-between gap-4">
                        <p className="font-medium text-white">{entry.title}</p>
                        {entry.amount ? <span className="text-sm text-violet-200">{formatAmount(entry.amount)}</span> : null}
                      </div>
                      <p className="mt-2 text-sm text-slate-300">{entry.details}</p>
                      <a href={`https://testnet.monadexplorer.com/tx/${entry.txHash}`} target="_blank" rel="noreferrer" className="mt-3 inline-block break-all text-xs text-violet-300 hover:text-violet-200">
                        {entry.txHash}
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
