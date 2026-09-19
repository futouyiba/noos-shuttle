#!/usr/bin/env node
/**
 * Single-instance lock for the noos-shuttle comment watcher (transport hardening L0).
 *
 * Why this exists: the watcher's idempotency guard was a post-hoc `processed`
 * array in `.tmp/watcher-state.json`. Two watcher sessions starting concurrently
 * both read the same watermark, both see the same "unprocessed" comments, and both
 * route them — the union-merge on write-back prevents a *lost update* but does
 * nothing about a *duplicate side effect*. Serializing the watcher removes the
 * concurrent-reader precondition entirely.
 *
 * Ownership model: the lock represents a **run**, not a process. The caller is a
 * short-lived helper invocation, so pid liveness is meaningless here (the acquiring
 * process exits immediately). Ownership is therefore carried by a holder *token*
 * that the caller passes back to `refresh`/`release`, and staleness is decided by
 * the TTL alone. A run killed mid-flight cannot clean up, so the TTL is the backstop.
 *
 * Acquisition is atomic: the lock file is created with O_EXCL, so exactly one
 * caller can win, including under simultaneous starts.
 *
 * Boundary: this only serializes watcher invocations. It performs no routing and no
 * sensitive action, and it is not an authority of any kind.
 *
 * Usage:
 *   node scripts/noos-watch-lock.mjs acquire [--lock <path>] [--ttl-minutes N] [--session-ref <ref>]
 *   node scripts/noos-watch-lock.mjs refresh --token <token> [--lock <path>]
 *   node scripts/noos-watch-lock.mjs release --token <token> [--lock <path>]
 *   node scripts/noos-watch-lock.mjs status  [--lock <path>]
 *
 * Exit codes: 0 = acquired / released / refreshed / inspected; 1 = held elsewhere or token mismatch; 2 = error.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_LOCK = path.join(".tmp", "noos-watch.lock");
/** A watcher run is bounded by the ~10 minute poll interval; a lock older than this is a dead run. */
const DEFAULT_TTL_MINUTES = 10;

function usage(exitCode = 0) {
  process.stdout.write(`Usage:
  node scripts/noos-watch-lock.mjs acquire [--lock <path>] [--ttl-minutes N] [--session-ref <ref>]
  node scripts/noos-watch-lock.mjs refresh --token <token> [--lock <path>]
  node scripts/noos-watch-lock.mjs release --token <token> [--lock <path>]
  node scripts/noos-watch-lock.mjs status  [--lock <path>]
`);
  process.exit(exitCode);
}

function fail(message, exitCode = 2) {
  process.stderr.write(`${message}\n`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const values = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) fail(`Unexpected argument: ${token}`);
    const next = rest[index + 1];
    if (next === undefined || next.startsWith("--")) fail(`Flag --${token.slice(2)} requires a value`);
    values[token.slice(2)] = next;
    index += 1;
  }
  return { command, values };
}

function readLock(lockPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Staleness is TTL-only: the holder is a run, and a run that died cannot release. */
function lockIsStale(record, ttlMs) {
  if (!record || typeof record.startedAt !== "string") return true;
  const startedAt = Date.parse(record.startedAt);
  if (!Number.isFinite(startedAt)) return true;
  return Date.now() - startedAt > ttlMs;
}

function writeLock(lockPath, record) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const handle = fs.openSync(lockPath, "wx");
  try {
    fs.writeFileSync(handle, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  } finally {
    fs.closeSync(handle);
  }
}

function tryCreate(lockPath, record) {
  try {
    writeLock(lockPath, record);
    return true;
  } catch (error) {
    if (error?.code === "EEXIST") return false;
    fail(`Failed to create lock ${lockPath}: ${error.message}`);
    return false;
  }
}

function emit(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function acquire(lockPath, ttlMs, sessionRef) {
  const holderToken = crypto.randomUUID();
  const record = {
    holderToken,
    sessionRef: sessionRef ?? null,
    host: os.hostname(),
    startedAt: new Date().toISOString()
  };

  if (tryCreate(lockPath, record)) {
    emit({ ok: true, outcome: "acquired", lock: lockPath, ...record });
    return 0;
  }

  const existing = readLock(lockPath);
  if (!lockIsStale(existing, ttlMs)) {
    emit({ ok: false, outcome: "busy", lock: lockPath, holder: existing ?? null });
    return 1;
  }

  // Stale: drop and race once for the creation. Losing that race is a normal outcome.
  try {
    fs.rmSync(lockPath, { force: true });
  } catch {
    /* Another process may have removed it already; the retry below decides. */
  }
  if (!tryCreate(lockPath, record)) {
    emit({ ok: false, outcome: "busy", lock: lockPath, holder: readLock(lockPath) ?? null });
    return 1;
  }
  // Confirm we still own what is on disk: a concurrent reclaimer could have
  // replaced our record between create and verify.
  const confirmed = readLock(lockPath);
  if (confirmed?.holderToken !== holderToken) {
    emit({ ok: false, outcome: "busy", lock: lockPath, holder: confirmed ?? null });
    return 1;
  }
  emit({ ok: true, outcome: "acquired_after_stale", lock: lockPath, reclaimedFrom: existing ?? null, ...record });
  return 0;
}

function requireToken(values) {
  const token = values.token;
  if (typeof token !== "string" || token.trim() === "") fail("--token is required for this command", 2);
  return token;
}

function mutateOwned(lockPath, token, mutate) {
  const existing = readLock(lockPath);
  if (!existing) {
    emit({ ok: false, outcome: "not_held", lock: lockPath });
    return 1;
  }
  if (existing.holderToken !== token) {
    emit({ ok: false, outcome: "token_mismatch", lock: lockPath, holder: existing });
    return 1;
  }
  return mutate(existing);
}

function refresh(lockPath, token) {
  return mutateOwned(lockPath, token, existing => {
    const next = { ...existing, startedAt: new Date().toISOString() };
    fs.writeFileSync(lockPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    emit({ ok: true, outcome: "refreshed", lock: lockPath, ...next });
    return 0;
  });
}

function release(lockPath, token) {
  return mutateOwned(lockPath, token, existing => {
    fs.rmSync(lockPath, { force: true });
    emit({ ok: true, outcome: "released", lock: lockPath, releasedFrom: existing });
    return 0;
  });
}

function status(lockPath, ttlMs) {
  const existing = readLock(lockPath);
  emit({
    ok: true,
    outcome: existing ? "held" : "free",
    lock: lockPath,
    holder: existing ?? null,
    stale: existing ? lockIsStale(existing, ttlMs) : false
  });
  return 0;
}

function main(argv) {
  const { command, values } = parseArgs(argv);
  if (!command || command === "help" || command === "--help") usage(command ? 0 : 1);
  const lockPath = path.resolve(values.lock ?? DEFAULT_LOCK);
  const ttlMinutes = values["ttl-minutes"] === undefined ? DEFAULT_TTL_MINUTES : Number(values["ttl-minutes"]);
  if (!Number.isFinite(ttlMinutes) || ttlMinutes <= 0) fail("--ttl-minutes must be a positive number");
  const ttlMs = ttlMinutes * 60 * 1000;

  if (command === "acquire") return acquire(lockPath, ttlMs, values["session-ref"]);
  if (command === "refresh") return refresh(lockPath, requireToken(values));
  if (command === "release") return release(lockPath, requireToken(values));
  if (command === "status") return status(lockPath, ttlMs);
  usage(1);
  return 2;
}

process.exit(main(process.argv.slice(2)));
