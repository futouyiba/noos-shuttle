/**
 * Composes the child worker ledger with a provider spawn action into the
 * PLANNED → SPAWNING → BOOTSTRAPPING → ACTIVE path (§5-§6, §16).
 *
 * The intent is persisted before the browser action (§4), so a lost
 * acknowledgement leaves a durable SPAWN_UNCERTAIN record instead of a second
 * child. Reconciliation binds the recovered conversation (§16) or — only when
 * non-creation is proven — cancels. Calling spawn again on an UNCERTAIN child
 * is refused: reconcile first.
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

/** States in which running the spawn again is safe or unnecessary. */
const RESUMABLE_SPAWN_STATES = new Set(["SPAWNING", "BOOTSTRAPPING"]);

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
    try {
      const binding = await deps.adapter.spawn(child);
      child = await deps.children.bindConversation(child.childThreadId, binding);
    } catch (error) {
      if (error instanceof SpawnUncertainError) {
        child = await deps.children.markSpawnUncertain(child.childThreadId);
      }
      throw error;
    }
  }
  return deps.children.activate(child.childThreadId);
}

/**
 * §16 spawn-uncertainty recovery. With a recovered binding, rebind the child
 * (SPAWN_UNCERTAIN/BROKEN → BOOTSTRAPPING); without one — and only when
 * non-creation is proven — cancel the intent. Never spawns again.
 */
export async function reconcileChildSpawn(
  deps: SpawnDependencies,
  childThreadId: string,
  recovered?: SpawnBinding
): Promise<ChildWorkerRecord> {
  const child = await deps.children.get(childThreadId);
  if (!child) throw new Error(`child_thread_not_found:${childThreadId}`);
  if (recovered) {
    return deps.children.bindConversation(childThreadId, recovered);
  }
  if (child.state !== "SPAWN_UNCERTAIN") {
    throw new Error(`spawn_reconcile_requires_uncertain:${child.state}`);
  }
  return deps.children.proveNonCreation(childThreadId);
}
