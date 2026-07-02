#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runNpm } from "./lib/node-script-utils.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hubDir = path.join(rootDir, "apps", "noos-hub");
const targetDir = path.join(hubDir, "src-tauri", "target");
const env = { ...process.env };
const extraArgs = process.argv.slice(2);

if (!env.TAURI_SIGNING_PRIVATE_KEY && env.NOOS_HUB_TAURI_SIGNING_PRIVATE_KEY) {
  env.TAURI_SIGNING_PRIVATE_KEY = env.NOOS_HUB_TAURI_SIGNING_PRIVATE_KEY;
}

if (!env.TAURI_SIGNING_PRIVATE_KEY && env.TAURI_SIGNING_PRIVATE_KEY_PATH) {
  env.TAURI_SIGNING_PRIVATE_KEY = env.TAURI_SIGNING_PRIVATE_KEY_PATH;
}

if (!env.TAURI_SIGNING_PRIVATE_KEY && env.NOOS_HUB_TAURI_SIGNING_PRIVATE_KEY_PATH) {
  env.TAURI_SIGNING_PRIVATE_KEY = env.NOOS_HUB_TAURI_SIGNING_PRIVATE_KEY_PATH;
}

if (!env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD && env.NOOS_HUB_TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
  env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = env.NOOS_HUB_TAURI_SIGNING_PRIVATE_KEY_PASSWORD;
}

function removeStaleUpdaterArtifacts(dir) {
  if (!fs.existsSync(dir)) {
    return;
  }

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      removeStaleUpdaterArtifacts(entryPath);
      continue;
    }

    if (
      entryPath.includes(`${path.sep}bundle${path.sep}`) &&
      (entry.name.endsWith(".app.tar.gz") ||
        entry.name.endsWith(".app.tar.gz.sig") ||
        entry.name === "latest.json")
    ) {
      fs.rmSync(entryPath, { force: true });
    }
  }
}

if (env.TAURI_SIGNING_PRIVATE_KEY) {
  runNpm(["run", "tauri", "--", "build", ...extraArgs], { cwd: hubDir, env });
} else {
  console.error("No Tauri updater signing key found; building NOOS Hub without updater artifacts.");
  console.error("Set TAURI_SIGNING_PRIVATE_KEY or NOOS_HUB_TAURI_SIGNING_PRIVATE_KEY to build signed updater artifacts.");

  removeStaleUpdaterArtifacts(targetDir);
  const configPath = path.join(os.tmpdir(), `noos-hub-tauri-build-${process.pid}.json`);

  try {
    fs.writeFileSync(configPath, JSON.stringify({ bundle: { createUpdaterArtifacts: false } }));
    runNpm(["run", "tauri", "--", "build", "--config", configPath, ...extraArgs], {
      cwd: hubDir,
      env,
    });
  } finally {
    fs.rmSync(configPath, { force: true });
    removeStaleUpdaterArtifacts(targetDir);
  }
}
