/**
 * Durable Harness Child Worker lifecycle.
 * Intent (PLANNED) is persisted before any browser fork/spawn, so recovery can
 * reconcile an uncertain spawn instead of blindly creating a second child.
 * See docs: Primary Design + Child Worker Lifecycle v0 §§3-7, 9-16, 19.
 */

export type ChildLifecycleState =
  | "PLANNED"
  | "SPAWNING"
  | "BOOTSTRAPPING"
  | "ACTIVE"
  | "RESULT_READY"
  | "RETURNING"
  | "COMPLETED"
  | "RETIRED"
  | "SPAWN_UNCERTAIN"
  | "BROKEN"
  | "CANCELLED";

export type ChildCreationMode = "FORKED" | "FRESH";
/** Where the child's working context actually comes from (adjudication D2 axis B). */
export type ChildContextSource =
  | "PROVIDER_INHERITED"
  | "DURABLE_CONTEXT_PACK"
  | "TRANSCRIPT_RECONSTRUCTION"
  | "MINIMAL_BOOTSTRAP";
/** The minimum context fidelity the worker's operation contract demands (axis C). */
export type ChildContextFidelity =
  | "INDEPENDENT"
  | "DURABLE_CONTEXT_SUFFICIENT"
  | "TRANSCRIPT_RECONSTRUCTION_REQUIRED"
  | "PROVIDER_INHERITANCE_REQUIRED";

export interface ChildWorkerRecord {
  childThreadId: string;
  parentThreadId: string;
  workItemId: string;
  role: string;
  creationMode: ChildCreationMode;
  contextSource: ChildContextSource;
  contextFidelity: ChildContextFidelity;
  operationGoal: string;
  operationScope: string;
  /** Logical-thread routing ref. Never a raw tabId (§11). */
  returnRoute: string;
  relevantArtifactRefs: string[];
  state: ChildLifecycleState;
  createdAt: number;
  updatedAt: number;
  spawnAttemptedAt?: number;
  providerConversationRef?: string;
  carrierRef?: string;
  resultRef?: string;
  completionReceipt?: string;
  /** Previously bound conversations kept for provenance (§16, §17). */
  supersededConversationRefs?: string[];
}

export interface CreateChildIntentInput {
  childThreadId: string;
  parentThreadId: string;
  workItemId: string;
  role: string;
  creationMode: ChildCreationMode;
  contextSource: ChildContextSource;
  contextFidelity: ChildContextFidelity;
  operationGoal: string;
  operationScope: string;
  returnRoute: string;
  relevantArtifactRefs?: string[];
  now?: number;
}

export interface ChildWorkerStore {
  get(key?: string): Promise<unknown>;
  set(value: Record<string, unknown>): Promise<unknown>;
  atomicUpdate?: <T>(
    mutator: (records: ChildWorkerRecord[]) => Promise<{ records: ChildWorkerRecord[]; result: T }> | { records: ChildWorkerRecord[]; result: T }
  ) => Promise<T>;
}

export const CHILD_WORKERS_KEY = "noosChildWorkers";

const TERMINAL_STATES = new Set<ChildLifecycleState>(["RETIRED", "CANCELLED"]);

/** States that only exist once a conversation is bound to the child (§16). */
const BOUND_STATES = new Set<ChildLifecycleState>(["BOOTSTRAPPING", "ACTIVE", "RESULT_READY", "RETURNING", "COMPLETED", "RETIRED"]);

/** Legal lifecycle edges. Every transition outside this table is a conflict. */
const TRANSITIONS: Record<ChildLifecycleState, ChildLifecycleState[]> = {
  PLANNED: ["SPAWNING", "CANCELLED"],
  SPAWNING: ["BOOTSTRAPPING", "SPAWN_UNCERTAIN", "CANCELLED", "BROKEN"],
  SPAWN_UNCERTAIN: ["BOOTSTRAPPING", "CANCELLED", "BROKEN"],
  BOOTSTRAPPING: ["ACTIVE", "BROKEN", "CANCELLED"],
  ACTIVE: ["RESULT_READY", "BROKEN", "CANCELLED"],
  // §15: a result that needs no return transport may be completed directly.
  RESULT_READY: ["RETURNING", "COMPLETED", "BROKEN", "CANCELLED"],
  RETURNING: ["COMPLETED", "BROKEN", "CANCELLED"],
  COMPLETED: ["RETIRED"],
  RETIRED: [],
  BROKEN: ["BOOTSTRAPPING", "CANCELLED"],
  CANCELLED: []
};

export class ChildWorkerLedger {
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly store: ChildWorkerStore) {}

  async list(): Promise<ChildWorkerRecord[]> {
    const value = await this.store.get(CHILD_WORKERS_KEY);
    const records = value && typeof value === "object" ? (value as Record<string, unknown>)[CHILD_WORKERS_KEY] : undefined;
    return Array.isArray(records) ? records.filter(isChildWorkerRecord).map(cloneRecord) : [];
  }

  async get(childThreadId: string): Promise<ChildWorkerRecord | undefined> {
    return (await this.list()).find(item => item.childThreadId === childThreadId);
  }

  /**
   * Create-or-get. Persisting the intent first (§4) makes spawn idempotent (§19.7):
   * a repeated plan for the same child returns the existing record, while a
   * different parent/role/mode/work item for the same id is a reuse conflict.
   */
  async createIntent(input: CreateChildIntentInput): Promise<ChildWorkerRecord> {
    if (!isCreateChildIntentInput(input)) throw new Error("child_intent_invalid");
    return this.mutate(records => {
      const existing = records.find(item => item.childThreadId === input.childThreadId);
      if (existing) {
        if (!sameChildIdentity(existing, input)) throw new Error(`child_thread_reuse_conflict:${input.childThreadId}`);
        return { records, result: existing };
      }
      const now = input.now ?? Date.now();
      const record: ChildWorkerRecord = {
        childThreadId: input.childThreadId,
        parentThreadId: input.parentThreadId,
        workItemId: input.workItemId,
        role: input.role.trim(),
        creationMode: input.creationMode,
        contextSource: input.contextSource,
        contextFidelity: input.contextFidelity,
        operationGoal: input.operationGoal.trim(),
        operationScope: input.operationScope.trim(),
        returnRoute: input.returnRoute,
        relevantArtifactRefs: [...(input.relevantArtifactRefs ?? [])],
        state: "PLANNED",
        createdAt: now,
        updatedAt: now
      };
      return { records: [...records, record], result: record };
    });
  }

  /** PLANNED → SPAWNING. Records the moment the browser action may have been attempted. */
  async beginSpawn(childThreadId: string, now = Date.now()): Promise<ChildWorkerRecord> {
    return this.transition(childThreadId, "SPAWNING", operation => {
      operation.spawnAttemptedAt = now;
    }, now);
  }

  /** SPAWNING → SPAWN_UNCERTAIN. Acknowledgement was lost; reconcile before re-spawning (§16). */
  async markSpawnUncertain(childThreadId: string, now = Date.now()): Promise<ChildWorkerRecord> {
    return this.transition(childThreadId, "SPAWN_UNCERTAIN", () => undefined, now);
  }

  /**
   * Bind a conversation to the child thread → BOOTSTRAPPING. Covers both spawn
   * reconciliation (§16: bind the recovered child) and carrier replacement
   * (§16/§17: a broken or rolled-over worker keeps its Logical Thread). The
   * previous conversation is preserved as superseded history; the child id is
   * never duplicated.
   */
  async bindConversation(
    childThreadId: string,
    binding: { providerConversationRef: string; carrierRef: string },
    now = Date.now()
  ): Promise<ChildWorkerRecord> {
    if (!isConversationBinding(binding)) throw new Error("child_binding_invalid");
    return this.transition(childThreadId, "BOOTSTRAPPING", operation => {
      if (operation.providerConversationRef && operation.providerConversationRef !== binding.providerConversationRef) {
        const superseded = new Set(operation.supersededConversationRefs ?? []);
        superseded.add(operation.providerConversationRef);
        superseded.delete(binding.providerConversationRef);
        operation.supersededConversationRefs = [...superseded];
      }
      operation.providerConversationRef = binding.providerConversationRef;
      operation.carrierRef = binding.carrierRef;
    }, now);
  }

  /** Only create another child when non-creation is proven (§16). */
  async proveNonCreation(childThreadId: string, now = Date.now()): Promise<ChildWorkerRecord> {
    return this.transition(childThreadId, "CANCELLED", () => undefined, now);
  }

  async activate(childThreadId: string, now = Date.now()): Promise<ChildWorkerRecord> {
    return this.transition(childThreadId, "ACTIVE", () => undefined, now);
  }

  async recordResult(
    childThreadId: string,
    result: { resultRef: string; completionReceipt: string },
    now = Date.now()
  ): Promise<ChildWorkerRecord> {
    if (!isNonEmptyString(result.resultRef) || !isNonEmptyString(result.completionReceipt)) throw new Error("child_result_invalid");
    return this.transition(childThreadId, "RESULT_READY", operation => {
      operation.resultRef = result.resultRef;
      operation.completionReceipt = result.completionReceipt;
    }, now);
  }

  async beginReturn(childThreadId: string, now = Date.now()): Promise<ChildWorkerRecord> {
    return this.transition(childThreadId, "RETURNING", () => undefined, now);
  }

  async complete(childThreadId: string, now = Date.now()): Promise<ChildWorkerRecord> {
    return this.transition(childThreadId, "COMPLETED", () => undefined, now);
  }

  /** RETIRED releases execution but preserves the record for provenance (§15, §19.8). */
  async retire(childThreadId: string, now = Date.now()): Promise<ChildWorkerRecord> {
    return this.transition(childThreadId, "RETIRED", () => undefined, now);
  }

  async markBroken(childThreadId: string, now = Date.now()): Promise<ChildWorkerRecord> {
    return this.transition(childThreadId, "BROKEN", () => undefined, now);
  }

  async cancel(childThreadId: string, now = Date.now()): Promise<ChildWorkerRecord> {
    return this.transition(childThreadId, "CANCELLED", () => undefined, now);
  }

  private async transition(
    childThreadId: string,
    target: ChildLifecycleState,
    apply: (operation: ChildWorkerRecord) => void,
    now: number
  ): Promise<ChildWorkerRecord> {
    if (!isNonEmptyString(childThreadId)) throw new Error("child_thread_id_required");
    return this.mutate(records => {
      const index = records.findIndex(item => item.childThreadId === childThreadId);
      if (index === -1) throw new Error(`child_thread_not_found:${childThreadId}`);
      const current = records[index];
      if (TERMINAL_STATES.has(current.state)) throw new Error(`child_thread_terminal:${current.state}`);
      if (!TRANSITIONS[current.state].includes(target)) throw new Error(`child_transition_invalid:${current.state}->${target}`);
      const operation = cloneRecord(current);
      apply(operation);
      operation.state = target;
      operation.updatedAt = now;
      const nextRecords = records.slice();
      nextRecords[index] = operation;
      return { records: nextRecords, result: operation };
    });
  }

  private async mutate<T>(mutator: (records: ChildWorkerRecord[]) => { records: ChildWorkerRecord[]; result: T }): Promise<T> {
    if (this.store.atomicUpdate) return this.store.atomicUpdate(async records => mutator(records));
    const run = async (): Promise<T> => {
      const raw = await this.store.get(CHILD_WORKERS_KEY);
      const records = extractRecords(raw);
      const { records: nextRecords, result } = mutator(records);
      await this.store.set({ [CHILD_WORKERS_KEY]: nextRecords });
      return result;
    };
    const chained = this.queue.then(run, run);
    this.queue = chained.then(() => undefined, () => undefined);
    return chained;
  }
}

export function createChromeChildWorkerStore(chromeStorage: {
  get(key: string): Promise<unknown>;
  set(value: Record<string, unknown>): Promise<unknown>;
}): ChildWorkerStore {
  return {
    get: key => chromeStorage.get(key ?? CHILD_WORKERS_KEY),
    set: value => chromeStorage.set(value)
  };
}

export function isChildWorkerRecord(value: unknown): value is ChildWorkerRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return isThreadId(record.childThreadId) &&
    isThreadId(record.parentThreadId) &&
    isNonEmptyString(record.workItemId) &&
    isNonEmptyString(record.role) &&
    (record.creationMode === "FORKED" || record.creationMode === "FRESH") &&
    isContextSource(record.contextSource) &&
    isContextFidelity(record.contextFidelity) &&
    isNonEmptyString(record.operationGoal) &&
    isNonEmptyString(record.operationScope) &&
    isReturnRoute(record.returnRoute) &&
    Array.isArray(record.relevantArtifactRefs) && record.relevantArtifactRefs.every(isNonEmptyString) &&
    isChildLifecycleState(record.state) &&
    (!BOUND_STATES.has(record.state) || isNonEmptyString(record.providerConversationRef)) &&
    isFiniteInteger(record.createdAt) &&
    isFiniteInteger(record.updatedAt) &&
    (record.spawnAttemptedAt === undefined || isFiniteInteger(record.spawnAttemptedAt)) &&
    (record.providerConversationRef === undefined || isNonEmptyString(record.providerConversationRef)) &&
    (record.carrierRef === undefined || isNonEmptyString(record.carrierRef)) &&
    (record.resultRef === undefined || isNonEmptyString(record.resultRef)) &&
    (record.completionReceipt === undefined || isNonEmptyString(record.completionReceipt)) &&
    (record.supersededConversationRefs === undefined ||
      (Array.isArray(record.supersededConversationRefs) && record.supersededConversationRefs.every(isNonEmptyString)));
}

/** Structural validator for the wire form of a create-intent mutation. */
export function isCreateChildIntentInput(value: unknown): value is CreateChildIntentInput {
  if (!value || typeof value !== "object") return false;
  const input = value as Record<string, unknown>;
  return isThreadId(input.childThreadId) &&
    isThreadId(input.parentThreadId) &&
    input.childThreadId !== input.parentThreadId &&
    isNonEmptyString(input.workItemId) &&
    isNonEmptyString(input.role) &&
    (input.creationMode === "FORKED" || input.creationMode === "FRESH") &&
    isContextSource(input.contextSource) &&
    isContextFidelity(input.contextFidelity) &&
    isNonEmptyString(input.operationGoal) &&
    isNonEmptyString(input.operationScope) &&
    isReturnRoute(input.returnRoute) &&
    (input.relevantArtifactRefs === undefined ||
      (Array.isArray(input.relevantArtifactRefs) && input.relevantArtifactRefs.every(isNonEmptyString))) &&
    (input.now === undefined || isFiniteInteger(input.now));
}

function sameChildIdentity(existing: ChildWorkerRecord, input: CreateChildIntentInput): boolean {
  return existing.parentThreadId === input.parentThreadId &&
    existing.workItemId === input.workItemId &&
    existing.role === input.role.trim() &&
    existing.creationMode === input.creationMode &&
    existing.contextSource === input.contextSource &&
    existing.contextFidelity === input.contextFidelity &&
    existing.operationGoal === input.operationGoal.trim() &&
    existing.operationScope === input.operationScope.trim() &&
    existing.returnRoute === input.returnRoute;
}

function isConversationBinding(value: unknown): value is { providerConversationRef: string; carrierRef: string } {
  if (!value || typeof value !== "object") return false;
  const binding = value as Record<string, unknown>;
  return isNonEmptyString(binding.providerConversationRef) && isNonEmptyString(binding.carrierRef);
}

function extractRecords(raw: unknown): ChildWorkerRecord[] {
  const records = raw && typeof raw === "object" ? (raw as Record<string, unknown>)[CHILD_WORKERS_KEY] : undefined;
  return Array.isArray(records) ? records.filter(isChildWorkerRecord).map(cloneRecord) : [];
}

function cloneRecord(record: ChildWorkerRecord): ChildWorkerRecord {
  return {
    ...record,
    relevantArtifactRefs: [...record.relevantArtifactRefs],
    supersededConversationRefs: record.supersededConversationRefs ? [...record.supersededConversationRefs] : undefined
  };
}

const CONTEXT_SOURCES: ChildContextSource[] = ["PROVIDER_INHERITED", "DURABLE_CONTEXT_PACK", "TRANSCRIPT_RECONSTRUCTION", "MINIMAL_BOOTSTRAP"];
const CONTEXT_FIDELITIES: ChildContextFidelity[] = ["INDEPENDENT", "DURABLE_CONTEXT_SUFFICIENT", "TRANSCRIPT_RECONSTRUCTION_REQUIRED", "PROVIDER_INHERITANCE_REQUIRED"];

function isContextSource(value: unknown): value is ChildContextSource {
  return typeof value === "string" && (CONTEXT_SOURCES as string[]).includes(value);
}

function isContextFidelity(value: unknown): value is ChildContextFidelity {
  return typeof value === "string" && (CONTEXT_FIDELITIES as string[]).includes(value);
}

function isChildLifecycleState(value: unknown): value is ChildLifecycleState {
  return typeof value === "string" && value in TRANSITIONS;
}

/** Whitelist: a return route must be a logical-thread ref, never a tab/carrier ref (§11, §19.5). */
function isReturnRoute(value: unknown): value is string {
  return typeof value === "string" && /^thread:[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/.test(value);
}

function isThreadId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/.test(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}
