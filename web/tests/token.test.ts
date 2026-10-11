import assert from "node:assert/strict";
import test from "node:test";

import { formatTokenAmount, formatTokenDisplay, parseTokenAmount } from "../lib/token";

test("parses and formats settlement amounts using a 6-decimal token", () => {
  const decimals = 6;
  const rawAmount = parseTokenAmount("123.456789", decimals);

  assert.equal(rawAmount, BigInt(123_456_789));
  assert.equal(formatTokenAmount(rawAmount, decimals), "123.456789");
  assert.equal(
    formatTokenDisplay(rawAmount, { symbol: "TEST", decimals }),
    "TEST 123.456789",
  );
});

test("rejects more fractional digits than the configured token supports", () => {
  assert.throws(() => parseTokenAmount("1.0000001", 6));
});
