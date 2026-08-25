import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const projectId = "pawlytics-506516";
const bucket = "pawlytics-506516.firebasestorage.app";
const assignments = process.argv.slice(2).map((argument) => {
  const separator = argument.indexOf("=");
  if (separator < 1) throw new Error("Each assignment must be reportId=/image/path");
  return {
    reportId: argument.slice(0, separator),
    imagePath: argument.slice(separator + 1),
  };
});
if (!assignments.length)
  throw new Error(
    "Usage: npm run attach:sighting-images -- reportId=/absolute/image.jpg [...]",
  );
for (const assignment of assignments) {
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(assignment.reportId))
    throw new Error(`Invalid report ID: ${assignment.reportId}`);
  if (!assignment.imagePath.startsWith("/"))
    throw new Error("Image paths must be absolute.");
}

const rootRequire = createRequire(import.meta.url);
const functionsRequire = createRequire(
  new URL("../functions/package.json", import.meta.url),
);
const auth = rootRequire("firebase-tools/lib/auth.js");
const sharp = functionsRequire("sharp");
const account = auth.getGlobalDefaultAccount();
if (!account?.tokens?.refresh_token)
  throw new Error("Sign in with the Firebase CLI before attaching images.");
const token =
  account.tokens.access_token && account.tokens.expires_at > Date.now() + 60_000
    ? account.tokens.access_token
    : (await auth.getAccessToken(account.tokens.refresh_token)).access_token;

async function checkedFetch(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...init.headers },
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`${response.status} ${message.slice(0, 500)}`);
  }
  return response;
}

const firestoreBase = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
for (const { reportId, imagePath } of assignments) {
  const source = await readFile(imagePath);
  const thumbnail = await sharp(source)
    .rotate()
    .resize({
      width: 960,
      height: 720,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 80, progressive: true })
    .toBuffer();
  const storagePath = `publicEvidence/${reportId}/thumbnail.jpg`;
  await checkedFetch(
    `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(storagePath)}`,
    {
      method: "POST",
      headers: { "content-type": "image/jpeg" },
      body: thumbnail,
    },
  );
  const imageUrl = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(storagePath)}?alt=media`;
  const fields = {
    imageUrl: { stringValue: imageUrl },
    thumbnailUrl: { stringValue: imageUrl },
    sharePublicImage: { booleanValue: true },
    privacySafeForPublic: { booleanValue: true },
    publicImageSource: { stringValue: "authority_backfill" },
    publicImageUpdatedAt: { timestampValue: new Date().toISOString() },
  };
  const updateMask = Object.keys(fields)
    .map((field) => `updateMask.fieldPaths=${encodeURIComponent(field)}`)
    .join("&");
  for (const collection of ["reports", "publicSightings"]) {
    await checkedFetch(
      `${firestoreBase}/${collection}/${reportId}?${updateMask}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fields }),
      },
    );
  }
  const publicImage = await fetch(imageUrl, { cache: "no-store" });
  if (!publicImage.ok || !publicImage.headers.get("content-type")?.startsWith("image/"))
    throw new Error(`Public image verification failed for ${reportId}`);
  console.log(`${reportId}: attached and publicly verified (${thumbnail.length} bytes)`);
}
