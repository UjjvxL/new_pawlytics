import assert from "node:assert/strict";
import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { chromium } from "@playwright/test";

if (process.env.LIVE_SMOKE !== "1") {
  throw new Error("Refusing to touch the live project without LIVE_SMOKE=1");
}

const projectId = "pawlytics-506516";
const region = "asia-south1";
const bucket = "pawlytics-506516.firebasestorage.app";
const terminal = new Set([
  "provisional",
  "confirmed",
  "approved",
  "review_required",
  "rejected",
  "duplicate",
  "expired",
]);
const createdReports = new Set();
const createdObjects = new Set();

function gpsDegrees(value) {
  const absolute = Math.abs(value),
    whole = Math.floor(absolute),
    minutes = Math.floor((absolute - whole) * 60),
    seconds = (absolute - whole - minutes / 60) * 3_600;
  return [
    [whole, 1],
    [minutes, 1],
    [Math.round(seconds * 10_000), 10_000],
  ];
}

function exifDate(value) {
  return value.toISOString().slice(0, 19).replace(/-/g, ":").replace("T", " ");
}

function parseEnv(source) {
  return Object.fromEntries(
    source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}

async function jsonFetch(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 300) };
  }
  if (!response.ok) {
    throw new Error(
      `${response.status} ${body?.error?.message || body?.error?.status || "request failed"}`,
    );
  }
  return body;
}

async function googleAccessToken(cli) {
  if (
    cli.tokens?.access_token &&
    Number(cli.tokens.expires_at) > Date.now() + 120_000
  ) {
    return cli.tokens.access_token;
  }
  const require = createRequire(import.meta.url);
  const { clientId, clientSecret } = require("firebase-tools/lib/api.js");
  const body = new URLSearchParams({
    client_id: clientId(),
    client_secret: clientSecret(),
    refresh_token: cli.tokens.refresh_token,
    grant_type: "refresh_token",
  });
  const refreshed = await jsonFetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  return refreshed.access_token;
}

async function firebaseTestIdentity(firebaseApiKey, googleToken) {
  const serviceAccount =
    "firebase-adminsdk-fbsvc@pawlytics-506516.iam.gserviceaccount.com";
  const now = Math.floor(Date.now() / 1000);
  const encode = (input) =>
    Buffer.from(JSON.stringify(input)).toString("base64url");
  const unsigned = (purpose) =>
    `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
      iss: serviceAccount,
      sub: serviceAccount,
      aud: "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit",
      iat: now,
      exp: now + 3600,
      uid: process.env.LIVE_SMOKE_UID || "KgURcVoHp0RzByxnmnexFGYep7h2",
      claims: { platformAdmin: true, liveSmoke: purpose },
    })}`;
  const backendUnsigned = unsigned("backend"),
    browserUnsigned = unsigned("browser");
  const signingUrl = `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(serviceAccount)}:signBlob`;
  const sign = (payload) =>
    jsonFetch(signingUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${googleToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        payload: Buffer.from(payload).toString("base64"),
      }),
    });
  let backendSignature,
    browserSignature,
    ephemeralKeyName = "";
  try {
    [backendSignature, browserSignature] = await Promise.all([
      sign(backendUnsigned),
      sign(browserUnsigned),
    ]);
  } catch (error) {
    if (!String(error).includes("iam.serviceAccounts.signBlob")) throw error;
    const key = await jsonFetch(
      `https://iam.googleapis.com/v1/projects/${projectId}/serviceAccounts/${encodeURIComponent(serviceAccount)}/keys`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${googleToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          privateKeyType: "TYPE_GOOGLE_CREDENTIALS_FILE",
          keyAlgorithm: "KEY_ALG_RSA_2048",
        }),
      },
    );
    ephemeralKeyName = key.name;
    const credentials = JSON.parse(
        Buffer.from(key.privateKeyData, "base64").toString("utf8"),
      ),
      localSign = (payload) => {
        const signer = createSign("RSA-SHA256");
        signer.update(payload);
        signer.end();
        return {
          signedBlob: signer.sign(credentials.private_key).toString("base64"),
        };
      };
    backendSignature = localSign(backendUnsigned);
    browserSignature = localSign(browserUnsigned);
  }
  const token = (payload, signature) =>
      `${payload}.${Buffer.from(signature.signedBlob, "base64").toString("base64url")}`,
    backendToken = token(backendUnsigned, backendSignature),
    customToken = token(browserUnsigned, browserSignature);
  try {
    let identity;
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      try {
        identity = await jsonFetch(
          `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(firebaseApiKey)}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              token: backendToken,
              returnSecureToken: true,
            }),
          },
        );
        break;
      } catch (error) {
        if (attempt === 8 || !String(error).includes("INVALID_CUSTOM_TOKEN"))
          throw error;
        // Newly-created service-account public keys can take a few seconds to
        // propagate to Firebase Auth's token verifier.
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
    }
    return { customToken, identity, ephemeralKeyName };
  } catch (error) {
    if (ephemeralKeyName)
      await fetch(`https://iam.googleapis.com/v1/${ephemeralKeyName}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${googleToken}` },
      });
    throw error;
  }
}

async function runBrowserSubmission(
  customToken,
  firebaseConfig,
  jpeg,
  onSignedIn = async () => {},
) {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({
    geolocation: { latitude: 45.5019, longitude: -73.5674 },
    permissions: ["geolocation"],
  });
  const page = await context.newPage();
  let reportId = "";
  page.on("response", async (response) => {
    if (!response.url().includes("/createReportSession") || !response.ok())
      return;
    try {
      const payload = await response.json();
      reportId = payload.result?.reportId || payload.data?.reportId || reportId;
      if (reportId) createdReports.add(reportId);
    } catch {
      // Cleanup also discovers this uniquely described test report below.
    }
  });
  try {
    await page.goto("https://pawlytics-506516.web.app/test");
    await page.evaluate(
      async ({ token, config }) => {
        const [{ initializeApp }, authSdk] = await Promise.all([
          import("https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js"),
          import("https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js"),
        ]);
        const app = initializeApp(config);
        const auth = authSdk.getAuth(app);
        await authSdk.setPersistence(auth, authSdk.browserLocalPersistence);
        await authSdk.signInWithCustomToken(auth, token);
      },
      { token: customToken, config: firebaseConfig },
    );
    await onSignedIn();
    await page.reload();
    await page.getByLabel("Open account").waitFor({ timeout: 30_000 });
    await page.getByRole("button", { name: "Report", exact: true }).click();
    await page
      .getByRole("heading", { name: "Report a dog sighting" })
      .waitFor();
    await page
      .getByPlaceholder(/Example: Three street dogs/)
      .fill("Pawlytics browser end-to-end smoke test for admin image upload");
    await page
      .locator('.photo-actions input[type="file"]:not([capture])')
      .setInputFiles({
        name: "nirmal-browser-smoke.jpg",
        mimeType: "image/jpeg",
        buffer: jpeg,
      });
    await page.getByRole("button", { name: "Submit for verification" }).click();
    await page
      .getByText(/Image and metadata are confirmed\. AI is running/)
      .waitFor({ timeout: 120_000 });
    assert.ok(reportId, "Browser submission did not expose a report ID");
    await page.getByLabel("Report notifications").click();
    const completedReport = page.locator(`[data-report-id="${reportId}"]`);
    await completedReport
      .getByText("Provisionally protecting routes")
      .waitFor({ timeout: 180_000 });
    const timeline = completedReport.locator(".verification-timeline");
    assert.deepEqual(await timeline.locator("small").allTextContents(), [
      "Report",
      "Image",
      "Metadata",
      "AI/checks",
      "Decision",
    ]);
    assert.equal(await timeline.locator("i.done").count(), 5);
    process.stdout.write(
      "BROWSER UI OK: login persistence, gallery upload, visible stages, bell progress, and final result\n",
    );
    return reportId;
  } finally {
    await browser.close();
  }
}

function value(field) {
  if (!field) return undefined;
  if ("stringValue" in field) return field.stringValue;
  if ("booleanValue" in field) return field.booleanValue;
  if ("integerValue" in field) return Number(field.integerValue);
  if ("doubleValue" in field) return Number(field.doubleValue);
  if ("timestampValue" in field) return field.timestampValue;
  if ("nullValue" in field) return null;
  if ("mapValue" in field) {
    return Object.fromEntries(
      Object.entries(field.mapValue.fields || {}).map(([key, item]) => [
        key,
        value(item),
      ]),
    );
  }
  return undefined;
}

function fields(document) {
  return Object.fromEntries(
    Object.entries(document.fields || {}).map(([key, field]) => [
      key,
      value(field),
    ]),
  );
}

async function main() {
  const env = parseEnv(await readFile(".env", "utf8"));
  const firebaseApiKey = env.VITE_FIREBASE_API_KEY;
  assert.ok(firebaseApiKey, "Firebase web API key is missing");

  const configPath =
    process.env.FIREBASE_TOOLS_CONFIG ||
    join(homedir(), ".config/configstore/firebase-tools.json");
  const cli = JSON.parse(await readFile(configPath, "utf8"));
  const googleToken = await googleAccessToken(cli);
  const { customToken, identity, ephemeralKeyName } =
    await firebaseTestIdentity(firebaseApiKey, googleToken);
  let testKeyName = ephemeralKeyName;
  const deleteTestKey = async () => {
    if (!testKeyName) return;
    const response = await fetch(
      `https://iam.googleapis.com/v1/${testKeyName}`,
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${googleToken}` },
      },
    );
    if (!response.ok)
      throw new Error(
        `Ephemeral service-account key cleanup failed: ${response.status}`,
      );
    testKeyName = "";
  };
  const firebaseToken = identity.idToken;
  const claims = JSON.parse(
      Buffer.from(firebaseToken.split(".")[1], "base64url").toString("utf8"),
    ),
    firebaseUid = identity.localId || claims.user_id || claims.sub;
  assert.ok(firebaseUid, "Firebase test identity did not include a UID");
  assert.equal(
    claims.email,
    cli.user.email,
    "Firebase and CLI Google users differ",
  );
  assert.equal(
    claims.platformAdmin,
    true,
    "The signed-in user lacks platformAdmin=true; refresh the claim",
  );

  const callable = async (name, data) => {
    const body = await jsonFetch(
      `https://${region}-${projectId}.cloudfunctions.net/${name}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${firebaseToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ data }),
      },
    );
    return body.result ?? body.data;
  };
  const firestoreUrl = (path) =>
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${path}`;
  const getDocument = async (path) => {
    const response = await fetch(firestoreUrl(path), {
      headers: { authorization: `Bearer ${firebaseToken}` },
    });
    if (response.status === 404) return null;
    if (!response.ok)
      throw new Error(`Firestore read failed: ${response.status}`);
    return fields(await response.json());
  };
  const deleteDocument = async (path) => {
    const response = await fetch(firestoreUrl(path), {
      method: "DELETE",
      headers: { authorization: `Bearer ${googleToken}` },
    });
    if (![200, 404].includes(response.status))
      throw new Error(`Firestore cleanup failed: ${response.status}`);
  };

  try {
    await callable("bootstrapUser", {});
    const authority = await callable("getAuthorityContext", {});
    assert.equal(authority.platformAdmin, true);
    process.stdout.write(
      `AUTH OK: ${claims.email} (${firebaseUid}) is platform admin\n`,
    );

    const stressKeys = Array.from(
      { length: 8 },
      (_, index) => `live-stress-${Date.now()}-${index}`,
    );
    const sessions = await Promise.all(
      stressKeys.map((idempotencyKey) =>
        callable("createReportSession", {
          lat: 45.5019,
          lng: -73.5674,
          description: "Admin-only concurrent report-session stress test",
          severity: "low",
          photoSource: "library",
          testMode: true,
          idempotencyKey,
        }),
      ),
    );
    sessions.forEach(({ reportId }) => createdReports.add(reportId));
    assert.equal(
      new Set(sessions.map((session) => session.reportId)).size,
      sessions.length,
    );
    process.stdout.write(
      `SESSION STRESS OK: ${sessions.length} concurrent admin test sessions\n`,
    );

    const session = sessions.shift();
    const reportId = session.reportId;
    const require = createRequire(import.meta.url),
      sharp = require("../functions/node_modules/sharp"),
      piexif = require("../functions/node_modules/piexifjs"),
      capturedAt = new Date(Date.now() - 60_000);
    const svg = Buffer.from(
      '<svg width="1000" height="700" xmlns="http://www.w3.org/2000/svg"><rect width="1000" height="700" fill="#e8f4ef"/><circle cx="500" cy="315" r="145" fill="#8b5e3c"/><circle cx="380" cy="210" r="75" fill="#6e452d"/><circle cx="620" cy="210" r="75" fill="#6e452d"/><circle cx="450" cy="295" r="18"/><circle cx="550" cy="295" r="18"/><ellipse cx="500" cy="380" rx="75" ry="55" fill="#c79368"/><circle cx="500" cy="360" r="22"/><text x="500" y="580" text-anchor="middle" font-size="56" font-family="sans-serif" fill="#123b34">NIRMAL ADMIN PIPELINE TEST</text></svg>',
    );
    const plainJpeg = await sharp(svg).jpeg({ quality: 88 }).toBuffer(),
      exif = piexif.dump({
        "0th": {
          [piexif.ImageIFD.Make]: "Apple",
          [piexif.ImageIFD.Model]: "iPhone cross-platform live fixture",
          [piexif.ImageIFD.Orientation]: 6,
        },
        Exif: {
          [piexif.ExifIFD.DateTimeOriginal]: exifDate(capturedAt),
        },
        GPS: {
          [piexif.GPSIFD.GPSLatitudeRef]: "N",
          [piexif.GPSIFD.GPSLatitude]: gpsDegrees(45.5019),
          [piexif.GPSIFD.GPSLongitudeRef]: "W",
          [piexif.GPSIFD.GPSLongitude]: gpsDegrees(-73.5674),
        },
        "1st": {},
        thumbnail: null,
      }),
      jpeg = Buffer.from(
        piexif
          .insert(
            exif,
            `data:image/jpeg;base64,${plainJpeg.toString("base64")}`,
          )
          .split(",")[1],
        "base64",
      );
    const raceSession = sessions.shift(),
      racePayload = {
        reportId: raceSession.reportId,
        imageBase64: jpeg.toString("base64"),
        contentType: "image/jpeg",
        clientMetadata: { originalPreserved: true, platform: "stress" },
      },
      raceResults = await Promise.all(
        Array.from({ length: 4 }, () =>
          callable("uploadReportEvidence", racePayload),
        ),
      ),
      raceReport = await getDocument(`reports/${raceSession.reportId}`),
      prefix = `reportEvidence/${firebaseUid}/${raceSession.reportId}/`,
      objects = await jsonFetch(
        `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o?prefix=${encodeURIComponent(prefix)}`,
        { headers: { authorization: `Bearer ${googleToken}` } },
      );
    assert.ok(raceResults.every((result) => result.ok));
    assert.equal(raceReport.verificationStatus, "uploaded");
    assert.equal(objects.items?.length || 0, 1);
    createdObjects.add(raceReport.storagePath);
    process.stdout.write(
      "UPLOAD RACE OK: four simultaneous retries produced one stored image and one database state\n",
    );
    const primaryUploadPayload = {
        reportId,
        imageBase64: jpeg.toString("base64"),
        contentType: "image/jpeg",
        clientMetadata: {
          originalPreserved: true,
          platform: "test",
        },
      },
      upload = await callable("uploadReportEvidence", primaryUploadPayload),
      uploadRetry = await callable(
        "uploadReportEvidence",
        primaryUploadPayload,
      );
    assert.equal(upload.contentType, "image/jpeg");
    assert.equal(upload.uploadedBytes, jpeg.length);
    assert.equal(uploadRetry.alreadyUploaded, true);
    process.stdout.write(
      `UPLOAD OK: ${upload.uploadedBytes} bytes confirmed by server\n`,
    );

    const metadata = await callable("prepareReportVerification", { reportId }),
      metadataRetry = await callable("prepareReportVerification", { reportId });
    assert.equal(metadata.hasGps, true);
    assert.equal(metadata.hasCaptureTime, true);
    assert.equal(metadataRetry.alreadyPrepared, true);
    process.stdout.write(
      "METADATA OK: normalized GPS and capture time confirmed by server\n",
    );

    let report;
    let lastStatus = "";
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      report = await getDocument(`reports/${reportId}`);
      assert.ok(report, "Live report disappeared during verification");
      if (report.verificationStatus !== lastStatus) {
        lastStatus = report.verificationStatus;
        process.stdout.write(
          `AI STATUS: ${lastStatus} / ${report.processingStatus}\n`,
        );
      }
      if (terminal.has(report.verificationStatus)) break;
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    assert.equal(report.verificationStatus, "provisional");
    assert.equal(report.processingStatus, "complete");
    assert.equal(report.testOnly, true);
    assert.ok(
      Number.isFinite(report.aiConfidence),
      "AI confidence was not stored",
    );
    assert.ok(report.aiSummary, "AI summary was not stored");
    assert.equal(report.metadataLocationSource, "server_exif");
    assert.equal(report.metadataTimeSource, "server_exif");
    assert.equal(report.metadataMake, "Apple");
    assert.equal(report.metadataOrientation, 6);
    createdObjects.add(report.storagePath);
    process.stdout.write(
      `AI OK: ${report.aiSummary} (confidence ${report.aiConfidence})\n`,
    );

    const publicSighting = await getDocument(`publicSightings/${reportId}`);
    assert.equal(publicSighting?.testOnly, true);
    const evidence = await callable("getReportEvidenceUrl", {
      organizationId: report.organizationId || "",
      reportId,
    });
    const evidenceResponse = await fetch(evidence.url);
    assert.equal(
      evidenceResponse.status,
      200,
      "Authority evidence URL is not readable",
    );
    process.stdout.write(
      "DATABASE/AUTHORITY OK: isolated map point and review evidence are readable\n",
    );
    await runBrowserSubmission(
      customToken,
      {
        apiKey: env.VITE_FIREBASE_API_KEY,
        authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
        projectId: env.VITE_FIREBASE_PROJECT_ID,
        storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
        messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
        appId: env.VITE_FIREBASE_APP_ID,
      },
      jpeg,
      deleteTestKey,
    );
  } finally {
    const response = await fetch(
      `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/reports?pageSize=300`,
      { headers: { authorization: `Bearer ${googleToken}` } },
    );
    if (response.ok) {
      const listing = await response.json();
      for (const document of listing.documents || []) {
        if (
          document.fields?.testOnly?.booleanValue === true &&
          [
            "Admin-only concurrent report-session stress test",
            "Pawlytics browser end-to-end smoke test for admin image upload",
          ].includes(document.fields?.description?.stringValue)
        )
          createdReports.add(document.name.split("/").pop());
      }
    }
    for (const reportId of createdReports) {
      const report = await getDocument(`reports/${reportId}`).catch(() => null);
      if (report?.storagePath) createdObjects.add(report.storagePath);
      await Promise.allSettled([
        deleteDocument(`publicSightings/${reportId}`),
        deleteDocument(`reviewCases/${reportId}`),
        deleteDocument(`reports/${reportId}`),
      ]);
    }
    for (const object of createdObjects) {
      const response = await fetch(
        `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(object)}`,
        {
          method: "DELETE",
          headers: { authorization: `Bearer ${googleToken}` },
        },
      );
      if (![204, 404].includes(response.status))
        process.stderr.write(`Storage cleanup warning: ${response.status}\n`);
    }
    await deleteTestKey();
    process.stdout.write(
      "CLEANUP OK: live smoke-test records and images removed\n",
    );
  }
}

await main();
