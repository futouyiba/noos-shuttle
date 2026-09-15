/**
 * Composes the child worker ledger with a provider spawn action into the
 * PLANNED → SPAWNING → BOOTSTRAPPING → ACTIVE path (§5-§6, §16).
 *
 * The intent is persisted before the browser action (§4), so a lost
 * acknowledgement leaves a durable record instead of a second child. A
 * SPAWNING child is never re-spawned: recovery goes through
 * reconcileChildSpawn, which binds the recovered conversation or — only when
 * non-creation is proven — cancels. Once the adapter has returned a binding
 * the conversation exists, so even a bind write failure parks the child as
 * SPAWN_UNCERTAIN rather than allowing a retry to spawn again.
 */

import { ChildWorkerLedger, type ChildWorkerRecord, type CreateChildIntentInput } from "./child-worker";

export class SpawnUncertainError extends Error {
  constructor(message = "spawn_acknowledgement_lost") {
    super(message);
    this.name = "SpawnUncertainError";
  }
}

export interface SpawnBinding {
  providerConversationRef: string;
  carrierRef: string;
}

/** Capability facts the adapter reports; it never decides semantic equivalence. */
export interface SpawnAdapterCapabilities {
  supportsNativeFork: boolean;
  transcriptExportAvailable: boolean;
  /** Additional facts may be reported; policy reads them, adapters never conclude. */
  [fact: string]: boolean | string | number;
}

export interface SpawnAdapter {
  /** Reports provider capability facts (adjudication D2, adapters-report-capabilities rule). */
  capabilities: () => SpawnAdapterCapabilities;
  /** Performs the fork/new-conversation browser action (§5). */
  spawn: (child: ChildWorkerRecord) => Promise<SpawnBinding>;
}

export interface SpawnDependencies {
  children: ChildWorkerLedger;
  adapter: SpawnAdapter;
}

/** A resumed run never spawns again; only a fresh PLANNED → SPAWNING run does. */
const RESUMABLE_SPAWN_STATES = new Set(["BOOTSTRAPPING"]);
const RECONCILABLE_STATES = new Set(["SPAWNING", "SPAWN_UNCERTAIN"]);

/** Name-based check also recognises cross-bundle instances of the error class. */
function isSpawnUncertain(error: unknown): boolean {
  return error instanceof SpawnUncertainError || (error as { name?: unknown } | null)?.name === "SpawnUncertainError";
}

/**
 * Conforming-strategy selection (adjudication D2, harness-selects-strategy rule): the child's required
 * fidelity × the adapter's reported capabilities. No conforming strategy is a
 * NEEDS_HUMAN/DEFER refusal — never a silent degradation.
 */
export function selectSpawnStrategy(
  child: Pick<ChildWorkerRecord, "creationMode" | "contextSource" | "contextFidelity">,
  capabilities: SpawnAdapterCapabilities
): { conforming: true } | { conforming: false; reason: string } {
  if (child.creationMode === "FORKED" && !capabilities.supportsNativeFork) {
    return { conforming: false, reason: "spawn_needs_human:native_fork_unavailable" };
  }
  if (child.contextFidelity === "PROVIDER_INHERITANCE_REQUIRED" && child.contextSource !== "PROVIDER_INHERITED") {
    return { conforming: false, reason: "spawn_needs_human:provider_inheritance_unsatisfied" };
  }
  if (child.contextFidelity === "TRANSCRIPT_RECONSTRUCTION_REQUIRED" &&
    child.contextSource !== "TRANSCRIPT_RECONSTRUCTION" && child.contextSource !== "PROVIDER_INHERITED") {
    return { conforming: false, reason: "spawn_needs_human:transcript_reconstruction_unavailable" };
  }
  if (child.contextFidelity === "TRANSCRIPT_RECONSTRUCTION_REQUIRED" &&
    child.contextSource !== "PROVIDER_INHERITED" && !capabilities.transcriptExportAvailable) {
    // Reconstruction needs an exportable transcript; provider inheritance
    // carries the full context directly and needs no export.
    return { conforming: false, reason: "spawn_needs_human:transcript_export_unavailable" };
  }
  if (child.contextFidelity === "DURABLE_CONTEXT_SUFFICIENT" && child.contextSource === "MINIMAL_BOOTSTRAP") {
    // The requirement is a lower bound: a minimal bootstrap cannot satisfy it.
    return { conforming: false, reason: "spawn_needs_human:durable_context_unsatisfied" };
  }
  return { conforming: true };
}

export async function spawnChildWorker(deps: SpawnDependencies, input: CreateChildIntentInput): Promise<ChildWorkerRecord> {
  let child = await deps.children.createIntent(input);
  {
    const strategy = selectSpawnStrategy(input, deps.adapter.capabilities());
    if (!strategy.conforming) throw new Error(strategy.reason);
  }
  if (child.state === "PLANNED") {
    child = await deps.children.beginSpawn(child.childThreadId);
  } else if (child.state === "ACTIVE") {
    return child;
  } else if (!RESUMABLE_SPAWN_STATES.has(child.state)) {
    throw new Error(`spawn_not_resumable:${child.state}`);
  }
  if (child.state === "SPAWNING") {
    let binding: SpawnBinding;
    try {
      binding = await deps.adapter.spawn(child);
    } catch (error) {
      if (isSpawnUncertain(error)) {
        // Preserve the original signal even if parking fails; the record then
        // stays SPAWNING and recovery still goes through reconciliation.
        try {
          await deps.children.markSpawnUncertain(child.childThreadId);
        } catch { /* the original error takes precedence */ }
      }
      throw error;
    }
    try {
      child = await deps.children.bindConversation(child.childThreadId, binding);
    } catch (error) {
      // The conversation was created (the adapter returned a binding), so a
      // retry must never spawn a second one: park as uncertain instead.
      try {
        await deps.children.markSpawnUncertain(child.childThreadId);
      } catch { /* the original error takes precedence */ }
      throw error instanceof Error ? error : new Error("child_bind_failed");
    }
  }
  return deps.children.activate(child.childThreadId);
}

/**
 * §16 spawn-uncertainty recovery. With a recovered binding, rebind the child
 * (SPAWNING/SPAWN_UNCERTAIN/BROKEN → BOOTSTRAPPING); without one — and only
 * when non-creation is proven — cancel the intent. Never spawns again.
 * The no-binding caller carries the burden of proof: it must have established
 * out-of-band (e.g. by listing provider conversations) that the child was not
 * created; this layer cannot verify that.
 */
export async function reconcileChildSpawn(
  children: ChildWorkerLedger,
  childThreadId: string,
  recovered?: SpawnBinding
): Promise<ChildWorkerRecord> {
  const child = await children.get(childThreadId);
  if (!child) throw new Error(`child_thread_not_found:${childThreadId}`);
  if (recovered) {
    return children.bindConversation(childThreadId, recovered);
  }
  if (!RECONCILABLE_STATES.has(child.state)) {
    throw new Error(`spawn_reconcile_requires_uncertain:${child.state}`);
  }
  return children.proveNonCreation(childThreadId);
}
