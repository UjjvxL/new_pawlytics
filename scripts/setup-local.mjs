import { chmod, readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const localConfigUrl = new URL(".setup.local.mjs", root);

async function setup() {
  let config;
  try {
    config = await import(localConfigUrl.href);
  } catch (error) {
    if (error.code === "ERR_MODULE_NOT_FOUND") {
      throw new Error("Create .setup.local.mjs from .setup.example.mjs and fill in the three sections.");
    }
    throw new Error("Cannot read .setup.local.mjs. Check its JavaScript syntax; keep values inside quotes.");
  }

  const fields = {
    apiKey: "VITE_FIREBASE_API_KEY",
    authDomain: "VITE_FIREBASE_AUTH_DOMAIN",
    projectId: "VITE_FIREBASE_PROJECT_ID",
    storageBucket: "VITE_FIREBASE_STORAGE_BUCKET",
    messagingSenderId: "VITE_FIREBASE_MESSAGING_SENDER_ID",
    appId: "VITE_FIREBASE_APP_ID",
  };
  const missing = [];
  const env = {};
  function value(input, name, optional = false) {
    if (typeof input !== "string" || !input.trim()) {
      if (!optional) missing.push(name);
      return "";
    }
    const result = input.trim();
    if (/[\r\n\0$#"'`\\]/.test(result)) {
      throw new Error(`${name} contains unsupported characters. Paste only the value.`);
    }
    return result;
  }
  for (const [field, envName] of Object.entries(fields)) {
    env[envName] = value(config.firebaseConfig?.[field], `firebaseConfig.${field}`);
  }
  env.VITE_GOOGLE_MAPS_API_KEY = value(config.googleMapsApiKey, "googleMapsApiKey");
  const geminiKey = value(config.geminiApiKey, "geminiApiKey");
  env.VITE_FIREBASE_FUNCTIONS_REGION = "asia-south1";
  env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY = value(
    config.recaptchaEnterpriseSiteKey,
    "recaptchaEnterpriseSiteKey",
    true,
  );
  if (missing.length) throw new Error(`Fill in: ${missing.join(", ")}. No files changed.`);
  if (process.argv.includes("--check")) {
    console.log("All required configuration fields are present. No files changed.");
    return;
  }

  const firebaseRcUrl = new URL(".firebaserc", root);
  const firebaseRc = JSON.parse(await readFile(firebaseRcUrl, "utf8"));
  firebaseRc.projects = { ...firebaseRc.projects, default: env.VITE_FIREBASE_PROJECT_ID };
  // Restrict existing files too: writeFile's mode only applies to new files.
  await chmod(localConfigUrl, 0o600);
  for (const [path, content] of [
    [".env.local", Object.entries(env).map(([key, val]) => `${key}=${val}`).join("\n") + "\n"],
    ["functions/.secret.local", `GEMINI_API_KEY=${geminiKey}\n`],
  ]) {
    const url = new URL(path, root);
    await writeFile(url, content, { mode: 0o600 });
    await chmod(url, 0o600);
  }
  await writeFile(firebaseRcUrl, JSON.stringify(firebaseRc, null, 2) + "\n");
  console.log("Prepared .env.local and functions/.secret.local; selected your project in .firebaserc.");
  console.log("The Gemini key is local only. It must also be uploaded to Firebase Secret Manager before deploying functions.");
  console.log("Configuration saved. Cloud services and API access have not been tested.");
}

setup().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
