import { createRequire } from "node:module";

const projectId = "pawlytics-506516";
const rootRequire = createRequire(import.meta.url);
const functionsRequire = createRequire(
  new URL("../functions/package.json", import.meta.url),
);
const auth = rootRequire("firebase-tools/lib/auth.js");
const tzLookup = functionsRequire("tz-lookup");
const account = auth.getGlobalDefaultAccount();
if (!account?.tokens?.refresh_token)
  throw new Error("Sign in with the Firebase CLI before running the backfill.");
const token =
  account.tokens.access_token && account.tokens.expires_at > Date.now() + 60_000
    ? account.tokens.access_token
    : (await auth.getAccessToken(account.tokens.refresh_token)).access_token;
const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

async function request(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(body?.error?.message || `Firestore returned ${response.status}`);
  return body;
}

let updated = 0;
for (const collection of ["reports", "publicSightings"]) {
  let pageToken = "";
  do {
    const page = await request(
      `${base}/${collection}?pageSize=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`,
    );
    for (const document of page.documents || []) {
      const fields = document.fields || {};
      if (fields.sightingTimezone?.stringValue) continue;
      const lat = Number(fields.lat?.doubleValue ?? fields.lat?.integerValue);
      const lng = Number(fields.lng?.doubleValue ?? fields.lng?.integerValue);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const timezone = tzLookup(lat, lng);
      await request(
        `https://firestore.googleapis.com/v1/${document.name}?updateMask.fieldPaths=sightingTimezone`,
        {
          method: "PATCH",
          body: JSON.stringify({
            fields: { sightingTimezone: { stringValue: timezone } },
          }),
        },
      );
      updated += 1;
      console.log(`${collection}/${document.name.split("/").pop()}: ${timezone}`);
    }
    pageToken = page.nextPageToken || "";
  } while (pageToken);
}
console.log(`Backfill complete: ${updated} documents updated.`);
