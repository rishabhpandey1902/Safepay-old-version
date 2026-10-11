import { NextResponse } from "next/server";

import { getServiceListing } from "@/lib/services-db";
import { issueListingChallenge } from "@/lib/services-auth";
import {
  listingChallengeSchema,
  serviceListingEditSchema,
  serviceListingSchema,
} from "@/lib/services-schema";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const rawBody: unknown = await request.json().catch(() => null);
  const challenge = listingChallengeSchema.safeParse(rawBody);
  if (!challenge.success) {
    return NextResponse.json(
      { error: "Invalid listing authorization request.", details: challenge.error.flatten() },
      { status: 400 },
    );
  }

  if (challenge.data.action === "create") {
    const listing = serviceListingSchema.safeParse(challenge.data.listing);
    if (!listing.success) {
      return NextResponse.json(
        { error: "Listing details are invalid.", details: listing.error.flatten() },
        { status: 400 },
      );
    }
    if (listing.data.providerWalletAddress !== challenge.data.address) {
      return NextResponse.json(
        { error: "The connected wallet must match the provider wallet address." },
        { status: 403 },
      );
    }
    return NextResponse.json(
      issueListingChallenge({
        action: "create",
        address: challenge.data.address,
        payload: listing.data,
      }),
    );
  }

  const existing = getServiceListing(challenge.data.listingId);
  if (!existing) {
    return NextResponse.json({ error: "Listing not found." }, { status: 404 });
  }
  if (existing.isDemo || existing.providerWalletAddress !== challenge.data.address) {
    return NextResponse.json({ error: "Only the listing owner can edit it." }, { status: 403 });
  }
  const listing = serviceListingEditSchema.safeParse(challenge.data.listing);
  if (!listing.success) {
    return NextResponse.json(
      { error: "Listing details are invalid.", details: listing.error.flatten() },
      { status: 400 },
    );
  }

  return NextResponse.json(
    issueListingChallenge({
      action: "edit",
      address: challenge.data.address,
      listingId: challenge.data.listingId,
      payload: { id: challenge.data.listingId, listing: listing.data },
    }),
  );
}
