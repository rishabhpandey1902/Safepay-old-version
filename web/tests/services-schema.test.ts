import assert from "node:assert/strict";
import test from "node:test";

import { serviceListingSchema } from "../lib/services-schema";

test("validates and normalizes marketplace listing input", () => {
  const parsed = serviceListingSchema.parse({
    title: "Responsive landing page build",
    description: "A responsive and accessible product landing page.",
    category: "Development",
    country: "Canada",
    startingPriceUsd: 125.5,
    deliveryDays: 7,
    providerWalletAddress: "0x1000000000000000000000000000000000000002",
  });

  assert.equal(parsed.startingPriceUsd, 125.5);
  assert.equal(
    parsed.providerWalletAddress,
    "0x1000000000000000000000000000000000000002",
  );
});

test("rejects invalid wallets, categories, and prices beyond cents", () => {
  const base = {
    title: "Responsive landing page build",
    description: "A responsive and accessible product landing page.",
    category: "Development",
    country: "Canada",
    startingPriceUsd: 125.5,
    deliveryDays: 7,
    providerWalletAddress: "0x1000000000000000000000000000000000000002",
  };

  assert.equal(
    serviceListingSchema.safeParse({ ...base, providerWalletAddress: "not a wallet" }).success,
    false,
  );
  assert.equal(
    serviceListingSchema.safeParse({ ...base, category: "Crypto" }).success,
    false,
  );
  assert.equal(
    serviceListingSchema.safeParse({ ...base, startingPriceUsd: 12.345 }).success,
    false,
  );
});
