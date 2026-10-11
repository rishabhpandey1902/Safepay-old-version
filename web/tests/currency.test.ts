import assert from "node:assert/strict";
import test from "node:test";

import {
  convertUsdToDisplayCurrency,
  formatDisplayCurrency,
  formatRateTimestamp,
} from "../lib/currency";

test("converts stablecoin USD value to an approximate display currency", () => {
  assert.equal(convertUsdToDisplayCurrency(100, 83.25), 8325);
  assert.equal(formatDisplayCurrency(8325, "INR"), "₹8,325.00");
});

test("keeps USD at the 1:1 base rate and formats rate timestamps", () => {
  assert.equal(convertUsdToDisplayCurrency(42, 1), 42);
  assert.equal(formatDisplayCurrency(42, "USD"), "$42.00");
  assert.doesNotThrow(() => formatRateTimestamp("2026-10-07T12:00:00.000Z"));
  assert.throws(() => formatRateTimestamp("invalid timestamp"));
});

test("rejects invalid amounts and FX rates", () => {
  assert.throws(() => convertUsdToDisplayCurrency(Number.NaN, 1));
  assert.throws(() => convertUsdToDisplayCurrency(1, 0));
});
