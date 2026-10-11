export const displayCurrencies = ["INR", "USD", "EUR", "GBP", "AED"] as const;

export type DisplayCurrency = (typeof displayCurrencies)[number];

export type FxRateResponse = {
  currency: DisplayCurrency;
  rate: number;
  timestamp: string;
  stale: boolean;
  message: string | null;
};

export function formatDisplayCurrency(amount: number, currency: DisplayCurrency): string {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function convertUsdToDisplayCurrency(
  usdAmount: number,
  rate: number,
): number {
  if (!Number.isFinite(usdAmount) || !Number.isFinite(rate) || rate <= 0) {
    throw new Error("USD amount and FX rate must be finite, and the rate must be positive.");
  }
  return usdAmount * rate;
}

export function formatRateTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    throw new Error("FX rate timestamp is invalid.");
  }
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
