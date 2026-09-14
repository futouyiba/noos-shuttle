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

export interface SpawnAdapter {
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

export async function spawnChildWorker(deps: SpawnDependencies, input: CreateChildIntentInput): Promise<ChildWorkerRecord> {
  let child = await deps.children.createIntent(input);
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
