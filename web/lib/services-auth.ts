import { randomUUID } from "node:crypto";
import { keccak256, stringToHex, verifyMessage } from "viem";

import { listingDatabase } from "./services-db";

export type ListingAction = "create" | "edit";

export function hashListingPayload(value: unknown): string {
  return keccak256(stringToHex(JSON.stringify(value)));
}

export function buildListingSigningMessage(input: {
  action: ListingAction;
  address: string;
  nonce: string;
  listingId?: string;
  payloadHash: string;
  expiresAt: number;
}): string {
  return [
    "SafePay marketplace listing authorization",
    `Action: ${input.action}`,
    `Wallet: ${input.address}`,
    ...(input.listingId ? [`Listing: ${input.listingId}`] : []),
    `Payload: ${input.payloadHash}`,
    `Nonce: ${input.nonce}`,
    `Expires: ${input.expiresAt}`,
  ].join("\n");
}

export function issueListingChallenge(input: {
  action: ListingAction;
  address: string;
  listingId?: string;
  payload: unknown;
}): { nonce: string; message: string } {
  const nonce = randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + 300;
  const payloadHash = hashListingPayload(input.payload);
  const message = buildListingSigningMessage({
    action: input.action,
    address: input.address,
    nonce,
    listingId: input.listingId,
    payloadHash,
    expiresAt,
  });

  listingDatabase
    .prepare(
      `INSERT INTO service_listing_nonces
       (nonce, address, action, listing_id, payload_hash, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(nonce, input.address, input.action, input.listingId ?? null, payloadHash, expiresAt);
  listingDatabase
    .prepare("DELETE FROM service_listing_nonces WHERE expires_at < ?")
    .run(Math.floor(Date.now() / 1000));

  return { nonce, message };
}

export async function verifyAndConsumeListingChallenge(input: {
  nonce: string;
  address: string;
  action: ListingAction;
  listingId?: string;
  payload: unknown;
  signature: `0x${string}`;
}): Promise<boolean> {
  const consume = listingDatabase.transaction((validSignature: boolean) => {
    if (!validSignature) return false;
    const result = listingDatabase
      .prepare("DELETE FROM service_listing_nonces WHERE nonce = ?")
      .run(input.nonce);
    return result.changes === 1;
  });
  const nonceRow = listingDatabase
    .prepare(
      `SELECT address, action, listing_id, payload_hash, expires_at
       FROM service_listing_nonces WHERE nonce = ?`,
    )
    .get(input.nonce) as
    | {
        address: string;
        action: ListingAction;
        listing_id: string | null;
        payload_hash: string;
        expires_at: number;
      }
    | undefined;
  if (
    !nonceRow ||
    nonceRow.address !== input.address ||
    nonceRow.action !== input.action ||
    nonceRow.listing_id !== (input.listingId ?? null) ||
    nonceRow.payload_hash !== hashListingPayload(input.payload) ||
    nonceRow.expires_at < Math.floor(Date.now() / 1000)
  ) {
    return consume(false);
  }

  const message = buildListingSigningMessage({
    action: input.action,
    address: nonceRow.address,
    nonce: input.nonce,
    listingId: nonceRow.listing_id ?? undefined,
    payloadHash: nonceRow.payload_hash,
    expiresAt: nonceRow.expires_at,
  });
  const validSignature = await verifyMessage({
    address: input.address as `0x${string}`,
    message,
    signature: input.signature,
  });
  return consume(validSignature);
}
