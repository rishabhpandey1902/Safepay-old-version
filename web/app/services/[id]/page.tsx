"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { z } from "zod";

import { useSafePayWallet } from "@/lib/wallet/useSafePayWallet";
import { RoleSignInLink } from "@/lib/wallet/role-sign-in-link";
import {
  serviceCategories,
  serviceListingEditSchema,
  type ServiceListing,
} from "@/lib/services-schema";

export default function ServiceDetailPage() {
  const params = useParams<{ id: string }>();
  const listingId = String(params?.id ?? "");
  const { authenticated, address, walletClient, provider, chainName, chainId } = useSafePayWallet();
  const [listing, setListing] = useState<ServiceListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<{
    title: string;
    description: string;
    category: ServiceListing["category"];
    country: string;
    startingPriceUsd: string;
    deliveryDays: string;
  }>({
    title: "",
    description: "",
    category: serviceCategories[0],
    country: "",
    startingPriceUsd: "",
    deliveryDays: "7",
  });
  const connectedAddress = address?.toLowerCase();
  const isOwner = Boolean(
    listing && !listing.isDemo && provider === "dynamic" && connectedAddress === listing.providerWalletAddress,
  );

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/services/${encodeURIComponent(listingId)}`, { signal: controller.signal })
      .then(async (response) => {
        const body: unknown = await response.json();
        if (!response.ok) {
          const result = body as { error?: string };
          throw new Error(result.error ?? "Unable to load listing.");
        }
        const result = z.object({
          listing: z.object({
            id: z.string(),
            title: z.string(),
            description: z.string(),
            category: z.enum(serviceCategories),
            country: z.string(),
            startingPriceUsd: z.number(),
            deliveryDays: z.number(),
            providerWalletAddress: z.string(),
            isDemo: z.boolean(),
            createdAt: z.string(),
            updatedAt: z.string(),
          }),
        }).parse(body);
        const nextListing = result.listing as ServiceListing;
        setListing(nextListing);
        setDraft({
          title: nextListing.title,
          description: nextListing.description,
          category: nextListing.category,
          country: nextListing.country,
          startingPriceUsd: String(nextListing.startingPriceUsd),
          deliveryDays: String(nextListing.deliveryDays),
        });
      })
      .catch((cause: unknown) => {
        if (cause instanceof Error && cause.name === "AbortError") return;
        setError(cause instanceof Error ? cause.message : "Unable to load listing.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [listingId]);

  const saveEdit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!address || !walletClient || provider !== "dynamic" || !listing || !isOwner) {
      setError("Choose Offer services and connect the listing owner's Dynamic wallet before editing.");
      return;
    }
    const input = serviceListingEditSchema.safeParse({
      ...draft,
      startingPriceUsd: Number(draft.startingPriceUsd),
      deliveryDays: Number(draft.deliveryDays),
    });
    if (!input.success) {
      setError(input.error.issues.map((issue) => issue.message).join(" "));
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const challengeResponse = await fetch("/api/services/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "edit",
          address,
          listingId,
          listing: input.data,
        }),
      });
      const challengeBody: unknown = await challengeResponse.json();
      if (!challengeResponse.ok) {
        const result = challengeBody as { error?: string };
        throw new Error(result.error ?? "Could not authorize listing update.");
      }
      const challenge = z.object({ nonce: z.string().uuid(), message: z.string() }).parse(challengeBody);
      const signature = await walletClient.signMessage({
        account: address,
        message: challenge.message,
      });
      const response = await fetch(`/api/services/${encodeURIComponent(listingId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "edit",
          listingId,
          nonce: challenge.nonce,
          address,
          signature,
          listing: input.data,
        }),
      });
      const result: unknown = await response.json();
      if (!response.ok) {
        const body = result as { error?: string };
        throw new Error(body.error ?? "Could not update listing.");
      }
      setListing({ ...listing, ...input.data, updatedAt: new Date().toISOString() });
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update listing.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <main className="min-h-screen bg-slate-950 p-10 text-slate-200">Loading service…</main>;
  }
  if (!listing) {
    return <main className="min-h-screen bg-slate-950 p-10 text-red-200">{error ?? "Listing not found."}</main>;
  }

  const createDraftHref = `/create?${new URLSearchParams({
    provider: listing.providerWalletAddress,
    title: listing.title.slice(0, 80),
    listing: listing.title,
  }).toString()}`;

  return (
    <main className="min-h-screen bg-slate-950 px-5 py-10 text-slate-100 sm:px-8">
      <article className="mx-auto max-w-3xl rounded-3xl border border-slate-800 bg-slate-900 p-6 sm:p-9">
        <Link href="/services" className="text-sm text-violet-300 hover:text-violet-200">← All services</Link>
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-violet-500/10 px-3 py-1 text-xs text-violet-200">{listing.category}</span>
          {listing.isDemo ? <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-200">DEMO DATA — NOT A REAL OFFER</span> : null}
        </div>
        <h1 className="mt-4 text-3xl font-semibold">{listing.title}</h1>
        <p className="mt-4 whitespace-pre-wrap text-slate-300">{listing.description}</p>
        <dl className="mt-7 grid gap-4 rounded-2xl border border-slate-800 bg-slate-950 p-5 sm:grid-cols-3">
          <div><dt className="text-xs uppercase text-slate-500">Starting price</dt><dd className="mt-1 font-semibold text-emerald-200">${listing.startingPriceUsd.toLocaleString("en-US")} USD</dd></div>
          <div><dt className="text-xs uppercase text-slate-500">Country</dt><dd className="mt-1">{listing.country}</dd></div>
          <div><dt className="text-xs uppercase text-slate-500">Delivery</dt><dd className="mt-1">{listing.deliveryDays} days</dd></div>
          <div className="sm:col-span-3"><dt className="text-xs uppercase text-slate-500">Provider wallet</dt><dd className="mt-1 break-all font-mono text-sm">{listing.providerWalletAddress}</dd></div>
        </dl>

        {error ? <p role="alert" className="mt-5 rounded-xl border border-red-500/40 bg-red-950/50 p-4 text-red-200">{error}</p> : null}
        {listing.isDemo ? <p className="mt-5 text-sm text-amber-200">This sample listing is not a verified provider or offer. Demo listings cannot be edited.</p> : null}
        <div className="mt-7 flex flex-wrap gap-3">
          <Link href={createDraftHref} className="rounded-xl bg-violet-600 px-5 py-3 font-semibold hover:bg-violet-500">Hire with SafePay</Link>
          {isOwner ? <button type="button" onClick={() => setEditing((current) => !current)} className="rounded-xl border border-slate-700 px-5 py-3 font-semibold hover:border-violet-400">{editing ? "Cancel edit" : "Edit listing"}</button> : null}
          {!authenticated && !listing.isDemo ? <RoleSignInLink className="rounded-xl border border-slate-700 px-5 py-3">Choose Offer services / Dynamic to edit</RoleSignInLink> : null}
        </div>
        {authenticated ? <p className="mt-3 break-all text-xs text-slate-400">{address} · {provider} · {chainName}{chainId ? ` (chain ${chainId})` : ""}</p> : null}
        <p className="mt-4 text-sm text-slate-400">Hiring only prefills a draft. The USD listing price is not automatically converted to a settlement-token amount. Review the token-denominated milestones and confirm them on the SafePay create page.</p>

        {editing && isOwner ? (
          <form onSubmit={(event) => void saveEdit(event)} className="mt-8 grid gap-4 border-t border-slate-800 pt-7">
            <h2 className="text-xl font-semibold">Edit listing</h2>
            <label className="text-sm text-slate-300">Title<input required minLength={5} maxLength={100} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white" /></label>
            <label className="text-sm text-slate-300">Description<textarea required minLength={20} maxLength={2000} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} rows={4} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white" /></label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm text-slate-300">Category<select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value as typeof draft.category })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white">{serviceCategories.map((category) => <option key={category}>{category}</option>)}</select></label>
              <label className="text-sm text-slate-300">Country<input required value={draft.country} onChange={(event) => setDraft({ ...draft, country: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white" /></label>
              <label className="text-sm text-slate-300">Starting price USD<input required type="number" min="0.01" step="0.01" value={draft.startingPriceUsd} onChange={(event) => setDraft({ ...draft, startingPriceUsd: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white" /></label>
              <label className="text-sm text-slate-300">Delivery days<input required type="number" min="1" max="365" value={draft.deliveryDays} onChange={(event) => setDraft({ ...draft, deliveryDays: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white" /></label>
            </div>
            <button disabled={busy} className="rounded-xl bg-violet-600 px-5 py-3 font-semibold disabled:opacity-50">{busy ? "Signing update…" : "Sign and save changes"}</button>
          </form>
        ) : null}
      </article>
    </main>
  );
}
