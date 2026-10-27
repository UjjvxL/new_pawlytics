import { spawnSync } from "node:child_process";
import { hostingUrl } from "./project-config.mjs";

const result = spawnSync(process.execPath, ["node_modules/@playwright/test/cli.js", "test", ...process.argv.slice(2)], {
  env: { ...process.env, PLAYWRIGHT_BASE_URL: hostingUrl },
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
