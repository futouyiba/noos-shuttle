#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { run, runNpm } from "./lib/node-script-utils.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8")).version;
const packageDir = path.join(rootDir, "release");
const skillsPath = path.join(packageDir, `noos-agent-skills-${version}.tar.gz`);
const hubPath = path.join(packageDir, `noos-hub-source-${version}.tar.gz`);

fs.mkdirSync(packageDir, { recursive: true });
runNpm(["run", "package:extension"], { cwd: rootDir });

fs.rmSync(skillsPath, { force: true });
fs.rmSync(hubPath, { force: true });

run(
  "tar",
  [
    "--exclude=.DS_Store",
    "-czf",
    skillsPath,
    "AGENTS.md",
    "CLAUDE.md",
    ".noos/agent-registry.json",
    ".noos/skills",
  ],
  { cwd: rootDir },
);

run(
  "tar",
  [
    "--exclude=.DS_Store",
    "--exclude=apps/noos-hub/node_modules",
    "--exclude=apps/noos-hub/dist",
    "--exclude=apps/noos-hub/src-tauri/target",
    "--exclude=apps/noos-hub/src-tauri/target-*",
    "--exclude=apps/noos-hub/src-tauri/gen",
    "-czf",
    hubPath,
    "apps/noos-hub",
    "scripts/noos-hub-launch.sh",
    "scripts/noos-open.sh",
    "scripts/noos-project-runtime.sh",
    "scripts/noos-find-artifact.sh",
    "scripts/noos-find-crystal.sh",
    "scripts/noos-import-browser-vault.sh",
    "scripts/noos-sync-llm-wiki.sh",
    "scripts/noos-sync-handoffs-git.sh",
    "scripts/noos-install.sh",
    "scripts/noos-doctor.sh",
  ],
  { cwd: rootDir },
);

console.log(skillsPath);
console.log(hubPath);
