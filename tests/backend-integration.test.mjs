import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createRequire } from "node:module";
const require = createRequire(
  new URL("../functions/package.json", import.meta.url),
);
const { initializeApp, deleteApp } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const projectId = "demo-pawlytics";
if (
  !process.env.FIRESTORE_EMULATOR_HOST ||
  !process.env.FIREBASE_AUTH_EMULATOR_HOST
)
  throw Error("Isolated Firebase emulators required.");
const app = initializeApp({ projectId }),
  db = getFirestore(app);
const jwt = (uid, secondFactor = true) => {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  return (
    enc({ alg: "none", typ: "JWT" }) +
    "." +
    enc({
      aud: projectId,
      iss: `https://securetoken.google.com/${projectId}`,
      sub: uid,
      user_id: uid,
      iat: now,
      exp: now + 3600,
      auth_time: now,
      email: uid + "@example.test",
      email_verified: true,
      firebase: {
        sign_in_provider: "google.com",
        ...(secondFactor ? { sign_in_second_factor: "phone" } : {}),
      },
    }) +
    "."
  );
};
async function call(name, data, uid = "operator", factor = true) {
  const response = await fetch(
    `http://127.0.0.1:5001/${projectId}/asia-south1/${name}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(uid ? { authorization: "Bearer " + jwt(uid, factor) } : {}),
      },
      body: JSON.stringify({ data }),
    },
  );
  return response.json();
}
before(async () => {
  await Promise.all([
    db
      .doc("organizations/test-org")
      .set({ name: "Isolated test organization" }),
    db.doc("organizations/test-org/members/operator").set({
      uid: "operator",
      role: "org_admin",
      status: "active",
      mfaRequired: true,
    }),
    db.doc("organizations/test-org/members/analyst").set({
      uid: "analyst",
      role: "analyst",
      status: "active",
      mfaRequired: true,
    }),
    db.doc("users/citizen").set({
      onboardingComplete: true,
      contributionStatus: "active",
      phoneVerified: false,
    }),
    db.doc("publicConfig/platform").set({ pilotOrganizationId: "test-org" }),
    db.doc("publicSightings/ward-fixture").set({
      organizationId: "test-org",
      wardId: "Ward 4",
      severity: "high",
      dogCount: 2,
      verificationStatus: "confirmed",
      createdAt: Timestamp.now(),
      expiresAt: Timestamp.fromMillis(Date.now() + 3600000),
    }),
  ]);
});
after(() => deleteApp(app));
test("operation callables require authentication, MFA and matching organization role", async () => {
  assert.equal(
    (await call("getAuthorityOperations", { organizationId: "test-org" }, null))
      .error.status,
    "UNAUTHENTICATED",
  );
  assert.equal(
    (
      await call(
        "getAuthorityOperations",
        { organizationId: "test-org" },
        "operator",
        false,
      )
    ).error.status,
    "PERMISSION_DENIED",
  );
  assert.equal(
    (await call("getAuthorityOperations", { organizationId: "other-org" }))
      .error.status,
    "PERMISSION_DENIED",
  );
  assert.equal(
    (
      await call(
        "recordAuthorityOperation",
        { organizationId: "test-org" },
        "analyst",
      )
    ).error.status,
    "PERMISSION_DENIED",
  );
});
test("ABC callable persists ordered stages, rejects skipped stages and records an audit trail", async () => {
  const data = {
    organizationId: "test-org",
    kind: "abc",
    subject: "ANIMAL-001",
    wardId: "Ward 4",
    stage: "captured",
    idempotencyKey: "abc-capture",
  };
  assert.equal((await call("recordAuthorityOperation", data)).result.ok, true);
  assert.equal(
    (
      await call("recordAuthorityOperation", {
        ...data,
        stage: "released",
        idempotencyKey: "invalid-skip",
      })
    ).error.status,
    "FAILED_PRECONDITION",
  );
  const events = await db.collection("organizations/test-org/operations").get();
  assert.equal(events.size, 1);
  assert.equal(
    (
      await db
        .collection("auditLogs")
        .where("organizationId", "==", "test-org")
        .get()
    ).size,
    1,
  );
});
test("ARV callable is idempotent, prevents overdraft and rejects conflicting retries", async () => {
  const data = {
    organizationId: "test-org",
    kind: "arv",
    subject: "Clinic A",
    wardId: "Ward 4",
    stage: "received",
    quantity: 20,
    idempotencyKey: "stock-receipt",
  };
  assert.equal((await call("recordAuthorityOperation", data)).result.ok, true);
  assert.equal((await call("recordAuthorityOperation", data)).result.ok, true);
  assert.equal(
    (await call("recordAuthorityOperation", { ...data, quantity: 30 })).error
      .status,
    "ALREADY_EXISTS",
  );
  assert.equal(
    (
      await call("recordAuthorityOperation", {
        ...data,
        stage: "administered",
        quantity: 21,
        idempotencyKey: "overdraw",
      })
    ).error.status,
    "FAILED_PRECONDITION",
  );
  assert.equal(
    (
      await call("recordAuthorityOperation", {
        ...data,
        stage: "administered",
        quantity: 3,
        idempotencyKey: "dose-use",
      })
    ).result.ok,
    true,
  );
  const snapshot = (
    await call("getAuthorityOperations", { organizationId: "test-org" })
  ).result;
  assert.equal(snapshot.stock[0].balance, 17);
  assert.equal(snapshot.animals[0].stage, "captured");
  assert.equal(snapshot.wards[0].ward, "Ward 4");
  assert.ok(snapshot.wards[0].score > 13);
});
test("citizen session stores category, claimed observation time and server timestamp without fabricating verification", async () => {
  const data = {
    lat: 28.45,
    lng: 77.49,
    description: "A calm dog beside the gate",
    severity: "low",
    category: "sighting",
    observedAt: new Date().toISOString(),
    idempotencyKey: "citizen-session",
    sharePublicImage: false,
  };
  assert.equal(
    (
      await call(
        "createReportSession",
        { ...data, category: "invented" },
        "citizen",
        false,
      )
    ).error.status,
    "INVALID_ARGUMENT",
  );
  assert.equal(
    (
      await call(
        "createReportSession",
        { ...data, observedAt: "invalid" },
        "citizen",
        false,
      )
    ).error.status,
    "INVALID_ARGUMENT",
  );
  const { result } = await call("createReportSession", data, "citizen", false);
  assert.ok(result.reportId);
  const report = (await db.doc("reports/" + result.reportId).get()).data();
  assert.equal(report.category, "sighting");
  assert.equal(report.verificationStatus, "uploading");
  assert.equal(report.processingStatus, "awaiting-image");
  assert.ok(report.createdAt.toMillis());
  assert.ok(report.observedAt.toMillis());
  assert.equal(
    (await db.doc("publicSightings/" + result.reportId).get()).exists,
    false,
  );
});

test("authority review assigns a ward but cannot claim another organization or an unassigned report", async () => {
  const report = {
    reporterId: "citizen",
    organizationId: "test-org",
    lat: 28.45,
    lng: 77.49,
    description: "Manual-review fixture",
    severity: "low",
    verificationStatus: "review_required",
    rewardStatus: "ineligible",
    createdAt: Timestamp.now(),
  };
  await Promise.all([
    db.doc("reports/review-fixture").set(report),
    db
      .doc("reports/other-fixture")
      .set({ ...report, organizationId: "other-org" }),
    db
      .doc("reports/unassigned-fixture")
      .set({ ...report, organizationId: null }),
  ]);
  const details = {
    organizationId: "test-org",
    decision: "confirmed",
    reason: "Reviewed fixture evidence",
    wardId: "Ward 9",
    publishImage: false,
  };
  for (const reportId of ["other-fixture", "unassigned-fixture"])
    assert.equal(
      (await call("reviewReport", { ...details, reportId })).error.status,
      "NOT_FOUND",
    );
  assert.equal(
    (await call("reviewReport", { ...details, reportId: "review-fixture" }))
      .result.ok,
    true,
  );
  assert.equal(
    (await db.doc("reports/review-fixture").get()).data().wardId,
    "Ward 9",
  );
  const publicRecord = (
    await db.doc("publicSightings/review-fixture").get()
  ).data();
  assert.equal(publicRecord.wardId, "Ward 9");
  assert.equal(publicRecord.verificationStatus, "confirmed");
  assert.notEqual(publicRecord.lat, report.lat);
  assert.equal(publicRecord.reporterId, undefined);
});
