"use client";

import Link from "next/link";
import { useState } from "react";
import { z } from "zod";

import { useSafePayWallet } from "@/lib/wallet/useSafePayWallet";
import { RoleSignInLink } from "@/lib/wallet/role-sign-in-link";
import {
  serviceCategories,
  serviceListingSchema,
  type ServiceListingInput,
} from "@/lib/services-schema";

export default function NewServicePage() {
  const { authenticated, address, walletClient, provider, chainName, chainId } = useSafePayWallet();
  const [form, setForm] = useState<{
    title: string;
    description: string;
    category: ServiceListingInput["category"];
    country: string;
    startingPriceUsd: string;
    deliveryDays: string;
    providerWalletAddress: string;
  }>({
    title: "",
    description: "",
    category: serviceCategories[0],
    country: "",
    startingPriceUsd: "",
    deliveryDays: "7",
    providerWalletAddress: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const createListing = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (!authenticated || !address || !walletClient || provider !== "dynamic") {
      setError("Choose Offer services and connect the listing owner through Dynamic.");
      return;
    }
    if (address.toLowerCase() !== form.providerWalletAddress.trim().toLowerCase()) {
      setError("Provider wallet address must match the connected wallet.");
      return;
    }

    const input = serviceListingSchema.safeParse({
      ...form,
      startingPriceUsd: Number(form.startingPriceUsd),
      deliveryDays: Number(form.deliveryDays),
    });
    if (!input.success) {
      setError(input.error.issues.map((issue) => issue.message).join(" "));
      return;
    }

    setBusy(true);
    try {
      const challengeResponse = await fetch("/api/services/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          address,
          listing: input.data,
        }),
      });
      const challengeBody: unknown = await challengeResponse.json();
      if (!challengeResponse.ok) {
        const body = challengeBody as { error?: string };
        throw new Error(body.error ?? "Could not authorize listing creation.");
      }
      const challenge = z.object({ nonce: z.string().uuid(), message: z.string() }).parse(challengeBody);
      const signature = await walletClient.signMessage({
        account: address,
        message: challenge.message,
      });
      const response = await fetch("/api/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          nonce: challenge.nonce,
          address,
          signature,
          listing: input.data,
        }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const result = body as { error?: string };
        throw new Error(result.error ?? "Could not save the service listing.");
      }
      const result = z.object({ id: z.string() }).parse(body);
      setCreatedId(result.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the service listing.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 px-5 py-10 text-slate-100 sm:px-8">
      <section className="mx-auto max-w-3xl rounded-3xl border border-slate-800 bg-slate-900 p-6 sm:p-8">
        <Link href="/services" className="text-sm text-violet-300 hover:text-violet-200">← Services</Link>
        <h1 className="mt-5 text-3xl font-semibold">Create a service listing</h1>
        <p className="mt-2 text-sm text-slate-400">Creating a listing only stores marketplace information. It does not create an escrow agreement.</p>
        {!authenticated ? <RoleSignInLink className="mt-6 inline-block rounded-xl bg-violet-600 px-4 py-3 font-semibold">Choose Offer services / Dynamic and sign in</RoleSignInLink> : null}
        {authenticated && provider !== "dynamic" ? <p role="alert" className="mt-5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">Listings require the Offer services role and a Dynamic wallet. Log out before changing roles.</p> : null}
        {authenticated ? <p className="mt-4 break-all text-xs text-slate-400">{address} · {provider} · {chainName}{chainId ? ` (chain ${chainId})` : ""}</p> : null}
        {createdId ? <p role="status" className="mt-5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-200">Listing created. <Link className="underline" href={`/services/${createdId}`}>View your listing</Link></p> : null}
        {error ? <p role="alert" className="mt-5 rounded-xl border border-red-500/40 bg-red-950/50 p-4 text-red-200">{error}</p> : null}
        <form onSubmit={(event) => void createListing(event)} className="mt-6 grid gap-4">
          <label className="text-sm text-slate-300">Title<input required minLength={5} maxLength={100} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white" /></label>
          <label className="text-sm text-slate-300">Description<textarea required minLength={20} maxLength={2000} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={5} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white" /></label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm text-slate-300">Category<select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value as ServiceListingInput["category"] })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white">{serviceCategories.map((category) => <option key={category}>{category}</option>)}</select></label>
            <label className="text-sm text-slate-300">Country<input required maxLength={80} value={form.country} onChange={(event) => setForm({ ...form, country: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white" /></label>
            <label className="text-sm text-slate-300">Starting price (USD)<input required type="number" min="0.01" max="1000000" step="0.01" value={form.startingPriceUsd} onChange={(event) => setForm({ ...form, startingPriceUsd: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white" /></label>
            <label className="text-sm text-slate-300">Delivery days<input required type="number" min="1" max="365" value={form.deliveryDays} onChange={(event) => setForm({ ...form, deliveryDays: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white" /></label>
          </div>
          <label className="text-sm text-slate-300">Provider wallet address<input required value={form.providerWalletAddress} onChange={(event) => setForm({ ...form, providerWalletAddress: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-white" placeholder={address ?? "0x…"} /></label>
          <button disabled={busy || Boolean(createdId)} className="mt-2 rounded-xl bg-violet-600 px-5 py-3 font-semibold text-white hover:bg-violet-500 disabled:opacity-50">{busy ? "Signing and saving…" : "Sign and publish listing"}</button>
        </form>
      </section>
    </main>
  );
}
