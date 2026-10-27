import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";

const env = { ...process.env };
const currentJava = spawnSync("java", ["-version"], { encoding: "utf8" });
if (currentJava.status !== 0) {
  const candidates = [
    env.JAVA_HOME && join(env.JAVA_HOME, "bin"),
    "/opt/homebrew/opt/openjdk@21/bin",
    "/usr/local/opt/openjdk@21/bin",
  ];
  const javaBin = candidates.find(path => path && existsSync(join(path, "java")));
  if (!javaBin) throw new Error("Firebase rule tests require Java 21 or newer on PATH or in JAVA_HOME.");
  env.PATH = javaBin + delimiter + (env.PATH || "");
}
const result = spawnSync(process.execPath, [
  "node_modules/firebase-tools/lib/bin/firebase.js",
  "emulators:exec", "--only", "firestore,storage", "--project", "demo-pawlytics",
  "node --test tests/firebase-rules.test.mjs",
], { env, stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
