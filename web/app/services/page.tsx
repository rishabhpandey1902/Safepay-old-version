"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { serviceCategories, type ServiceListing } from "@/lib/services-schema";
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

export default function ServicesPage() {
  const [listings, setListings] = useState<ServiceListing[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [country, setCountry] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [displayCurrency, setDisplayCurrency] = useState<DisplayCurrency>("USD");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fxRate = useFxRate(displayCurrency);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (category) params.set("category", category);
    if (country.trim()) params.set("country", country.trim());
    if (minPrice) params.set("minPrice", minPrice);
    if (maxPrice) params.set("maxPrice", maxPrice);
    const query = params.toString();

    void fetch(`/api/services${query ? `?${query}` : ""}`, { signal: controller.signal })
      .then(async (response) => {
        const result: unknown = await response.json();
        if (!response.ok) {
          const message = result as { error?: string };
          throw new Error(message.error ?? "Unable to load services.");
        }
        const parsed = result as { listings: ServiceListing[] };
        setListings(parsed.listings);
        setError(null);
      })
      .catch((loadError: unknown) => {
        if (loadError instanceof Error && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : "Unable to load services.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [search, category, country, minPrice, maxPrice]);

  return (
    <main className="min-h-screen bg-slate-950 px-5 py-10 text-slate-100 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-300">SafePay Marketplace</p>
            <h1 className="mt-2 text-3xl font-semibold">Freelance services</h1>
            <p className="mt-2 text-sm text-slate-400">Browse offers. Hiring prepares a SafePay draft; nothing is created or funded until you review and confirm.</p>
          </div>
          <Link href="/services/new" className="rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold hover:bg-violet-500">Create a listing</Link>
        </header>

        <section className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <div>
            <p className="text-sm text-slate-200">Price display</p>
            <p className="mt-1 text-xs text-slate-400">Service prices are listed in USD; converted prices are approximate.</p>
          </div>
          <CurrencySelector value={displayCurrency} onChange={setDisplayCurrency} />
          <div className="w-full">
            <FxRateNotice state={fxRate} currency={displayCurrency} />
          </div>
        </section>

        <section className="mb-7 grid gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 md:grid-cols-5">
          <label className="text-sm text-slate-300 md:col-span-2">Search
            <input value={search} onChange={(event) => setSearch(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white" placeholder="Design, development…" />
          </label>
          <label className="text-sm text-slate-300">Category
            <select value={category} onChange={(event) => setCategory(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white">
              <option value="">All categories</option>
              {serviceCategories.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label className="text-sm text-slate-300">Country
            <input value={country} onChange={(event) => setCountry(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white" placeholder="Any country" />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-sm text-slate-300">Min price (USD)
              <input type="number" min="0" value={minPrice} onChange={(event) => setMinPrice(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white" />
            </label>
            <label className="text-sm text-slate-300">Max price (USD)
              <input type="number" min="0" value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white" />
            </label>
          </div>
        </section>

        {error ? <p role="alert" className="mb-5 rounded-xl border border-red-500/40 bg-red-950/50 p-4 text-sm text-red-200">{error}</p> : null}
        {loading ? <p className="py-10 text-slate-300">Loading services…</p> : listings.length ? (
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {listings.map((listing) => (
              <Link key={listing.id} href={`/services/${listing.id}`} className="rounded-2xl border border-slate-800 bg-slate-900 p-5 transition hover:border-violet-500/60">
                <div className="flex items-start justify-between gap-3">
                  <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-xs text-violet-200">{listing.category}</span>
                  {listing.isDemo ? <span className="rounded-full bg-amber-500/10 px-2 py-1 text-xs font-semibold text-amber-200">DEMO DATA</span> : null}
                </div>
                <h2 className="mt-4 text-lg font-semibold text-white">{listing.title}</h2>
                <p className="mt-2 line-clamp-3 text-sm text-slate-300">{listing.description}</p>
                <div className="mt-5 flex flex-wrap justify-between gap-2 text-sm text-slate-400">
                  <span>{listing.country} · {listing.deliveryDays} days</span>
                  <span className="font-semibold text-emerald-200">
                    {fxRate.status === "ready"
                      ? `Approx. ${formatDisplayCurrency(
                          convertUsdToDisplayCurrency(listing.startingPriceUsd, fxRate.data.rate),
                          displayCurrency,
                        )} (${formatDisplayCurrency(listing.startingPriceUsd, "USD")} USD)`
                      : `Starting at ${formatDisplayCurrency(listing.startingPriceUsd, "USD")} USD`}
                  </span>
                </div>
              </Link>
            ))}
          </section>
        ) : <p className="rounded-2xl border border-dashed border-slate-700 p-10 text-center text-slate-300">No services match those filters.</p>}
      </div>
    </main>
  );
}
