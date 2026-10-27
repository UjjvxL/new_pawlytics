import assert from "node:assert/strict";
import test from "node:test";
import {
  validAbcTransition,
  updateStock,
  wardAnalytics,
} from "./operations-policy";
test("ABC stages cannot skip recovery or create a fabricated completed procedure", () => {
  assert.equal(validAbcTransition(undefined, "released"), false);
  assert.equal(validAbcTransition(undefined, "captured"), true);
  assert.equal(validAbcTransition("captured", "sterilized"), false);
  assert.equal(validAbcTransition("recovery", "released"), true);
});
test("ARV movements cannot overdraw stock or accept invalid quantities", () => {
  assert.equal(updateStock(10, "received", 5), 15);
  assert.equal(updateStock(10, "administered", 4), 6);
  assert.throws(() => updateStock(3, "administered", 4));
  assert.throws(() => updateStock(3, "received", -4));
});
test("ward scores decay with time and exclude expired, unverified and test reports", () => {
  const now = Date.now();
  const report = {
    wardId: "Ward 1",
    severity: "high",
    dogCount: 2,
    verificationStatus: "confirmed",
    createdAtMillis: now,
  };
  assert.equal(wardAnalytics([report], now)[0].score, 14);
  assert.equal(
    wardAnalytics([{ ...report, createdAtMillis: now - 6 * 3600000 }], now)[0]
      .score,
    7,
  );
  assert.deepEqual(
    wardAnalytics(
      [
        { ...report, testOnly: true },
        { ...report, verificationStatus: "review_required" },
        { ...report, expiresAtMillis: now - 1 },
      ],
      now,
    ),
    [],
  );
});
