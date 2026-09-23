#!/usr/bin/env node
/**
 * Dev/dogfood enrollment for the Hub pairing registry (#100 slice 1).
 *
 * Adds one EXACT extension origin (chrome-extension://<id> or
 * moz-extension://<id>) to `runtime/paired-clients.json`, preserving the
 * registry epoch — the same thing the Hub panel's "Add development origin"
 * box does, without needing the window open. There is no wildcard form and
 * never will be: the disposition (5758723769) freezes that.
 *
 * Usage: node scripts/noos-hub-allow-dev-extension.mjs chrome-extension://abc...
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

const origin = process.argv[2];
if (!origin || !/^(-moz-|chrome-|moz-)extension:\/\/[a-z0-9-]+$/i.test(origin)) {
  console.error("usage: noos-hub-allow-dev-extension.mjs chrome-extension://<id>");
  process.exit(1);
}

const root = process.env.NOOS_HOME ?? join(homedir(), ".noos");
const registryPath = join(root, "runtime", "paired-clients.json");

let registry;
if (existsSync(registryPath)) {
  registry = JSON.parse(readFileSync(registryPath, "utf8"));
  if (registry.version !== 2 || !Number.isSafeInteger(registry.epoch)) {
    console.error(`refusing: ${registryPath} is not a v2 registry (epoch preserved required)`);
    process.exit(1);
  }
} else {
  registry = { version: 2, epoch: Number(randomBytes(8).readBigUInt64BE(0)), clients: [] };
}

if (!registry.clients.some((client) => client.origin === origin)) {
  registry.clients.push({ origin, enrolled_at_epoch: Math.floor(Date.now() / 1000) });
}

mkdirSync(dirname(registryPath), { recursive: true });
writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
console.log(`enrolled ${origin} (epoch ${registry.epoch}, ${registry.clients.length} client(s))`);
