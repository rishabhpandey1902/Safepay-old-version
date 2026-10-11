import { NextResponse } from "next/server";
import { z } from "zod";

import { displayCurrencies } from "@/lib/currency";
import { getFxRateSnapshot, saveFxRateSnapshot } from "@/lib/services-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL_SECONDS = 5 * 60;
const querySchema = z.object({ currency: z.enum(displayCurrencies) });
const upstreamSchema = z.object({
  result: z.literal("success"),
  base_code: z.literal("USD"),
  time_last_update_unix: z.number().int().positive(),
  rates: z.record(z.string(), z.number().finite().positive()),
});

function rateResponse(
  currency: (typeof displayCurrencies)[number],
  rate: number,
  timestamp: string,
  stale: boolean,
  message: string | null,
) {
  return NextResponse.json(
    { currency, rate, timestamp, stale, message },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = querySchema.safeParse({ currency: params.get("currency") });
  if (!query.success) {
    return NextResponse.json(
      { error: "Choose INR, USD, EUR, GBP, or AED." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const currency = query.data.currency;
  if (currency === "USD") {
    return rateResponse(
      currency,
      1,
      new Date().toISOString(),
      false,
      "USD is the base currency (1:1).",
    );
  }

  let cached;
  try {
    cached = getFxRateSnapshot();
  } catch (error) {
    console.error("Could not read cached FX rates:", error);
    return NextResponse.json(
      { error: "Could not read cached FX rates." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }

  const now = Math.floor(Date.now() / 1000);
  if (cached && now - cached.fetchedAt < CACHE_TTL_SECONDS && cached.rates[currency]) {
    return rateResponse(
      currency,
      cached.rates[currency]!,
      cached.rateTimestamp,
      false,
      null,
    );
  }

  try {
    const response = await fetch("https://open.er-api.com/v6/latest/USD", {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      throw new Error(`FX provider returned HTTP ${response.status}.`);
    }
    const raw: unknown = await response.json();
    const parsed = upstreamSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error("FX provider returned an invalid USD rates payload.");
    }
    const rate = parsed.data.rates[currency];
    if (rate === undefined) {
      throw new Error(`FX provider did not include ${currency}.`);
    }
    const snapshot = {
      rates: parsed.data.rates,
      fetchedAt: now,
      rateTimestamp: new Date(parsed.data.time_last_update_unix * 1000).toISOString(),
    };
    saveFxRateSnapshot(snapshot);
    return rateResponse(currency, rate, snapshot.rateTimestamp, false, null);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown FX provider failure.";
    console.error("FX refresh failed:", message);
    if (cached?.rates[currency]) {
      return rateResponse(
        currency,
        cached.rates[currency],
        cached.rateTimestamp,
        true,
        `FX provider unavailable (${message}); using the last cached rate, which may be stale.`,
      );
    }
    return NextResponse.json(
      {
        error: `FX rate unavailable for ${currency}; no cached rate exists. ${message}`,
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
