#!/usr/bin/env node
/**
 * BCR foreground-dependence timeline harness (read-only).
 *
 * Records, with timestamps, everything the AUTO continuation chain leaves
 * observable from outside the extension:
 *   - page lifecycle: visibilitychange / pagehide / pageshow / freeze / resume
 *     (plus blur/focus), with document.visibilityState
 *   - provider observations: every `noos:runtime-observation` event the content
 *     script already publishes (carrier state, execution instance identity,
 *     carrier ref, source epoch, message counts, quietSince)
 *   - durable state: chrome.storage.local run store + submission operations +
 *     submission authority, read at ~1s resolution
 *   - service-worker identity: the extension SW CDP target id, read from
 *     /json/list (attach-free, so it does not itself keep the SW awake)
 *
 * It changes no extension code and sends no provider message. Message counts
 * only: conversation content is never recorded.
 *
 * KNOWN GAPS (declared, not silently ignored):
 *   - evaluator request start/end is not directly observable; it can only be
 *     bracketed by the EVALUATING interval in the durable timeline.
 *   - `issueRunGo()` invocation is only observable when it leaves a trace
 *     (dispatch claim / operation row); a bail inside issueRunGo leaves none.
 *   - freeze/resume are recorded only if the browser emits them.
 *   - the durable store is read from the service worker by default. Attaching a
 *     debugger keeps an MV3 worker alive, so use `--durable page` when
 *     observing SW wake/restart behaviour itself. SW identity from /json/list
 *     stays valid in both modes.
 *
 * Usage:
 *   node scripts/bcr-bg-timeline.mjs --tab 6aa8bd9a --tab 6aab8aaa \
 *     --seconds 150 [--durable sw|page|auto] [--out file.jsonl]
 */

import { writeFileSync, appendFileSync } from "node:fs";

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback;
};
const TABS = args.reduce((acc, a, i) => (a === "--tab" ? [...acc, args[i + 1]] : acc), []);
const SECONDS = Number(argValue("seconds", 120));
const PORT = process.env.CDP_PORT || argValue("port", "9229");
const OUT = argValue("out", "");
const POLL_MS = Number(argValue("poll", 500));
const DURABLE_MODE = argValue("durable", "auto");
const CALL_TIMEOUT_MS = Number(argValue("timeout", 4000));
const HEARTBEAT_MS = Number(argValue("heartbeat", 15000));

if (TABS.length === 0) {
  console.error("usage: node scripts/bcr-bg-timeline.mjs --tab <url-or-title-substring> [--tab ...] [--seconds 120] [--out file.jsonl] [--durable sw|page|auto]");
  process.exit(1);
}

const startedAt = Date.now();
const startedIso = new Date(startedAt).toISOString();
const rows = [];
const emit = (row) => {
  const merged = { t: new Date().toISOString(), dt: +((Date.now() - startedAt) / 1000).toFixed(1), ...row };
  rows.push(merged);
  const detail = Object.entries(merged)
    .filter(([k]) => k !== "t" && k !== "dt" && k !== "src")
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  console.log(`+${String(merged.dt).padStart(6)}s [${merged.src}] ${detail}`);
  if (OUT) appendFileSync(OUT, `${JSON.stringify(merged)}\n`);
};

const listTargets = async () => {
  const response = await fetch(`http://127.0.0.1:${PORT}/json/list`, { signal: AbortSignal.timeout(CALL_TIMEOUT_MS) });
  return response.json();
};

// Every await in the loop is bounded: a throttled renderer, a vanished target,
// or a half-open socket must not be able to stop the capture.
function connect(wsUrl, timeoutMs = CALL_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const contexts = [];
    const alive = () => ws.readyState === 1;
    const timer = setTimeout(() => {
      try { ws.close(); } catch { /* never opened */ }
      reject(new Error(`connect timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    const api = {
      contexts,
      send(method, params = {}, sendTimeoutMs = 0) {
        const msgId = ++id;
        if (!alive()) return Promise.reject(new Error("socket not open"));
        ws.send(JSON.stringify({ id: msgId, method, params }));
        return new Promise((res, rej) => {
          const sendTimer = sendTimeoutMs > 0
            ? setTimeout(() => { pending.delete(msgId); rej(new Error(`timeout after ${sendTimeoutMs}ms`)); }, sendTimeoutMs)
            : null;
          pending.set(msgId, {
            res: (v) => { if (sendTimer) clearTimeout(sendTimer); res(v); },
            rej: (e) => { if (sendTimer) clearTimeout(sendTimer); rej(e); }
          });
        });
      },
      close: () => { try { ws.close(); } catch { /* already gone */ } }
    };
    ws.onopen = () => { clearTimeout(timer); resolve(api); };
    ws.onerror = e => { clearTimeout(timer); reject(new Error(`ws error: ${e.message || e}`)); };
    ws.onclose = () => {
      for (const { rej } of pending.values()) rej(new Error("socket closed"));
      pending.clear();
    };
    ws.onmessage = ev => {
      const msg = JSON.parse(ev.data);
      if (msg.method === "Runtime.executionContextCreated") contexts.push(msg.params.context);
      if (msg.method === "Runtime.executionContextDestroyed") {
        const gone = contexts.findIndex(c => c.id === msg.params.executionContextId);
        if (gone >= 0) contexts.splice(gone, 1);
      }
      if (msg.method === "Runtime.executionContextsCleared") contexts.length = 0;
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      }
    };
  });
}

// Page-world recorder: lifecycle + the content script's existing observation event.
const INSTALL = `
(() => {
  if (window.__noosTimelineInstalled) return "already";
  window.__noosTimelineInstalled = true;
  window.__noosTimeline = [];
  const push = (kind, extra) => {
    const row = Object.assign({ at: Date.now(), kind, visibility: document.visibilityState, hidden: document.hidden }, extra || {});
    window.__noosTimeline.push(row);
    if (window.__noosTimeline.length > 6000) window.__noosTimeline.splice(0, 2000);
  };
  for (const name of ["visibilitychange", "pagehide", "pageshow", "freeze", "resume", "blur", "focus", "beforeunload", "unload"]) {
    window.addEventListener(name, () => push(name), true);
    document.addEventListener(name, () => push("doc:" + name), true);
  }
  window.addEventListener("pageshow", e => push("pageshow_detail", { persisted: e.persisted }), true);
  window.addEventListener("noos:runtime-observation", e => {
    const d = e.detail || {};
    push("observation", {
      state: d.state,
      carrier: d.carrierRef,
      exec: d.executionInstanceRef,
      epoch: d.sourceEpoch,
      conv: (d.providerConversationRef || "").slice(0, 8),
      users: d.userMessageCount,
      assistants: d.assistantMessageCount,
      quietSince: d.quietSince,
      observedAt: d.observedAt,
      routeStable: d.routeStable,
      stopCtl: d.stopGenerationControlPresent,
      mutating: d.assistantOutputMutating
    });
  }, true);
  return "installed";
})()`;

const DRAIN = `JSON.stringify((window.__noosTimeline || []).splice(0, 5000))`;

// Durable read. Callback form (not `awaitPromise`) so a dead world that never
// settles its promise still returns: the expression itself completes.
const STORAGE = `new Promise(resolve => chrome.storage.local.get(["noosContinuationRunStore","noosSubmissionOperations","noosSubmissionAuthority"], v => resolve(JSON.stringify({
  runs: Object.values((v.noosContinuationRunStore || {}).activeByConversation || {}).map(r => ({ id: r.runId, conv: (r.providerConversationRef||"").slice(0,8), mode: r.mode, status: r.status, phase: r.phase, consumed: r.consumedContinuations, max: r.maxContinuations, pendingOp: r.pendingSubmissionOperationId || null, acceptedOp: r.acceptedOperationId || null, updatedAt: r.updatedAt })),
  ended: Object.values((v.noosContinuationRunStore || {}).ended || []).length,
  ops: (Array.isArray(v.noosSubmissionOperations) ? v.noosSubmissionOperations : Object.values(v.noosSubmissionOperations || {})).map(o => ({ op: o.operationId, state: o.state, conv: (o.providerConversationRef||"").slice(0,8), thread: o.logicalThreadId, carrier: o.targetCarrierRef, claimedAt: o.dispatchClaimedAt || null })),
  authority: v.noosSubmissionAuthority ? { thread: v.noosSubmissionAuthority.logicalThreadId, conv: (v.noosSubmissionAuthority.providerConversationRef||"").slice(0,8), carrier: v.noosSubmissionAuthority.targetCarrierRef, gen: v.noosSubmissionAuthority.authorityGeneration, lease: v.noosSubmissionAuthority.leaseOwnerRef, at: v.noosSubmissionAuthority.authorityEstablishedAt } : null
}))))`;

// A world that answers the typeof probe but never settles a real read is a
// dead/invalidated context -- require an actual read before trusting it.
async function storageContextId(conn, timeoutMs) {
  for (const c of conn.contexts.filter(x => x.auxData?.type === "isolated")) {
    try {
      const probe = await conn.send("Runtime.evaluate", {
        expression: `new Promise(r => { try { chrome.storage.local.get(["noosContinuationRunStore"], v => r(JSON.stringify(v).slice(0,40))) } catch (e) { r("ERR:" + e.message) } })`,
        contextId: c.id,
        returnByValue: true,
        awaitPromise: true
      }, timeoutMs);
      const value = probe.result?.value;
      if (typeof value === "string" && !value.startsWith("ERR")) return c.id;
    } catch { /* stale or throttled world */ }
  }
  return null;
}

const targets = await listTargets();
const pages = targets.filter(t => t.type === "page" && TABS.some(n => t.url.includes(n) || (t.title || "").includes(n)));
if (pages.length === 0) {
  console.error(`no page target matched any of: ${TABS.join(", ")}`);
  process.exit(1);
}

const sessions = [];
for (const page of pages) {
  const conn = await connect(page.webSocketDebuggerUrl);
  await conn.send("Runtime.enable", {}, CALL_TIMEOUT_MS).catch(() => {});
  await new Promise(r => setTimeout(r, 250));
  let install = "?";
  try {
    const res = await conn.send("Runtime.evaluate", { expression: INSTALL, returnByValue: true }, CALL_TIMEOUT_MS);
    install = res.result?.value ?? "?";
  } catch (error) {
    install = `failed:${String(error.message).slice(0, 30)}`;
  }
  sessions.push({ conn, page, ctx: null, ctxCheckedAt: 0, ctxFailures: 0 });
  emit({
    src: "attach",
    tab: page.id.slice(0, 8),
    title: page.title.slice(0, 40),
    install,
    visibility: await currentVisibility(conn)
  });
}

async function currentVisibility(conn) {
  try {
    const r = await conn.send("Runtime.evaluate", { expression: "document.visibilityState", returnByValue: true }, CALL_TIMEOUT_MS);
    return r.result?.value ?? "?";
  } catch { return "?"; }
}

const swIdentity = async () => {
  const now = await listTargets();
  const sw = now.find(t => t.type === "service_worker" && t.url.startsWith("chrome-extension://"));
  return sw ? { key: `${sw.id.slice(0, 8)}:${sw.url.split("/").slice(-1)[0]}`, ws: sw.webSocketDebuggerUrl } : { key: "ASLEEP", ws: null };
};

// CDP reports an in-page throw as a normal result plus `exceptionDetails`, and
// an aborted promise as an Error object -- both must surface as an error here
// rather than being parsed into a silently empty snapshot.
function parseStorageResult(raw) {
  if (raw.exceptionDetails) {
    const text = raw.exceptionDetails.exception?.description || raw.exceptionDetails.text || "exception";
    return { error: `evaluate threw: ${String(text).split("\n")[0].slice(0, 80)}` };
  }
  const value = raw.result?.value;
  if (typeof value !== "string" || value.length === 0) {
    return { error: `evaluate returned no string (type=${raw.result?.type ?? "none"}, subtype=${raw.result?.subtype ?? "-"})` };
  }
  try {
    const snapshot = JSON.parse(value);
    if (!snapshot || typeof snapshot !== "object") return { error: "evaluate returned a non-object snapshot" };
    return { snapshot };
  } catch (error) {
    return { error: `snapshot parse failed: ${String(error).slice(0, 60)}` };
  }
}

// Durable reader. `sw` mode: a short-lived attach per read, which does keep the
// worker alive (declared perturbation). `page` mode: an isolated world, whose
// read latency is subject to the tab's own throttling.
let swConn = null;
let swConnKey = null;
let pageReader = null;
let lastReadError = null;

async function readDurable() {
  lastReadError = null;
  if (DURABLE_MODE !== "page") {
    const sw = await swIdentity();
    if (sw.ws) {
      try {
        if (swConn === null || swConnKey !== sw.key) {
          if (swConn) swConn.close();
          swConn = await connect(sw.ws);
          swConnKey = sw.key;
        }
        const raw = await swConn.send("Runtime.evaluate", { expression: STORAGE, returnByValue: true, awaitPromise: true }, CALL_TIMEOUT_MS);
        const parsed = parseStorageResult(raw);
        if (parsed.error) {
          lastReadError = parsed.error;
          if (DURABLE_MODE === "sw") return { via: `sw:${sw.key}`, error: parsed.error };
        } else {
          return { via: `sw:${sw.key}`, snapshot: parsed.snapshot };
        }
      } catch (error) {
        if (swConn) swConn.close();
        swConn = null;
        swConnKey = null;
        if (DURABLE_MODE === "sw") return { via: "sw", error: lastReadError ?? String(error.message).slice(0, 60) };
      }
    } else if (DURABLE_MODE === "sw") {
      return { via: "sw", error: "ASLEEP" };
    }
  }
  // page fallback: reuse the world that last answered a real read
  const candidates = pageReader ? [pageReader, ...sessions.filter(s => s !== pageReader)] : sessions;
  for (const s of candidates) {
    if (s.ctx === null && Date.now() - s.ctxCheckedAt < 10_000) continue;
    if (s.ctx === null) {
      s.ctxCheckedAt = Date.now();
      s.ctx = await storageContextId(s.conn, CALL_TIMEOUT_MS);
      if (s.ctx === null) continue;
    }
    try {
      const raw = await s.conn.send("Runtime.evaluate", { expression: STORAGE, contextId: s.ctx, returnByValue: true, awaitPromise: true }, CALL_TIMEOUT_MS);
      const parsed = parseStorageResult(raw);
      if (parsed.error) {
        s.ctx = null;
        s.ctxFailures += 1;
        if (pageReader === s) pageReader = null;
        lastReadError = parsed.error;
        continue;
      }
      pageReader = s;
      return { via: `page:${s.page.id.slice(0, 8)}/isolated:${s.ctx}`, snapshot: parsed.snapshot };
    } catch (error) {
      s.ctx = null;
      s.ctxFailures += 1;
      if (pageReader === s) pageReader = null;
    }
  }
  return { via: "page", error: lastReadError ?? "no readable storage world" };
}

const diffDurable = (before, after, via) => {
  const runOf = (snap, id) => (snap.runs || []).find(r => r.id === id);
  for (const run of after.runs || []) {
    const prev = runOf(before, run.id);
    const changed = [];
    if (!prev) changed.push("run_created");
    else {
      if (prev.phase !== run.phase) changed.push(`phase ${prev.phase}->${run.phase}`);
      if (prev.consumed !== run.consumed) changed.push(`consumed ${prev.consumed}->${run.consumed}`);
      if (prev.pendingOp !== run.pendingOp) changed.push(`pendingOp ${prev.pendingOp ?? "-"}->${run.pendingOp ?? "-"}`);
      if (prev.status !== run.status) changed.push(`status ${prev.status}->${run.status}`);
    }
    if (changed.length === 0) continue;
    emit({
      src: "durable",
      via,
      run: run.id,
      conv: run.conv,
      mode: run.mode,
      changed: changed.join(", "),
      phase: run.phase,
      status: run.status,
      consumed: `${run.consumed}/${run.max}`,
      pendingOp: run.pendingOp ?? "-",
      acceptedOp: run.acceptedOp ?? "-"
    });
  }
  for (const run of before.runs || []) {
    if (!runOf(after, run.id)) emit({ src: "durable", via, run: run.id, conv: run.conv, changed: "run_gone", phase: run.phase });
  }
  const beforeOps = new Map((before.ops || []).map(o => [o.op, o.state]));
  for (const op of after.ops || []) {
    const prev = beforeOps.get(op.op);
    if (prev === undefined) emit({ src: "durable", via, event: "op_created", op: op.op, state: op.state, conv: op.conv, carrier: op.carrier });
    else if (prev !== op.state) emit({ src: "durable", via, event: "op_state", op: op.op, from: prev, to: op.state, conv: op.conv });
  }
  if (JSON.stringify(before.authority) !== JSON.stringify(after.authority)) {
    emit({
      src: "durable",
      via,
      event: "authority_change",
      thread: after.authority?.thread ?? "-",
      conv: after.authority?.conv ?? "-",
      carrier: after.authority?.carrier ?? "-",
      gen: after.authority?.gen ?? "-"
    });
  }
};

let lastSw = null;
let lastDurable = null;
let lastDurableVia = null;
let durableReads = 0;
let durableFails = 0;
let drains = 0;
let drainFails = 0;
let lastHeartbeat = startedAt;
let seenRunIds = new Set();
let seenOpIds = new Set();
let lastPhaseByRun = new Map();
const deadline = startedAt + SECONDS * 1000;

while (Date.now() < deadline) {
  const sw = await swIdentity();
  if (sw.key !== lastSw) {
    emit({ src: "sw", event: lastSw === null ? "observed" : "identity_changed", identity: sw.key });
    lastSw = sw.key;
  }

  // Page lifecycle / observation rows. Concurrent and timeout-bounded, so a
  // throttled tab adds at most CALL_TIMEOUT_MS to the iteration.
  await Promise.all(sessions.map(async (s) => {
    try {
      const drained = await s.conn.send("Runtime.evaluate", { expression: DRAIN, returnByValue: true }, CALL_TIMEOUT_MS);
      const parsed = JSON.parse(drained.result?.value || "[]");
      drains += 1;
      for (const row of parsed) emit({ src: "page", tab: s.page.id.slice(0, 8), ...row });
    } catch (error) {
      drainFails += 1;
      const message = String(error.message || error);
      if (drainFails <= 3 || drainFails % 20 === 0) {
        emit({ src: "page", tab: s.page.id.slice(0, 8), error: `drain failed: ${message.slice(0, 50)}`, cumulative_failures: drainFails });
      }
    }
  }));

  const read = await readDurable();
  durableReads += 1;
  if (read.error) {
    durableFails += 1;
    if (durableFails <= 3 || durableFails % 20 === 0) {
      emit({ src: "durable", via: read.via, error: read.error, cumulative_failures: durableFails });
    }
  } else if (read.snapshot) {
    const key = JSON.stringify(read.snapshot);
    if (key !== lastDurable) {
      if (lastDurable !== null) {
        diffDurable(JSON.parse(lastDurable), read.snapshot, read.via);
      } else {
        for (const run of read.snapshot.runs || []) {
          emit({
            src: "durable", via: read.via, event: "baseline", run: run.id, conv: run.conv, mode: run.mode,
            status: run.status, phase: run.phase, consumed: `${run.consumed}/${run.max}`, pendingOp: run.pendingOp ?? "-"
          });
        }
        for (const op of (read.snapshot.ops || []).filter(o => ["PREPARED", "DISPATCHING", "UNCERTAIN", "OBSERVED_ACCEPTED"].includes(o.state))) {
          emit({ src: "durable", via: read.via, event: "open_op", op: op.op, state: op.state, conv: op.conv, carrier: op.carrier });
        }
        if (read.snapshot.authority) {
          emit({
            src: "durable", via: read.via, event: "authority", thread: read.snapshot.authority.thread,
            conv: read.snapshot.authority.conv, carrier: read.snapshot.authority.carrier, gen: read.snapshot.authority.gen
          });
        }
      }
      lastDurable = key;
      lastDurableVia = read.via;
    }
    for (const run of read.snapshot.runs || []) {
      seenRunIds.add(run.id);
      lastPhaseByRun.set(run.id, `${run.phase}/${run.status}/${run.consumed}`);
    }
    for (const op of read.snapshot.ops || []) seenOpIds.add(op.op);
  }

  if (Date.now() - lastHeartbeat >= HEARTBEAT_MS) {
    lastHeartbeat = Date.now();
    emit({
      src: "heartbeat",
      durable_via: lastDurableVia ?? "-",
      durable_reads: durableReads,
      durable_failures: durableFails,
      drains,
      drain_failures: drainFails,
      runs: seenRunIds.size,
      ops: seenOpIds.size,
      phases: [...lastPhaseByRun.entries()].slice(0, 4).map(([id, p]) => `${id.slice(0, 8)}=${p}`).join(" ")
    });
  }

  await new Promise(r => setTimeout(r, POLL_MS));
}

emit({
  src: "summary",
  seconds: SECONDS,
  rows: rows.length,
  startedAt: startedIso,
  durable_reads: durableReads,
  durable_failures: durableFails,
  drains,
  drain_failures: drainFails,
  runs_seen: seenRunIds.size,
  ops_seen: seenOpIds.size,
  sw_identity: lastSw ?? "-"
});
if (OUT) writeFileSync(OUT, rows.map(r => JSON.stringify(r)).join("\n") + "\n");
for (const s of sessions) s.conn.close();
if (swConn) swConn.close();
process.exit(0);
