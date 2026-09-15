/**
 * Browser spawn runtime — two-phase FRESH spawn under activation safety.
 *
 * Phase 1 (request, parent side): validate the intent against the browser
 * adapter's reported capabilities (W12 strategy gating — no conforming
 * strategy is a spawn_needs_human refusal), persist the PLANNED intent, mark
 * SPAWNING, open the tab, and record a durable pending-spawn entry
 * (tabId → childThreadId). The child deliberately stays SPAWNING: a fresh
 * ChatGPT tab has no stable provider conversation identity until the page
 * reports one, and the binding contract forbids fully-automatic activation
 * before stable identity.
 *
 * Phase 2 (adoption, child side): the new tab's content script reports its
 * carrier (tab id) and, once stable, its provider conversation ref. Adoption
 * binds the conversation and activates the child — clearing the pending
 * entry. A tab that reports no stable ref yet (provisional bootstrap) is
 * left unadopted for a later probe; nothing is ever guessed.
 *
 * FORKED spawns are refused at request time (the browser adapter reports
 * supportsNativeFork: false); reconciliation of an uncertain spawn still goes
 * through the reviewed reconcileChildSpawn path.
 */

import { ChildWorkerLedger, type ChildWorkerRecord, type CreateChildIntentInput } from "../core/child-worker";
import { selectSpawnStrategy, type SpawnAdapterCapabilities } from "../core/child-spawn";

/** The real browser adapter's capability facts (adjudication D2: report, never conclude). */
export const BROWSER_SPAWN_CAPABILITIES: SpawnAdapterCapabilities = {
  supportsNativeFork: false,
  transcriptExportAvailable: true
};

export const PENDING_SPAWNS_KEY = "noosPendingSpawns";

interface PendingSpawnStore {
  get(key?: string): Promise<unknown>;
  set(value: Record<string, unknown>): Promise<unknown>;
}

interface PendingSpawnRecord {
  childThreadId: string;
  createdAt: number;
}

async function readPending(store: PendingSpawnStore): Promise<Record<string, PendingSpawnRecord>> {
  const raw = await store.get(PENDING_SPAWNS_KEY);
  const records = raw && typeof raw === "object" ? (raw as Record<string, unknown>)[PENDING_SPAWNS_KEY] : undefined;
  if (!records || typeof records !== "object") return {};
  const valid: Record<string, PendingSpawnRecord> = {};
  for (const [tabId, value] of Object.entries(records as Record<string, unknown>)) {
    const record = value as Record<string, unknown> | null;
    if (record && typeof record === "object" &&
      typeof record.childThreadId === "string" &&
      record.childThreadId.length > 0) {
      valid[tabId] = value as PendingSpawnRecord;
    }
  }
  return valid;
}

export interface BrowserSpawnRequestInput {
  intent: CreateChildIntentInput;
}

/**
 * Phase 1. Returns the SPAWNING child and the opened tab id, or refuses with
 * spawn_needs_human when the strategy does not conform (nothing is opened,
 * the intent stays PLANNED for a human decision).
 */
export async function requestBrowserChildSpawn(
  children: ChildWorkerLedger,
  store: PendingSpawnStore,
  openTab: () => Promise<number>,
  input: BrowserSpawnRequestInput
): Promise<{ child: ChildWorkerRecord; tabId: number }> {
  // Intent first (W12 parity): the durable PLANNED record survives a refusal
  // as the human-decision anchor; the strategy check then gates the browser
  // action itself.
  const child = await children.createIntent(input.intent);
  const strategy = selectSpawnStrategy(input.intent, BROWSER_SPAWN_CAPABILITIES);
  if (!strategy.conforming) throw new Error(strategy.reason);
  if (child.state === "PLANNED") {
    await children.beginSpawn(child.childThreadId, input.intent.now);
  } else if (child.state !== "SPAWNING") {
    // An already-spawned/active child re-requested: nothing to open.
    throw new Error(`spawn_not_resumable:${child.state}`);
  }
  const tabId = await openTab();
  await withPendingLock(async () => {
    const pending = await readPending(store);
    // One live pending per child: a re-request supersedes any earlier tab's
    // entry, so a forgotten first tab can never adopt later.
    for (const key of Object.keys(pending)) {
      if (pending[key].childThreadId === child.childThreadId) delete pending[key];
    }
    pending[String(tabId)] = { childThreadId: child.childThreadId, createdAt: Date.now() };
    await store.set({ [PENDING_SPAWNS_KEY]: pending });
  });
  return { child: (await children.get(child.childThreadId))!, tabId };
}

export interface BrowserSpawnAdoptionInput {
  tabId: number;
  /** Stable provider conversation identity; absent while the tab is still provisional. */
  providerConversationRef?: string;
}

export type AdoptionResult =
  | { status: "ADOPTED"; child: ChildWorkerRecord }
  | { status: "NO_PENDING_SPAWN" }
  | { status: "NEEDS_STABLE_IDENTITY" }
  | { status: "CHILD_NOT_ADOPTABLE"; reason: string };

/**
 * Phase 2. Binds and activates only when the pending entry exists, the child
 * is in a bindable state, and the tab reports a stable conversation ref.
 * Provisional tabs return NEEDS_STABLE_IDENTITY and keep their pending entry
 * for a later probe.
 */
export async function adoptBrowserChildSpawn(
  children: ChildWorkerLedger,
  store: PendingSpawnStore,
  input: BrowserSpawnAdoptionInput
): Promise<AdoptionResult> {
  return withPendingLock(async () => {
    const tabKey = String(input.tabId);
    const pending = await readPending(store);
    const entry = pending[tabKey];
    if (!entry) return { status: "NO_PENDING_SPAWN" } as AdoptionResult;
    const child = await children.get(entry.childThreadId);
    if (!child) {
      delete pending[tabKey];
      await store.set({ [PENDING_SPAWNS_KEY]: pending });
      return { status: "NO_PENDING_SPAWN" } as AdoptionResult;
    }
    if (child.state !== "SPAWNING" && child.state !== "SPAWN_UNCERTAIN" && child.state !== "BROKEN") {
      // Already bound/active/terminal — the pending entry is stale.
      delete pending[tabKey];
      await store.set({ [PENDING_SPAWNS_KEY]: pending });
      return { status: "CHILD_NOT_ADOPTABLE", reason: `child_state:${child.state}` } as AdoptionResult;
    }
    if (!input.providerConversationRef || input.providerConversationRef.trim().length === 0) {
      // Activation safety: never adopt a provisional tab onto a guessed identity.
      return { status: "NEEDS_STABLE_IDENTITY" } as AdoptionResult;
    }
    const bound = await children.bindConversation(entry.childThreadId, {
      providerConversationRef: input.providerConversationRef,
      carrierRef: `browser-tab:${input.tabId}`
    });
    const active = await children.activate(entry.childThreadId);
    delete pending[tabKey];
    await store.set({ [PENDING_SPAWNS_KEY]: pending });
    return { status: "ADOPTED", child: active.state === "ACTIVE" ? active : bound } as AdoptionResult;
  });
}

let pendingMutation: Promise<unknown> = Promise.resolve();

/** Serializes pending-map mutations so interleaved adopts cannot resurrect a
 * consumed entry through a stale read-modify-write. */
function withPendingLock<T>(work: () => Promise<T>): Promise<T> {
  const chained = pendingMutation.then(work, work);
  pendingMutation = chained.then(() => undefined, () => undefined);
  return chained;
}

/** List pending spawns (for reconciliation UIs and probes). */
export async function listPendingSpawns(store: PendingSpawnStore): Promise<Record<string, PendingSpawnRecord>> {
  return readPending(store);
}
