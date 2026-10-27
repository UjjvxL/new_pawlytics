import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { readFile } from "node:fs/promises";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { getBytes, ref, uploadBytes } from "firebase/storage";

// The CLI and both emulators use the same isolated demo project.
const projectId = "demo-pawlytics";
let environment;

before(async () => {
  const [firestoreRules, storageRules] = await Promise.all([
    readFile("firestore.rules", "utf8"),
    readFile("storage.rules", "utf8"),
  ]);
  environment = await initializeTestEnvironment({
    projectId,
    firestore: { rules: firestoreRules },
    storage: { rules: storageRules },
  });
});

beforeEach(async () => {
  await environment.clearFirestore();
  await environment.clearStorage();
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, "reports/report-owner"), {
        reporterId: "owner",
        organizationId: "org-a",
        verificationStatus: "uploaded",
      }),
      setDoc(doc(db, "publicSightings/public-one"), { lat: 45.5, lng: -73.5 }),
      setDoc(doc(db, "organizations/org-a"), { name: "Authority A" }),
      setDoc(doc(db, "organizations/org-a/members/reviewer"), {
        status: "active",
        role: "reviewer",
        mfaRequired: true,
      }),
      setDoc(doc(db, "reviewCases/review-one"), {
        organizationId: "org-a",
        reporterId: "owner",
      }),
      setDoc(doc(db, "userSettings/owner"), {
        language: "en",
        communityVisible: false,
        leaderboardVisible: false,
        pushEnabled: false,
        homeArea: null,
      }),
    ]);
  });
});

after(async () => {
  await environment?.cleanup();
});

test("public safety data is readable but raw evidence is private", async () => {
  const anonymous = environment.unauthenticatedContext();
  await assertSucceeds(
    getDoc(doc(anonymous.firestore(), "publicSightings/public-one")),
  );
  await assertFails(getDoc(doc(anonymous.firestore(), "reports/report-owner")));
  await assertFails(
    getDoc(doc(anonymous.firestore(), "reviewCases/review-one")),
  );
});

test("report reads are limited to owner, platform admin, or matching active authority", async () => {
  const owner = environment.authenticatedContext("owner");
  const stranger = environment.authenticatedContext("stranger");
  const reviewer = environment.authenticatedContext("reviewer", { firebase: { sign_in_second_factor: "phone" } });
  const platformAdmin = environment.authenticatedContext("admin", {
    platformAdmin: true,
    firebase: { sign_in_second_factor: "phone" },
  });

  await assertSucceeds(getDoc(doc(owner.firestore(), "reports/report-owner")));
  await assertSucceeds(
    getDoc(doc(reviewer.firestore(), "reports/report-owner")),
  );
  await assertSucceeds(
    getDoc(doc(platformAdmin.firestore(), "reports/report-owner")),
  );
  await assertFails(getDoc(doc(stranger.firestore(), "reports/report-owner")));
});

test("an authority enrollment or admin claim alone cannot bypass second-factor verification", async () => {
  const unverifiedReviewer = environment.authenticatedContext("reviewer").firestore();
  const unverifiedAdmin = environment.authenticatedContext("admin", { platformAdmin: true }).firestore();
  await assertFails(getDoc(doc(unverifiedReviewer, "reports/report-owner")));
  await assertFails(getDoc(doc(unverifiedReviewer, "reviewCases/review-one")));
  await assertFails(getDoc(doc(unverifiedAdmin, "reports/report-owner")));
  const verifiedAdmin = environment.authenticatedContext("admin", { platformAdmin: true, firebase: { sign_in_second_factor: "phone" } }).firestore();
  await assertSucceeds(getDoc(doc(verifiedAdmin, "reviewCases/review-one")));
});

test("clients cannot forge report, public map, or authority records", async () => {
  const ownerDb = environment.authenticatedContext("owner").firestore();
  await assertFails(
    setDoc(doc(ownerDb, "reports/forged"), { reporterId: "owner" }),
  );
  await assertFails(
    setDoc(doc(ownerDb, "publicSightings/forged"), { lat: 0, lng: 0 }),
  );
  await assertFails(
    setDoc(doc(ownerDb, "authorityActions/forged"), {
      organizationId: "org-a",
    }),
  );
});

test("owners can change only explicitly allowed settings", async () => {
  const ownerDb = environment.authenticatedContext("owner").firestore();
  await assertSucceeds(
    updateDoc(doc(ownerDb, "userSettings/owner"), { language: "hi-IN" }),
  );
  await assertFails(
    updateDoc(doc(ownerDb, "userSettings/owner"), { role: "platform_admin" }),
  );
  await assertFails(
    updateDoc(
      doc(
        environment.authenticatedContext("stranger").firestore(),
        "userSettings/owner",
      ),
      { language: "fr-CA" },
    ),
  );
});

test("private evidence uploads require the report owner and a supported image type", async () => {
  const jpeg = Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xdb,
    ...new Array(1_100).fill(0),
  ]);
  const ownerStorage = environment.authenticatedContext("owner").storage();
  const strangerStorage = environment
    .authenticatedContext("stranger")
    .storage();
  const path = "reportEvidence/owner/report-owner/original.jpg";

  await assertSucceeds(
    uploadBytes(ref(ownerStorage, path), jpeg, { contentType: "image/jpeg" }),
  );
  await assertFails(
    uploadBytes(ref(strangerStorage, path), jpeg, {
      contentType: "image/jpeg",
    }),
  );
  await assertFails(
    uploadBytes(
      ref(ownerStorage, "reportEvidence/owner/report-owner/not-image.txt"),
      jpeg,
      { contentType: "text/plain" },
    ),
  );
  await assertFails(
    uploadBytes(
      ref(ownerStorage, "publicEvidence/report-owner/forged.jpg"),
      jpeg,
      { contentType: "image/jpeg" },
    ),
  );
  await assertFails(getBytes(ref(ownerStorage, path)));
  await environment.withSecurityRulesDisabled(async (context) => {
    await uploadBytes(
      ref(context.storage(), "publicEvidence/report-owner/thumbnail.jpg"),
      jpeg,
      { contentType: "image/jpeg" },
    );
  });
  await assertSucceeds(
    getBytes(
      ref(
        environment.unauthenticatedContext().storage(),
        "publicEvidence/report-owner/thumbnail.jpg",
      ),
    ),
  );
});

test("rules remain deterministic under repeated unauthorized access", async () => {
  const stranger = environment.authenticatedContext("stranger").firestore();
  const attempts = await Promise.allSettled(
    Array.from({ length: 50 }, () =>
      getDoc(doc(stranger, "reports/report-owner")),
    ),
  );
  assert.equal(
    attempts.filter((item) => item.status === "rejected").length,
    50,
  );
});
