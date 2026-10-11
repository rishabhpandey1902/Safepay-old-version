"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  isAddress,
  keccak256,
  parseEventLogs,
  toBytes,
  type Address,
} from "viem";
import { z } from "zod";

import { agreementDraftSchema, type AgreementDraft } from "@/lib/agreement-draft";
import { safePayEscrowAbi } from "@/lib/contracts";
import { getConfiguredTokenAddress, parseTokenAmount, readTokenMetadata } from "@/lib/token";
import { useSafePayWallet } from "@/lib/wallet/useSafePayWallet";
import { RoleSignInLink } from "@/lib/wallet/role-sign-in-link";
import {
  convertUsdToDisplayCurrency,
  formatDisplayCurrency,
  type DisplayCurrency,
} from "@/lib/currency";
import {
  CurrencySelector,
  FxRateNotice,
  useFxRate,
} from "../currency-selector";
import { CrossNetworkPreview } from "./cross-network-preview";
import { useTokenConfig } from "../token-provider";
import { WalletProtectionPanel } from "../wallet-protection-panel";

const erc20Abi = [
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "allowance",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
] as const;

const milestoneSchema = z.object({
  description: z.string().trim().min(3, "Each milestone needs a short description.").max(180),
  amount: z.coerce.number().int("Use whole token amounts").positive("Milestone amounts must be greater than zero."),
});

const formSchema = z
  .object({
    contractorName: z.string().trim().max(100),
    contractorAddress: z
      .string()
      .trim()
      .min(1, "Contractor wallet address is required.")
      .refine((value) => isAddress(value), "Use a valid Ethereum wallet address."),
    contractorEmail: z.string().trim().email("Use a valid email or leave it blank.").or(z.literal("")),
    projectTitle: z.string().trim().min(3, "Project title is required.").max(80),
    totalAmount: z.coerce.number().int("Use whole token amounts").positive("Total amount must be greater than zero."),
    approvalWindow: z.coerce
      .number()
      .int("Use whole days")
      .min(1, "Approval window needs at least 1 day.")
      .max(365, "Approval window must be 365 days or less."),
    disputeWindow: z.coerce
      .number()
      .int("Use whole days")
      .min(1, "Dispute window needs at least 1 day.")
      .max(365, "Dispute window must be 365 days or less."),
    clientCancellationFee: z.coerce
      .number()
      .int("Use whole token amounts")
      .min(0, "Cancellation fee cannot be negative.")
      .max(1000000000, "Cancellation fee is too large."),
    milestones: z.array(milestoneSchema).min(1, "Add at least one milestone."),
  })
  .superRefine((data, ctx) => {
    const totalMilestones = data.milestones.reduce((sum, item) => sum + item.amount, 0);
    if (totalMilestones !== data.totalAmount) {
      ctx.addIssue({
        code: "custom",
        path: ["milestones"],
        message: "Milestone amounts must add up to the total project amount.",
      });
    }

    if (data.clientCancellationFee > data.totalAmount) {
      ctx.addIssue({
        code: "custom",
        path: ["clientCancellationFee"],
        message: "Cancellation fee cannot be more than the total project amount.",
      });
    }

    if (data.disputeWindow > data.approvalWindow) {
      ctx.addIssue({
        code: "custom",
        path: ["disputeWindow"],
        message: "Dispute window must be shorter than or equal to the approval window.",
      });
    }
  });

const emptyMilestone = { description: "", amount: 0 };
const defaultForm = {
  contractorName: "",
  contractorAddress: "",
  contractorEmail: "",
  projectTitle: "",
  totalAmount: 0,
  approvalWindow: 7,
  disputeWindow: 3,
  clientCancellationFee: 0,
  milestones: [emptyMilestone],
};

export default function CreateAgreementPage() {
  const { authenticated, ready, address, walletClient, publicClient, logout, chainName, chainId, error: walletError, role } = useSafePayWallet();
  const tokenConfig = useTokenConfig();
  const tokenSymbol = tokenConfig.metadata?.symbol ?? "token";
  const [displayCurrency, setDisplayCurrency] = useState<DisplayCurrency>("USD");
  const fxRate = useFxRate(displayCurrency);
  const [form, setForm] = useState(defaultForm);
  const [description, setDescription] = useState("");
  const [draftPreview, setDraftPreview] = useState<AgreementDraft | null>(null);
  const [isDescribing, setIsDescribing] = useState(false);
  const [describeError, setDescribeError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [review, setReview] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [createdAgreementId, setCreatedAgreementId] = useState<number | null>(null);
  const [fundingPending, setFundingPending] = useState(false);
  const [marketplacePrefill, setMarketplacePrefill] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const provider = params.get("provider");
    const title = params.get("title");
    const listingTitle = params.get("listing");
    if (!provider || !title || !listingTitle || !isAddress(provider)) return;

    // Prefilling the draft synchronizes form state with the navigation URL.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm((current) => ({
      ...current,
      contractorName: listingTitle,
      contractorAddress: provider,
      projectTitle: title,
      totalAmount: 0,
      clientCancellationFee: 0,
      milestones: [{ description: `Deliver the service: ${listingTitle}`, amount: 0 }],
    }));
    setMarketplacePrefill(true);
  }, []);

  const totalMilestoneAmount = useMemo(
    () => form.milestones.reduce((sum, item) => sum + (Number(item.amount) || 0), 0),
    [form.milestones],
  );

  const updateField = <K extends keyof typeof form>(field: K, value: (typeof form)[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: "" }));
  };

  const updateMilestone = (index: number, field: "description" | "amount", value: string | number) => {
    setForm((current) => {
      const milestones = [...current.milestones];
      milestones[index] = { ...milestones[index], [field]: field === "amount" ? Number(value) : value };
      return { ...current, milestones };
    });

    setErrors((current) => ({ ...current, [`milestone-${index}-${field}`]: "" }));
  };

  const addMilestone = () => {
    setForm((current) => ({ ...current, milestones: [...current.milestones, { ...emptyMilestone }] }));
  };

  const removeMilestone = (index: number) => {
    if (form.milestones.length === 1) {
      return;
    }

    setForm((current) => ({
      ...current,
      milestones: current.milestones.filter((_, milestoneIndex) => milestoneIndex !== index),
    }));
  };

  const handleDescribe = async () => {
    setIsDescribing(true);
    setDescribeError(null);
    setDraftPreview(null);
    try {
      const response = await fetch("/api/describe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: description }),
      });
      const result: unknown = await response.json();
      if (!response.ok) {
        const message = z.object({ error: z.string() }).safeParse(result);
        throw new Error(message.success ? message.data.error : "The description could not be processed.");
      }

      const parsed = z.object({ draft: agreementDraftSchema }).safeParse(result);
      if (!parsed.success) throw new Error("The assistant returned an invalid draft. Please try again.");
      setDraftPreview(parsed.data.draft);
    } catch (error) {
      setDescribeError(error instanceof Error ? error.message : "The description could not be processed.");
    } finally {
      setIsDescribing(false);
    }
  };

  const applyDraft = () => {
    if (!draftPreview) return;
    setForm((current) => ({
      ...current,
      contractorName: draftPreview.recipient,
      totalAmount: draftPreview.amount,
      milestones: draftPreview.milestones.map((milestone) => ({ ...milestone })),
    }));
    setErrors({});
    setReview(false);
    setDraftPreview(null);
  };

  const handleReview = () => {
    setSubmitError(null);
    if (fxRate.status !== "ready") {
      setSubmitError(
        fxRate.status === "error"
          ? `Cannot show the requested currency conversion: ${fxRate.error} Select USD or retry after a rate is available.`
          : "Wait for the display FX rate before reviewing the agreement.",
      );
      return;
    }
    const parsed = formSchema.safeParse(form);
    if (!parsed.success) {
      const nextErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path[0];
        if (path !== undefined) {
          nextErrors[String(path)] = issue.message;
        }
      }
      setErrors(nextErrors);
      return;
    }

    setReview(true);
    setErrors({});
  };

  const executeAgreementFlow = async () => {
    if (!authenticated) {
      throw new Error("Sign in before creating a SafePay agreement.");
    }

    if (!address || !walletClient) {
      throw new Error("Your wallet is not ready yet. Please try again.");
    }

    const contractAddress = process.env.NEXT_PUBLIC_SAFE_PAY_ESCROW_ADDRESS as Address | undefined;
    const tokenAddress = getConfiguredTokenAddress();
    const resolverAddress = process.env.NEXT_PUBLIC_SAFE_PAY_RESOLVER_ADDRESS as Address | undefined;

    if (!contractAddress || !isAddress(contractAddress) || contractAddress === "0x0000000000000000000000000000000000000000") {
      throw new Error("Add the SafePay contract address to your environment before creating an agreement.");
    }

    if (!resolverAddress || !isAddress(resolverAddress) || resolverAddress === "0x0000000000000000000000000000000000000000") {
      throw new Error("Set a resolver wallet address that is different from yours and the contractor's.");
    }

    const parsed = formSchema.safeParse(form);
    if (!parsed.success) {
      throw new Error("Please correct the agreement details and try again.");
    }

    if (
      resolverAddress.toLowerCase() === address.toLowerCase() ||
      resolverAddress.toLowerCase() === parsed.data.contractorAddress.toLowerCase()
    ) {
      throw new Error("The resolver must be a different wallet from both agreement participants.");
    }

    const chainId = await publicClient.getChainId();
    if (chainId !== 10143) {
      throw new Error("The configured RPC is not connected to Monad testnet.");
    }
    const tokenMetadata = await readTokenMetadata(publicClient);

    const isSupportedToken = await publicClient.readContract({
      address: contractAddress,
      abi: safePayEscrowAbi,
      functionName: "supportedTokens",
      args: [tokenAddress],
    });
    if (!isSupportedToken) throw new Error("This payment token is not enabled by the deployed SafePay contract.");

    const milestones = parsed.data.milestones.map((milestone, index) => ({
      amount: parseTokenAmount(String(milestone.amount), tokenMetadata.decimals),
      descriptionHash: keccak256(toBytes(milestone.description)),
      descriptionURI: `https://safepay.app/projects/${encodeURIComponent(parsed.data.projectTitle)}/${index + 1}`,
    }));

    const totalAmount = parseTokenAmount(String(parsed.data.totalAmount), tokenMetadata.decimals);
    const cancellationFee = parseTokenAmount(
      String(parsed.data.clientCancellationFee),
      tokenMetadata.decimals,
    );
    const approvalWindow = BigInt(parsed.data.approvalWindow * 24 * 60 * 60);
    const disputeWindow = BigInt(parsed.data.disputeWindow * 24 * 60 * 60);

    const balance = await publicClient.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address],
    });
    if (balance < totalAmount) {
      throw new Error(
        `Your ${tokenMetadata.symbol} balance is below the required ${parsed.data.totalAmount.toLocaleString("en-US")} total.`,
      );
    }

    let agreementId = fundingPending ? createdAgreementId : null;

    if (agreementId === null) {
      const allowance = await publicClient.readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address, contractAddress],
      });

      if (allowance < totalAmount) {
        const approvalHash = await walletClient.writeContract({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: "approve",
          args: [contractAddress, totalAmount],
        });
        const approvalReceipt = await publicClient.waitForTransactionReceipt({ hash: approvalHash });
        if (approvalReceipt.status !== "success") throw new Error("Token approval failed. No agreement was created.");
      }

      const createHash = await walletClient.writeContract({
        address: contractAddress,
        abi: safePayEscrowAbi,
        functionName: "createAgreement",
        args: [
          parsed.data.contractorAddress as Address,
          tokenAddress,
          resolverAddress,
          totalAmount,
          approvalWindow,
          disputeWindow,
          cancellationFee,
          milestones,
        ],
      });

      const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createHash });
      if (createReceipt.status !== "success") throw new Error("Agreement creation failed.");
      const [createdEvent] = parseEventLogs({
        abi: safePayEscrowAbi,
        logs: createReceipt.logs,
        eventName: "AgreementCreated",
        strict: true,
      });
      if (!createdEvent) throw new Error(`Agreement was created (transaction ${createHash}), but its id could not be read from the receipt.`);
      agreementId = Number(createdEvent.args.agreementId);
      if (!Number.isSafeInteger(agreementId)) throw new Error("The created agreement id is outside the supported range.");
      setCreatedAgreementId(agreementId);
      setFundingPending(true);
    }

    if (agreementId === null) throw new Error("The agreement draft could not be recovered. Please contact support before retrying.");

    const existingAgreement = await publicClient.readContract({
      address: contractAddress,
      abi: safePayEscrowAbi,
      functionName: "getAgreement",
      args: [BigInt(agreementId)],
    });
    if (Number(existingAgreement.status) !== 1) {
      const fundHash = await walletClient.writeContract({
        address: contractAddress,
        abi: safePayEscrowAbi,
        functionName: "fundAgreement",
        args: [BigInt(agreementId)],
      });
      const fundReceipt = await publicClient.waitForTransactionReceipt({ hash: fundHash });
      if (fundReceipt.status !== "success") throw new Error(`Agreement #${agreementId} was created, but funding failed. Open the draft to retry funding.`);
    }

    setFundingPending(false);

    return agreementId;
  };

  const handleSubmit = async () => {
    if (!review) {
      handleReview();
      return;
    }

    if (fundingPending && createdAgreementId !== null) {
      setSubmitError(`Agreement #${createdAgreementId} already exists as an unfunded draft. Open it to retry funding; this form will not create another agreement.`);
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    setSuccessMessage(null);

    try {
      const agreementId = await executeAgreementFlow();
      setSuccessMessage(`Agreement #${agreementId} was created in the connected contract.`);
      setReview(false);
      setForm(defaultForm);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "The agreement could not be created.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!ready) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 px-8 py-6 text-slate-50">
          <span className="text-lg font-medium">Loading your SafePay account…</span>
        </div>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 py-10">
        <div className="w-full max-w-lg rounded-3xl border border-slate-800 bg-slate-900 p-8 shadow-2xl shadow-violet-950/20">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-violet-400">SafePay</p>
          <h1 className="mt-4 text-3xl font-semibold text-white">Draft a project agreement</h1>
          <p className="mt-4 text-slate-300">
            Sign in with email to open the agreement prototype. SafePay contracts are
            not deployed at the configured Monad Testnet addresses; do not send funds.
          </p>

          <RoleSignInLink
            className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-violet-600 px-4 py-3 text-base font-semibold text-white transition hover:bg-violet-500"
          >
            Choose a wallet role and sign in
          </RoleSignInLink>
          <div className="mt-6">
            <CrossNetworkPreview />
          </div>
        </div>
      </main>
    );
  }

  if (role !== "client") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 py-10 text-slate-100">
        <section className="max-w-lg rounded-3xl border border-slate-800 bg-slate-900 p-8">
          <h1 className="text-2xl font-semibold">Client wallet required</h1>
          <p className="mt-3 text-slate-300">Agreement creation uses the Hire role and Privy. Log out before changing your role.</p>
          <button type="button" onClick={() => void logout()} className="mt-5 rounded-xl bg-violet-600 px-4 py-3 font-semibold">Log out and choose Hire</button>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-10 text-slate-50">
      <div className="mx-auto w-full min-w-0 max-w-5xl">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-violet-400">SafePay</p>
            <h1 className="mt-2 text-3xl font-semibold">Create a project agreement</h1>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-slate-500"
            >
              Back home
            </Link>
            <button
              type="button"
              onClick={() => void logout()}
              className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-slate-500"
            >
              Log out
            </button>
          </div>
        </div>

        <div className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
          Prototype only: the configured SafePayEscrow and token have no code on Monad
          Testnet. The current agreement flow cannot hold or release funds.
        </div>

        <div className="mb-8">
          <CrossNetworkPreview />
        </div>

        <div className="grid min-w-0 gap-8 lg:grid-cols-[1.4fr_0.8fr]">
          <section className="min-w-0 rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-2xl shadow-violet-950/10">
            <div className="mb-6 flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-slate-700 bg-slate-950/70 p-4">
              <div>
                <p className="font-medium text-white">Display currency</p>
                <p className="mt-1 text-xs text-slate-400">Approximate price conversion only. Settlement stays in the configured stablecoin.</p>
              </div>
              <CurrencySelector value={displayCurrency} onChange={setDisplayCurrency} />
              <div className="w-full">
                <FxRateNotice state={fxRate} currency={displayCurrency} />
              </div>
            </div>
            {marketplacePrefill ? (
              <div className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
                Marketplace listing prefilled this draft. Its USD starting price is indicative only. Set the exact stablecoin-denominated total and milestone amounts; display-currency conversion does not change the on-chain values. Review and confirm before creating anything.
              </div>
            ) : null}
            <section className="mb-7 border-l-2 border-teal-500 bg-slate-950/70 p-4 sm:p-5">
              <label htmlFor="agreement-description" className="block text-sm font-semibold text-white">Describe in words</label>
              <p className="mt-1 text-sm text-slate-400">Describe who you are paying, the total, and when each payment should be released.</p>
              <textarea
                id="agreement-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={2000}
                rows={3}
                placeholder="Pay Raj 1 lakh, 30k after material, 40k after work, 30k after final approval"
                className="mt-3 w-full border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none transition focus:border-teal-500"
              />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs text-slate-400">AI creates an editable draft only. It cannot create an agreement or move money.</span>
                <button
                  type="button"
                  onClick={() => void handleDescribe()}
                  disabled={isDescribing || !description.trim()}
                  className="bg-teal-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isDescribing ? "Preparing draft…" : "Create draft"}
                </button>
              </div>
              {describeError ? <p role="alert" className="mt-3 text-sm text-red-300">{describeError}</p> : null}
              {draftPreview ? (
                <div className="mt-4 border border-teal-800 bg-teal-950/30 p-4">
                  <p className="font-medium text-white">Check this draft before applying it</p>
                  <p className="mt-2 text-sm text-slate-300">Recipient: {draftPreview.recipient} · Total: {tokenSymbol} {draftPreview.amount.toLocaleString("en-US")}</p>
                  <ol className="mt-3 space-y-2 text-sm text-slate-300">
                    {draftPreview.milestones.map((milestone, index) => (
                      <li key={`${milestone.description}-${index}`} className="flex justify-between gap-4">
                        <span>{index + 1}. {milestone.description}</span>
                        <span className="shrink-0 text-white">{tokenSymbol} {milestone.amount.toLocaleString("en-US")}</span>
                      </li>
                    ))}
                  </ol>
                  <button type="button" onClick={applyDraft} className="mt-4 bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-600">
                    Apply draft to form
                  </button>
                </div>
              ) : null}
            </section>

            <div className="grid gap-5 md:grid-cols-2">
              <label className="space-y-2 md:col-span-2">
                <span className="text-sm font-medium text-slate-200">Contractor name</span>
                <input
                  value={form.contractorName}
                  onChange={(event) => updateField("contractorName", event.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-base text-white outline-none transition focus:border-violet-500"
                  placeholder="Raj"
                />
              </label>

              <label className="space-y-2 md:col-span-2">
                <span className="text-sm font-medium text-slate-200">Project title</span>
                <input
                  value={form.projectTitle}
                  onChange={(event) => updateField("projectTitle", event.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-base text-white outline-none transition focus:border-violet-500"
                  placeholder="Website redesign for the landing page"
                />
                {errors.projectTitle ? <span className="text-sm text-red-300">{errors.projectTitle}</span> : null}
              </label>

              <label className="space-y-2 md:col-span-2">
                <span className="text-sm font-medium text-slate-200">Contractor wallet address</span>
                <input
                  value={form.contractorAddress}
                  onChange={(event) => updateField("contractorAddress", event.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-base text-white outline-none transition focus:border-violet-500"
                  placeholder="0x..."
                />
                {errors.contractorAddress ? <span className="text-sm text-red-300">{errors.contractorAddress}</span> : null}
              </label>

              <label className="space-y-2 md:col-span-2">
                <span className="text-sm font-medium text-slate-200">Contractor email (optional)</span>
                <input
                  type="email"
                  value={form.contractorEmail}
                  onChange={(event) => updateField("contractorEmail", event.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-base text-white outline-none transition focus:border-violet-500"
                  placeholder="contractor@example.com"
                />
                {errors.contractorEmail ? <span className="text-sm text-red-300">{errors.contractorEmail}</span> : null}
              </label>

              <label className="space-y-2">
                <span className="text-sm font-medium text-slate-200">Total amount ({tokenSymbol})</span>
                <input
                  type="number"
                  min="1"
                  value={form.totalAmount || ""}
                  onChange={(event) => updateField("totalAmount", Number(event.target.value))}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-base text-white outline-none transition focus:border-violet-500"
                  placeholder="250000"
                />
                {errors.totalAmount ? <span className="text-sm text-red-300">{errors.totalAmount}</span> : null}
              </label>

              <label className="space-y-2">
                <span className="text-sm font-medium text-slate-200">Client cancellation fee ({tokenSymbol})</span>
                <input
                  type="number"
                  min="0"
                  value={form.clientCancellationFee || ""}
                  onChange={(event) => updateField("clientCancellationFee", Number(event.target.value))}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-base text-white outline-none transition focus:border-violet-500"
                  placeholder="5000"
                />
                {errors.clientCancellationFee ? (
                  <span className="text-sm text-red-300">{errors.clientCancellationFee}</span>
                ) : null}
              </label>

              <label className="space-y-2">
                <span className="text-sm font-medium text-slate-200">Approval window (days)</span>
                <input
                  type="number"
                  min="1"
                  max="365"
                  value={form.approvalWindow}
                  onChange={(event) => updateField("approvalWindow", Number(event.target.value))}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-base text-white outline-none transition focus:border-violet-500"
                />
                {errors.approvalWindow ? <span className="text-sm text-red-300">{errors.approvalWindow}</span> : null}
              </label>

              <label className="space-y-2">
                <span className="text-sm font-medium text-slate-200">Dispute window (days)</span>
                <input
                  type="number"
                  min="1"
                  max="365"
                  value={form.disputeWindow}
                  onChange={(event) => updateField("disputeWindow", Number(event.target.value))}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-base text-white outline-none transition focus:border-violet-500"
                />
                {errors.disputeWindow ? <span className="text-sm text-red-300">{errors.disputeWindow}</span> : null}
              </label>
            </div>

            <div className="mt-8 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">Milestones</h2>
                <button
                  type="button"
                  onClick={addMilestone}
                  className="rounded-xl border border-violet-500/50 bg-violet-500/10 px-3 py-2 text-sm font-medium text-violet-200 transition hover:bg-violet-500/20"
                >
                  Add milestone
                </button>
              </div>

              {form.milestones.map((milestone, index) => (
                <div key={index} className="rounded-2xl border border-slate-700 bg-slate-950/60 p-4">
                  <div className="mb-3 flex items-center justify-between gap-4">
                    <p className="font-medium text-slate-100">Milestone {index + 1}</p>
                    {form.milestones.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => removeMilestone(index)}
                        className="text-sm text-red-300 transition hover:text-red-200"
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>

                  <div className="grid gap-4 md:grid-cols-[1.5fr_0.7fr]">
                    <label className="space-y-2">
                      <span className="text-sm text-slate-200">Description</span>
                      <input
                        value={milestone.description}
                        onChange={(event) => updateMilestone(index, "description", event.target.value)}
                        className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-base text-white outline-none transition focus:border-violet-500"
                        placeholder="Design finalised and approved"
                      />
                      {errors[`milestone-${index}-description`] ? (
                        <span className="text-sm text-red-300">{errors[`milestone-${index}-description`]}</span>
                      ) : null}
                    </label>

                    <label className="space-y-2">
                      <span className="text-sm text-slate-200">Amount</span>
                      <input
                        type="number"
                        min="1"
                        value={milestone.amount || ""}
                        onChange={(event) => updateMilestone(index, "amount", Number(event.target.value))}
                        className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-base text-white outline-none transition focus:border-violet-500"
                        placeholder="75000"
                      />
                      {errors[`milestone-${index}-amount`] ? (
                        <span className="text-sm text-red-300">{errors[`milestone-${index}-amount`]}</span>
                      ) : null}
                    </label>
                  </div>
                </div>
              ))}

              {errors.milestones ? <p className="text-sm text-red-300">{errors.milestones}</p> : null}

              <div className="rounded-xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-sm text-slate-300">
                Milestone total: <span className="font-semibold text-white">{tokenSymbol} {totalMilestoneAmount.toLocaleString("en-US")}</span>
                {fxRate.status === "ready" ? (
                  <p className="mt-2 text-xs text-slate-400">
                    Approx. {formatDisplayCurrency(
                      convertUsdToDisplayCurrency(totalMilestoneAmount, fxRate.data.rate),
                      displayCurrency,
                    )} = {totalMilestoneAmount.toLocaleString("en-US")} {tokenSymbol} (assuming the stablecoin is USD-pegged).
                  </p>
                ) : null}
              </div>
            </div>
          </section>

          <aside className="min-w-0 rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-2xl shadow-violet-950/10">
            {review ? (
              <div className="space-y-5">
                <div>
                  <p className="text-sm font-medium uppercase tracking-[0.2em] text-violet-400">Review</p>
                  <h2 className="mt-3 text-2xl font-semibold text-white">Before you confirm</h2>
                </div>

                <div className="space-y-3 rounded-2xl border border-slate-700 bg-slate-950/70 p-4 text-sm text-slate-300">
                  <p className="font-medium text-white">Contract rules in source (not active at the configured addresses)</p>
                  <p>If deployed, the contract holds funded tokens and allocates milestone amounts according to its status and role checks.</p>
                  <p>For an open dispute, the agreement&apos;s resolver can choose release, refund, or split under the contract rules.</p>
                  <p>After an approval deadline, anyone can trigger the contract&apos;s fixed contractor payout. This does not verify whether work is complete.</p>
                </div>

                <div className="rounded-2xl border border-slate-700 bg-slate-950/70 p-4 text-sm text-slate-300">
                  <p className="font-medium text-white">Summary</p>
                  <ul className="mt-3 space-y-2">
                    <li>Project: {form.projectTitle}</li>
                    <li className="break-all">Contractor: {form.contractorName || form.contractorAddress}</li>
                    <li className="break-all">Wallet: {form.contractorAddress}</li>
                    <li>Total: {tokenSymbol} {form.totalAmount.toLocaleString("en-US")}</li>
                    {fxRate.status === "ready" ? (
                      <li>
                        Approx. {formatDisplayCurrency(
                          convertUsdToDisplayCurrency(form.totalAmount, fxRate.data.rate),
                          displayCurrency,
                        )} = {form.totalAmount.toLocaleString("en-US")} {tokenSymbol} (assuming the stablecoin is USD-pegged).
                      </li>
                    ) : null}
                    {fxRate.status === "ready" ? form.milestones.map((milestone, index) => (
                      <li key={`milestone-conversion-${index}`}>
                        Milestone {index + 1}: approx. {formatDisplayCurrency(
                          convertUsdToDisplayCurrency(milestone.amount, fxRate.data.rate),
                          displayCurrency,
                        )} = {milestone.amount.toLocaleString("en-US")} {tokenSymbol} (USD-pegged assumption)
                      </li>
                    )) : null}
                    <li>Milestones: {form.milestones.length}</li>
                    <li>Approval window: {form.approvalWindow} days</li>
                    <li>Dispute window: {form.disputeWindow} days</li>
                    <li>Cancellation fee: {tokenSymbol} {form.clientCancellationFee.toLocaleString("en-US")}</li>
                  </ul>
                  <FxRateNotice state={fxRate} currency={displayCurrency} />
                </div>

                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={isSubmitting || fxRate.status !== "ready"}
                  className="inline-flex w-full items-center justify-center rounded-xl bg-violet-600 px-4 py-3 text-base font-semibold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? "Creating agreement…" : "Confirm and create"}
                </button>
                {createdAgreementId !== null && fundingPending ? (
                  <Link href={`/agreement/${createdAgreementId}`} className="block text-center text-sm font-medium text-amber-300 underline underline-offset-4">
                    Open draft #{createdAgreementId} to finish funding
                  </Link>
                ) : null}
              </div>
            ) : (
              <div className="space-y-5">
                <div>
                  <p className="text-sm font-medium uppercase tracking-[0.2em] text-violet-400">Ready</p>
                  <h2 className="mt-3 text-2xl font-semibold text-white">Quick check</h2>
                </div>

                <div className="rounded-2xl border border-slate-700 bg-slate-950/70 p-4 text-sm text-slate-300">
                  <p>Project total: <span className="font-semibold text-white">{tokenSymbol} {form.totalAmount.toLocaleString("en-US")}</span></p>
                  <p className="mt-2">Milestone total: <span className="font-semibold text-white">{tokenSymbol} {totalMilestoneAmount.toLocaleString("en-US")}</span></p>
                </div>

                <button
                  type="button"
                  onClick={handleReview}
                  className="inline-flex w-full items-center justify-center rounded-xl bg-violet-600 px-4 py-3 text-base font-semibold text-white transition hover:bg-violet-500"
                >
                  Review draft details
                </button>
              </div>
            )}

            {submitError ? (
              <div className="mt-5 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {submitError}
              </div>
            ) : null}

            {successMessage ? (
              <div className="mt-5 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                {successMessage}
                {createdAgreementId !== null ? (
                  <Link href={`/agreement/${createdAgreementId}`} className="mt-2 block font-medium underline underline-offset-4">
                    View agreement #{createdAgreementId}
                  </Link>
                ) : null}
              </div>
            ) : null}

            <div className="mt-5 rounded-2xl border border-slate-700 bg-slate-950/60 p-4 text-sm text-slate-300">
              <p className="font-medium text-white">Connected account</p>
              <p className="mt-2 break-all">{address ?? "Wallet initializing…"}</p>
              <p className="mt-1 text-sm text-slate-400">{chainName} {chainId ? `(chain ${chainId})` : "(switching…)"}</p>
              {walletError ? <p role="alert" className="mt-2 text-sm text-red-300">{walletError}</p> : null}
            </div>
            {role === "client" ? <WalletProtectionPanel /> : null}
          </aside>
        </div>
      </div>
    </main>
  );
}
