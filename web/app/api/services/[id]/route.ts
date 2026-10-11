import { NextResponse } from "next/server";

import { currentIsoTimestamp, getServiceListing, listingDatabase } from "@/lib/services-db";
import { verifyAndConsumeListingChallenge } from "@/lib/services-auth";
import {
  listingMutationSchema,
  serviceListingEditSchema,
} from "@/lib/services-schema";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  const listing = getServiceListing(id);
  if (!listing) return NextResponse.json({ error: "Listing not found." }, { status: 404 });
  return NextResponse.json({ listing });
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const { id } = await params;
  const rawBody: unknown = await request.json().catch(() => null);
  const mutation = listingMutationSchema.safeParse(rawBody);
  if (!mutation.success || mutation.data.action !== "edit" || mutation.data.listingId !== id) {
    return NextResponse.json({ error: "Invalid listing update." }, { status: 400 });
  }

  const existing = getServiceListing(id);
  if (!existing) return NextResponse.json({ error: "Listing not found." }, { status: 404 });
  if (existing.isDemo || existing.providerWalletAddress !== mutation.data.address) {
    return NextResponse.json({ error: "Only the listing owner can edit it." }, { status: 403 });
  }

  const listing = serviceListingEditSchema.safeParse(mutation.data.listing);
  if (!listing.success) {
    return NextResponse.json(
      { error: "Listing details are invalid.", details: listing.error.flatten() },
      { status: 400 },
    );
  }

  const authorized = await verifyAndConsumeListingChallenge({
    nonce: mutation.data.nonce,
    address: mutation.data.address,
    action: "edit",
    listingId: id,
    payload: { id, listing: listing.data },
    signature: mutation.data.signature as `0x${string}`,
  });
  if (!authorized) {
    return NextResponse.json(
      { error: "Wallet signature is invalid, expired, or already used." },
      { status: 401 },
    );
  }

  const timestamp = currentIsoTimestamp();
  listingDatabase
    .prepare(
      `UPDATE service_listings
       SET title = ?, description = ?, category = ?, country = ?,
           starting_price_usd = ?, delivery_days = ?, updated_at = ?
       WHERE id = ? AND provider_wallet_address = ? AND is_demo = 0`,
    )
    .run(
      listing.data.title,
      listing.data.description,
      listing.data.category,
      listing.data.country,
      listing.data.startingPriceUsd,
      listing.data.deliveryDays,
      timestamp,
      id,
      mutation.data.address,
    );

  return NextResponse.json({ id });
}
