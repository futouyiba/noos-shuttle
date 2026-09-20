#!/usr/bin/env node
/**
 * Cooperative run lock, not a process lease. TTL is advisory only: a paused run
 * can resume, so no command reclaims an existing lock, even malformed/empty ones.
 * All mutations use an exclusive mkdir guard; a crashed guard also fails closed.
 * Recovery is manual, only after ALL runs/helpers using this path are confirmed
 * stopped. This does not fence non-cooperating writers or external file removal.
 * Exit: 0 success/status, 1 occupied/token mismatch, 2 error.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

function canonicalPath(input) {
  const absolute = path.resolve(input);
  if (fs.existsSync(absolute)) return fs.realpathSync(absolute);
  const parent = path.dirname(absolute);
  return path.join(parent === absolute ? parent : canonicalPath(parent), path.basename(absolute));
}

export function defaultLockPath(cwd = process.cwd()) {
  // git's first worktree entry is the main checkout, even from a linked worktree.
  const listing = execFileSync("git", ["worktree", "list", "--porcelain", "-z"], { cwd, encoding: "utf8" });
  const first = listing.split("\0")[0];
  if (!first.startsWith("worktree ") || !path.isAbsolute(first.slice(9))) throw new Error("Cannot locate main checkout");
  return canonicalPath(path.join(first.slice(9), ".tmp", "noos-watch.lock"));
}

function readLock(lockPath) {
  try {
    const record = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    return record && typeof record.holderToken === "string" && record.holderToken.length > 0
      && typeof record.startedAt === "string" && Number.isFinite(Date.parse(record.startedAt)) ? record : null;
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

// Exported primitive allows deterministic tests to hold the guard at the exact
// read/mutate boundary while other real CLI processes attempt every operation.
export function withMutationGuard(lockPath, mutate) {
  const guard = `${lockPath}.mutation`;
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  try { fs.mkdirSync(guard); } catch (error) {
    if (error.code === "EEXIST") return { ok: false, outcome: "mutation_busy", lock: lockPath };
    throw error;
  }
  try { return mutate(); } finally { fs.rmdirSync(guard); }
}

export function operate(command, lockPath, { token, ttlMinutes = 10, sessionRef } = {}) {
  const inspect = () => {
    const present = fs.existsSync(lockPath);
    const holder = readLock(lockPath);
    return { ok: true, outcome: present ? (holder ? "held" : "invalid") : "free", lock: lockPath,
      holder, stale: holder ? Date.now() - Date.parse(holder.startedAt) > ttlMinutes * 60000 : null,
      mutationBlocked: fs.existsSync(`${lockPath}.mutation`) };
  };
  if (command === "status") return inspect(); // advisory snapshot, never grants ownership
  return withMutationGuard(lockPath, () => {
    if (command === "acquire") {
      const record = { holderToken: crypto.randomUUID(), sessionRef: sessionRef ?? null,
        host: os.hostname(), startedAt: new Date().toISOString() };
      let fd;
      try { fd = fs.openSync(lockPath, "wx"); } catch (error) {
        if (error.code === "EEXIST") return { ...inspect(), ok: false, outcome: "busy" };
        throw error;
      }
      try { fs.writeFileSync(fd, `${JSON.stringify(record, null, 2)}\n`); } finally { fs.closeSync(fd); }
      return { ok: true, outcome: "acquired", lock: lockPath, ...record };
    }
    const existing = readLock(lockPath);
    if (!existing || existing.holderToken !== token) {
      return { ok: false, outcome: existing ? "token_mismatch" : "not_held_or_invalid", lock: lockPath };
    }
    if (command === "release") {
      fs.unlinkSync(lockPath);
      return { ok: true, outcome: "released", lock: lockPath };
    }
    const next = { ...existing, startedAt: new Date().toISOString() };
    // Guard excludes release/acquire during validation + replacement. An interrupted
    // write leaves the guard in place; nobody interprets the partial write as free.
    fs.writeFileSync(lockPath, `${JSON.stringify(next, null, 2)}\n`);
    return { ok: true, outcome: "refreshed", lock: lockPath, ...next };
  });
}

function main(argv) {
  const [command, ...rest] = argv;
  if (!["acquire", "refresh", "release", "status"].includes(command)) throw new Error(
    "Usage: noos-watch-lock.mjs acquire|refresh|release|status [--lock-file <absolute-path>] [--token <token>] [--ttl-minutes N] [--session-ref <ref>]");
  const values = {};
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i];
    if (!["--lock-file", "--lock", "--token", "--ttl-minutes", "--session-ref"].includes(flag)
      || !rest[i + 1] || rest[i + 1].startsWith("--") || values[flag] !== undefined) throw new Error(`Invalid flag: ${flag}`);
    values[flag] = rest[i + 1];
  }
  if (values["--lock-file"] && !path.isAbsolute(values["--lock-file"])) throw new Error("--lock-file must be absolute");
  if (values["--lock-file"] && values["--lock"]) throw new Error("Use only --lock-file (or legacy --lock)");
  const lockPath = canonicalPath(values["--lock-file"] ?? values["--lock"] ?? defaultLockPath());
  const ttlMinutes = Number(values["--ttl-minutes"] ?? 10);
  if (!Number.isFinite(ttlMinutes) || ttlMinutes <= 0) throw new Error("--ttl-minutes must be positive");
  if (["refresh", "release"].includes(command) && !values["--token"]?.trim()) throw new Error("--token is required");
  const result = operate(command, lockPath, { token: values["--token"], ttlMinutes, sessionRef: values["--session-ref"] });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = main(process.argv.slice(2)); } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}
