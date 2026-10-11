import { NextResponse } from "next/server";
import { z } from "zod";

import { createListingId, currentIsoTimestamp, listServiceListings, listingDatabase } from "@/lib/services-db";
import { verifyAndConsumeListingChallenge } from "@/lib/services-auth";
import {
  listingMutationSchema,
  serviceListingSchema,
} from "@/lib/services-schema";

export const runtime = "nodejs";

const filtersSchema = z.object({
  search: z.string().trim().max(100).optional(),
  category: z.string().trim().max(40).optional(),
  country: z.string().trim().max(80).optional(),
  minPrice: z.coerce.number().finite().nonnegative().optional(),
  maxPrice: z.coerce.number().finite().nonnegative().optional(),
});

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const filters = filtersSchema.safeParse({
    search: params.get("search") ?? undefined,
    category: params.get("category") ?? undefined,
    country: params.get("country") ?? undefined,
    minPrice: params.get("minPrice") ?? undefined,
    maxPrice: params.get("maxPrice") ?? undefined,
  });
  if (!filters.success) {
    return NextResponse.json({ error: "Invalid listing filters." }, { status: 400 });
  }
  return NextResponse.json({ listings: listServiceListings(filters.data) });
}

export async function POST(request: Request) {
  const rawBody: unknown = await request.json().catch(() => null);
  const mutation = listingMutationSchema.safeParse(rawBody);
  if (!mutation.success || mutation.data.action !== "create") {
    return NextResponse.json({ error: "Invalid listing submission." }, { status: 400 });
  }

  const listing = serviceListingSchema.safeParse(mutation.data.listing);
  if (!listing.success) {
    return NextResponse.json(
      { error: "Listing details are invalid.", details: listing.error.flatten() },
      { status: 400 },
    );
  }
  if (listing.data.providerWalletAddress !== mutation.data.address) {
    return NextResponse.json(
      { error: "The connected wallet must match the provider wallet address." },
      { status: 403 },
    );
  }

  const authorized = await verifyAndConsumeListingChallenge({
    nonce: mutation.data.nonce,
    address: mutation.data.address,
    action: "create",
    payload: listing.data,
    signature: mutation.data.signature as `0x${string}`,
  });
  if (!authorized) {
    return NextResponse.json(
      { error: "Wallet signature is invalid, expired, or already used." },
      { status: 401 },
    );
  }

  const id = createListingId();
  const timestamp = currentIsoTimestamp();
  listingDatabase
    .prepare(
      `INSERT INTO service_listings (
        id, title, description, category, country, starting_price_usd,
        delivery_days, provider_wallet_address, is_demo, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    )
    .run(
      id,
      listing.data.title,
      listing.data.description,
      listing.data.category,
      listing.data.country,
      listing.data.startingPriceUsd,
      listing.data.deliveryDays,
      listing.data.providerWalletAddress,
      timestamp,
      timestamp,
    );

  return NextResponse.json({ id }, { status: 201 });
}
