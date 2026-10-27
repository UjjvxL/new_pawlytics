import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

const root = new URL("../", import.meta.url);
export const env = {};
for (const name of [".env", ".env.local"]) {
  const path = new URL(name, root);
  if (existsSync(path)) Object.assign(env, parseEnv(readFileSync(path, "utf8")));
}
Object.assign(env, process.env);
const selected = JSON.parse(readFileSync(new URL(".firebaserc", root), "utf8")).projects?.default;
export const projectId = env.VITE_FIREBASE_PROJECT_ID || selected;
if (!projectId || (selected && projectId !== selected)) {
  throw new Error("Firebase project configuration is missing or inconsistent. Run npm run setup:local first.");
}
export const bucket = env.VITE_FIREBASE_STORAGE_BUCKET || `${projectId}.firebasestorage.app`;
export const region = env.VITE_FIREBASE_FUNCTIONS_REGION || "asia-south1";
export const hostingUrl = `https://${projectId}.web.app`;
