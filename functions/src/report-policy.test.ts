import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyLocation,
  detectImageType,
  reportRateLimits,
  triageReport,
  type AiVerdict,
} from "./report-policy";

const calm: AiVerdict = {
  containsDog: true,
  plausible: true,
  manipulationLikely: false,
  confidence: 0.95,
  dogCount: 1,
  observedSeverity: "low",
  observedBehavior: "calm",
};

test("detects every supported mobile image format by bytes", () => {
  assert.equal(
    detectImageType(Uint8Array.from([0xff, 0xd8, 0xff])),
    "image/jpeg",
  );
  assert.equal(
    detectImageType(
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ),
    "image/png",
  );
  assert.equal(
    detectImageType(
      Uint8Array.from([
        0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
      ]),
    ),
    "image/webp",
  );
  assert.equal(
    detectImageType(
      Uint8Array.from([
        0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63,
      ]),
      "image/heic",
    ),
    "image/heic",
  );
  assert.equal(
    detectImageType(
      Uint8Array.from([
        0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
      ]),
      "image/heic",
    ),
    null,
  );
  assert.equal(detectImageType(Uint8Array.from([1, 2, 3, 4])), null);
});

test("normalizes iOS, Android, live-camera, and missing GPS evidence", () => {
  assert.equal(classifyLocation(true, 15, false, "server_exif"), "verified");
  assert.equal(
    classifyLocation(true, 15, false, "client_preprocess"),
    "client-metadata",
  );
  assert.equal(classifyLocation(false, null, true, "none"), "live-camera");
  assert.equal(classifyLocation(false, null, false, "none"), "unverified");
  assert.equal(classifyLocation(true, 201, false, "server_exif"), "mismatch");
});

test("AI-only publishes calm evidence but escalates danger and production GPS mismatch", () => {
  assert.equal(triageReport(calm, "verified", "recent").status, "provisional");
  assert.equal(
    triageReport({ ...calm, observedSeverity: "high" }, "verified", "recent")
      .status,
    "review_required",
  );
  assert.equal(
    triageReport(calm, "mismatch", "recent").status,
    "review_required",
  );
  assert.equal(
    triageReport({ ...calm, manipulationLikely: true }, "verified", "recent")
      .status,
    "review_required",
  );
  assert.equal(
    triageReport(calm, "mismatch", "recent", true).status,
    "provisional",
  );
  assert.equal(
    triageReport({ ...calm, containsDog: false }, "verified", "recent").status,
    "rejected",
  );
  assert.equal(
    triageReport(
      { ...calm, containsDog: false, plausible: false, confidence: 0.99 },
      "unverified",
      "stale",
      true,
    ).status,
    "provisional",
  );
});

test("stress: policy always returns a terminal valid decision", () => {
  const statuses = new Set(["provisional", "review_required", "rejected"]);
  for (let i = 0; i < 10_000; i++) {
    const verdict = {
      ...calm,
      containsDog: Math.random() > 0.15,
      plausible: Math.random() > 0.1,
      manipulationLikely: Math.random() > 0.8,
      confidence: Math.random(),
      dogCount: Math.floor(Math.random() * 40),
      observedSeverity: (["low", "medium", "high"] as const)[i % 3],
      observedBehavior: (
        [
          "calm",
          "roaming",
          "barking",
          "chasing",
          "aggressive",
          "injured",
          "unknown",
        ] as const
      )[i % 7],
    };
    const result = triageReport(
      verdict,
      (
        [
          "verified",
          "client-metadata",
          "live-camera",
          "unverified",
          "mismatch",
        ] as const
      )[i % 5],
      (["recent", "stale", "unverified"] as const)[i % 3],
      i % 11 === 0,
    );
    assert.ok(statuses.has(result.status));
    assert.ok(result.publicHours === 2 || result.publicHours === 6);
  }
});

test("test accounts receive an isolated higher limit", () => {
  assert.deepEqual(reportRateLimits(false), { tenMinutes: 8, day: 30 });
  assert.deepEqual(reportRateLimits(true), { tenMinutes: 60, day: 300 });
});
