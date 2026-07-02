#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isWindows, run, runNpm } from "./lib/node-script-utils.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8")).version;
const packageDir = path.join(rootDir, "release");
const packagePath = path.join(packageDir, `noos-shuttle-extension-${version}.zip`);
const distDir = path.join(rootDir, "dist");

runNpm(["run", "build"], { cwd: rootDir });
fs.mkdirSync(packageDir, { recursive: true });
fs.rmSync(packagePath, { force: true });

if (isWindows) {
  run(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      [
        "$ErrorActionPreference = 'Stop'",
        "Add-Type -AssemblyName System.IO.Compression.FileSystem",
        "[System.IO.Compression.ZipFile]::CreateFromDirectory($env:NOOS_DIST_DIR, $env:NOOS_PACKAGE_PATH, [System.IO.Compression.CompressionLevel]::Optimal, $false)",
      ].join("; "),
    ],
    {
      cwd: rootDir,
      env: {
        ...process.env,
        NOOS_DIST_DIR: distDir,
        NOOS_PACKAGE_PATH: packagePath,
      },
    },
  );
} else {
  run("zip", ["-qr", packagePath, "."], { cwd: distDir });
}

console.log(packagePath);
