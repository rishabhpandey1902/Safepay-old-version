import "server-only";

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import type { ServiceListing, ServiceListingInput } from "./services-schema";

const databasePath = resolve(
  process.env.SAFEPAY_SERVICES_DB_PATH ?? "data/services.sqlite",
);
mkdirSync(dirname(databasePath), { recursive: true });

const database = new Database(databasePath);
database.pragma("journal_mode = WAL");
database.exec(`
  CREATE TABLE IF NOT EXISTS service_listings (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    country TEXT NOT NULL,
    starting_price_usd REAL NOT NULL,
    delivery_days INTEGER NOT NULL,
    provider_wallet_address TEXT NOT NULL,
    is_demo INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS service_listing_nonces (
    nonce TEXT PRIMARY KEY,
    address TEXT NOT NULL,
    action TEXT NOT NULL,
    listing_id TEXT,
    payload_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS service_listing_filters
    ON service_listings(category, country, starting_price_usd);
  CREATE TABLE IF NOT EXISTS fx_rate_cache (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    rates_json TEXT NOT NULL,
    fetched_at INTEGER NOT NULL,
    rate_timestamp TEXT NOT NULL
  );
`);

type DatabaseListing = {
  id: string;
  title: string;
  description: string;
  category: string;
  country: string;
  starting_price_usd: number;
  delivery_days: number;
  provider_wallet_address: string;
  is_demo: number;
  created_at: string;
  updated_at: string;
};

const demoListings: ServiceListingInput[] = [
  {
    title: "Brand identity starter kit",
    description: "A polished logo suite, color palette, and typography guide for an early-stage business.",
    category: "Design",
    country: "United States",
    startingPriceUsd: 350,
    deliveryDays: 7,
    providerWalletAddress: "0x1000000000000000000000000000000000000001",
  },
  {
    title: "Responsive landing page build",
    description: "A fast, accessible landing page built from your supplied copy and visual direction.",
    category: "Development",
    country: "Canada",
    startingPriceUsd: 800,
    deliveryDays: 10,
    providerWalletAddress: "0x1000000000000000000000000000000000000002",
  },
  {
    title: "Product website copy",
    description: "Clear homepage and product page copy tailored to your audience and launch goals.",
    category: "Writing",
    country: "United Kingdom",
    startingPriceUsd: 240,
    deliveryDays: 5,
    providerWalletAddress: "0x1000000000000000000000000000000000000003",
  },
  {
    title: "Social launch content pack",
    description: "A two-week set of launch posts with a simple publishing calendar for your brand.",
    category: "Marketing",
    country: "Australia",
    startingPriceUsd: 180,
    deliveryDays: 4,
    providerWalletAddress: "0x1000000000000000000000000000000000000004",
  },
  {
    title: "Short-form product video",
    description: "A concise edited product walkthrough for social channels using your supplied footage.",
    category: "Video",
    country: "Germany",
    startingPriceUsd: 500,
    deliveryDays: 8,
    providerWalletAddress: "0x1000000000000000000000000000000000000005",
  },
  {
    title: "Customer discovery session",
    description: "A focused discovery workshop with a written summary of customer themes and next steps.",
    category: "Business",
    country: "India",
    startingPriceUsd: 150,
    deliveryDays: 3,
    providerWalletAddress: "0x1000000000000000000000000000000000000006",
  },
];

const seedDemoListings = database.prepare(`
  INSERT INTO service_listings (
    id, title, description, category, country, starting_price_usd,
    delivery_days, provider_wallet_address, is_demo, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
`);

const seed = database.transaction(() => {
  const existingDemoCount = database
    .prepare("SELECT COUNT(*) AS count FROM service_listings WHERE is_demo = 1")
    .get() as { count: number };
  if (existingDemoCount.count > 0) return;

  const timestamp = new Date().toISOString();
  demoListings.forEach((listing, index) => {
    seedDemoListings.run(
      `demo-${index + 1}`,
      listing.title,
      `${listing.description} DEMO LISTING: sample marketplace content only; this provider and offer have not been verified.`,
      listing.category,
      listing.country,
      listing.startingPriceUsd,
      listing.deliveryDays,
      listing.providerWalletAddress,
      timestamp,
      timestamp,
    );
  });
});
seed();

function toListing(row: DatabaseListing): ServiceListing {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category as ServiceListing["category"],
    country: row.country,
    startingPriceUsd: row.starting_price_usd,
    deliveryDays: row.delivery_days,
    providerWalletAddress: row.provider_wallet_address,
    isDemo: row.is_demo === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listServiceListings(filters: {
  search?: string;
  category?: string;
  country?: string;
  minPrice?: number;
  maxPrice?: number;
}): ServiceListing[] {
  const clauses: string[] = [];
  const values: Array<string | number> = [];
  if (filters.search) {
    clauses.push("(title LIKE ? OR description LIKE ?)");
    values.push(`%${filters.search}%`, `%${filters.search}%`);
  }
  if (filters.category) {
    clauses.push("category = ?");
    values.push(filters.category);
  }
  if (filters.country) {
    clauses.push("country = ?");
    values.push(filters.country);
  }
  if (filters.minPrice !== undefined) {
    clauses.push("starting_price_usd >= ?");
    values.push(filters.minPrice);
  }
  if (filters.maxPrice !== undefined) {
    clauses.push("starting_price_usd <= ?");
    values.push(filters.maxPrice);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = database
    .prepare(`SELECT * FROM service_listings ${where} ORDER BY is_demo DESC, created_at DESC`)
    .all(...values) as DatabaseListing[];
  return rows.map(toListing);
}

export function getServiceListing(id: string): ServiceListing | undefined {
  const row = database
    .prepare("SELECT * FROM service_listings WHERE id = ?")
    .get(id) as DatabaseListing | undefined;
  return row ? toListing(row) : undefined;
}

export const listingDatabase = database;
export const createListingId = () => randomUUID();
export const currentIsoTimestamp = () => new Date().toISOString();

export type FxRateSnapshot = {
  rates: Record<string, number>;
  fetchedAt: number;
  rateTimestamp: string;
};

export function getFxRateSnapshot(): FxRateSnapshot | null {
  const row = database
    .prepare("SELECT rates_json, fetched_at, rate_timestamp FROM fx_rate_cache WHERE id = 1")
    .get() as
    | { rates_json: string; fetched_at: number; rate_timestamp: string }
    | undefined;
  if (!row) return null;
  return {
    rates: JSON.parse(row.rates_json) as Record<string, number>,
    fetchedAt: row.fetched_at,
    rateTimestamp: row.rate_timestamp,
  };
}

export function saveFxRateSnapshot(snapshot: FxRateSnapshot): void {
  database
    .prepare(
      `INSERT INTO fx_rate_cache (id, rates_json, fetched_at, rate_timestamp)
       VALUES (1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         rates_json = excluded.rates_json,
         fetched_at = excluded.fetched_at,
         rate_timestamp = excluded.rate_timestamp`,
    )
    .run(
      JSON.stringify(snapshot.rates),
      snapshot.fetchedAt,
      snapshot.rateTimestamp,
    );
}
