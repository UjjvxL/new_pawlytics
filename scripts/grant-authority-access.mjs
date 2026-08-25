import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const [emailInput, role = "moderator"] = process.argv.slice(2);
const projectId = "pawlytics-506516";
const allowedRoles = new Set([
  "moderator",
  "dispatcher",
  "field_officer",
  "analyst",
  "org_admin",
]);
const email = String(emailInput || "").trim().toLowerCase();
if (!email.includes("@") || !allowedRoles.has(role)) {
  throw new Error(
    "Usage: npm run grant:authority -- email@example.com [moderator|dispatcher|field_officer|analyst|org_admin]",
  );
}

const require = createRequire(import.meta.url);
const auth = require("firebase-tools/lib/auth.js");
const account = auth.getGlobalDefaultAccount();
if (!account?.tokens?.refresh_token) {
  throw new Error("Sign in with the Firebase CLI before granting access.");
}
const token =
  account.tokens.access_token && account.tokens.expires_at > Date.now() + 60_000
    ? account.tokens.access_token
    : (await auth.getAccessToken(account.tokens.refresh_token)).access_token;
const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
const request = async (url, init = {}) => {
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
};

const platform = await request(`${base}/publicConfig/platform`);
const organizationId = platform.fields?.pilotOrganizationId?.stringValue;
if (!organizationId)
  throw new Error("The pilot authority organization is not configured.");
const emailHash = createHash("sha256").update(email).digest("hex");
await request(`${base}/authorityAccessGrants/${emailHash}`, {
  method: "PATCH",
  body: JSON.stringify({
    fields: {
      email: { stringValue: email },
      organizationId: { stringValue: organizationId },
      role: { stringValue: role },
      jurisdictionIds: { arrayValue: { values: [] } },
      status: { stringValue: "active" },
      updatedAt: { timestampValue: new Date().toISOString() },
    },
  }),
});
console.log(
  `Authority access granted to ${email} as ${role}. It activates automatically after Google sign-in.`,
);
