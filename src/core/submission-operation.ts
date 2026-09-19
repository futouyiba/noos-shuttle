/** Durable transport-only SubmissionOperation ledger. Persist PREPARED before provider actuation. */
export type SubmissionOperationKind = "GO" | "REANCHOR_GOAL" | "BOOTSTRAP" | "REVIEW_DISPATCH" | "SEDIMENT" | "DELIVER_CHILD_RESULT";
export type SubmissionOperationState = "PREPARED" | "DISPATCHING" | "OBSERVED_ACCEPTED" | "COMPLETED" | "UNCERTAIN" | "FAILED_SAFE" | "CANCELLED";
export interface SubmissionBaseline { conversationRef?: string; routeRef: string; assistantMessageCount: number; userMessageCount: number; lastUserMessageFingerprint?: string; lastAssistantMessageFingerprint?: string; headFingerprint?: string; observedAt: number; }
export interface SubmissionObservation extends Omit<SubmissionBaseline, "observedAt"> {
  observedAt?: number;
  sourceEpoch: number;
  generationActive?: boolean;
  stableSince?: number;
  providerFailure?: boolean;
  dispatchFence?: SubmissionDispatchFence;
}
export interface SubmissionDispatchReceipt {
  claimedAt: number;
  attemptedAt: number;
  outcome: "dispatched" | "uncertain";
  fence: SubmissionDispatchFence;
}
export interface SubmissionDispatchFence { providerConversationRef: string; bindingEpoch: number; leaseGeneration: number; leaseOwnerRef: string; targetCarrierRef: string; }
export interface SubmissionOperation { operationId: string; operationKind: SubmissionOperationKind; workItemId: string; logicalThreadId: string; targetCarrierRef: string; providerConversationRef?: string; dispatchFence?: SubmissionDispatchFence; payloadFingerprint: string; payload?: string; parentEpoch?: number; preSubmitBaseline: SubmissionBaseline; state: SubmissionOperationState; createdAt: number; lastObservedAt: number; dispatchClaimedAt?: number; dispatchReceipt?: SubmissionDispatchReceipt; lastReconciliationEvidence?: SubmissionObservation; resultingTurnRef?: string; error?: string; /** Fingerprint of the user message that proved acceptance, stamped when reconciliation first establishes OBSERVED_ACCEPTED; survives later evidence overwrites. */ acceptedPayloadFingerprint?: string; }
export interface SubmissionClaimContext extends SubmissionDispatchFence {
  logicalThreadId: string;
  carrierState: "READY";
  logicalControl: "CONTINUE";
  explicitGo: boolean;
  sourceEpoch: number;
  sourceObservedAt: number;
}
export interface SubmissionAuthority extends SubmissionClaimContext {
  authorityGeneration: number;
  authorityEstablishedAt: number;
}
/**
 * Per-thread authority slots, keyed by logicalThreadId. One Run holds and renews
 * only its own slot, so an unrelated conversation's GO can no longer supersede it.
 * INVARIANT: every key equals its own value's logicalThreadId.
 */
export type SubmissionAuthorityMap = Record<string, SubmissionAuthority>;
export type SubmissionOperationMutation =
  | { type: "list" }
  | { type: "initialize_authority"; context: SubmissionClaimContext }
  | { type: "recover"; operationId: string; context: SubmissionClaimContext; now: number }
  | { type: "prepare"; input: Omit<SubmissionOperation, "operationId" | "state" | "createdAt" | "lastObservedAt"> & { operationId: string; now?: number } }
  | { type: "claim"; operationId: string; context: SubmissionClaimContext; now: number }
  | { type: "retarget"; operationId: string; context: SubmissionClaimContext; baseline: SubmissionBaseline; now: number }
  | { type: "record"; operationId: string; state: SubmissionOperationState; details: { now?: number; error?: string; resultingTurnRef?: string; dispatchReceipt?: SubmissionDispatchReceipt } }
  | { type: "rearm"; operationId: string; baseline: SubmissionBaseline; fence: SubmissionDispatchFence; now: number }
  | { type: "reconcile"; operationId: string; observation: SubmissionObservation };
/**
 * `authority` is the authority gate's verdict. It is present on every result
 * returned from the point the gate is evaluated, and absent on results that
 * return earlier (unknown operation; a state that no longer owns execution, so
 * the Run's fate is already decided). ABSENT is diagnostic only and must never
 * drive a fail-safe: under per-thread keying an operation that reached
 * DISPATCHING has a slot for its own thread and nothing deletes one, so an
 * absent slot carries no evidence of real loss. The one exception predates that
 * keying — the flat-to-map migration folds a legacy global slot under its own
 * thread alone, stranding an operation whose slot was taken before the upgrade
 * on ABSENT with no re-acquisition path. That case wedges identically before
 * the change, so it is recorded rather than wired to a trigger; the firing
 * policy lives in content/submission-authority-loss.ts.
 *
 * `sameFence` is present on every SUPERSEDED result and states whether the
 * operation's durable dispatch fence still equals the fence the caller observed.
 * SUPERSEDED alone cannot tell a real loss from a sibling carrier's benign
 * re-fence: `recover` rewrites `operation.dispatchFence` while also rotating the
 * slot, so a page that lost the race to its own sibling observes SUPERSEDED for
 * an operation that is still valid. In that case the durable fence carries the
 * sibling's `leaseOwnerRef` and `sameFence` is false. `true` means the slot moved
 * behind an otherwise untouched operation — nothing re-fenced it, so the caller's
 * claim really is gone.
 */
export type SubmissionReconcileResult = { outcome: "PROVEN_ACCEPTED" | "PROVEN_NOT_ACCEPTED" | "STILL_AMBIGUOUS"; authority?: "OK" | "ABSENT" | "SUPERSEDED"; sameFence?: boolean; operation?: SubmissionOperation };
export interface SubmissionOperationStore {
  get(key?: string): Promise<unknown>;
  set(value: Record<string, unknown>): Promise<unknown>;
  getAuthority?: (logicalThreadId: string) => Promise<SubmissionAuthority | undefined>;
  ensureAuthority?: (context: SubmissionClaimContext) => Promise<void>;
  recover?: (operationId: string, context: SubmissionClaimContext, now: number) => Promise<SubmissionOperation | undefined>;
  dispatch?: (mutation: SubmissionOperationMutation) => Promise<unknown>;
  atomicUpdate?: <T>(mutator: (records: SubmissionOperation[]) => Promise<{ records: SubmissionOperation[]; result: T }> | { records: SubmissionOperation[]; result: T }) => Promise<T>;
}
export interface SubmissionOperationRuntime { sendMessage(message: unknown): Promise<unknown>; }
export interface ChromeSubmissionStoreOptions {
  /** Set false for the background coordinator itself to avoid sending a message to itself. */
  claimViaCoordinator?: boolean;
  runtime?: SubmissionOperationRuntime;
  lock?: <T>(work: () => Promise<T>) => Promise<T>;
}
export const SUBMISSION_OPERATIONS_KEY = "noosSubmissionOperations";
export const SUBMISSION_OPERATIONS_REVISION_KEY = "noosSubmissionOperationsRevision";
export const SUBMISSION_AUTHORITY_KEY = "noosSubmissionAuthority";
export const SUBMISSION_STABLE_WINDOW_MS = 2_000;
const terminalStates = new Set<SubmissionOperationState>(["COMPLETED", "FAILED_SAFE", "CANCELLED"]);
const executionOwningStates = new Set<SubmissionOperationState>(["DISPATCHING", "UNCERTAIN", "OBSERVED_ACCEPTED"]);

export class SubmissionOperationLedger {
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly store: SubmissionOperationStore) {}
  async list(): Promise<SubmissionOperation[]> { const value = await this.store.get(SUBMISSION_OPERATIONS_KEY); const records = value && typeof value === "object" ? (value as Record<string, unknown>)[SUBMISSION_OPERATIONS_KEY] : undefined; return Array.isArray(records) ? records.filter(isSubmissionOperation).map(cloneOperation) : []; }
  async get(operationId: string): Promise<SubmissionOperation | undefined> { return (await this.list()).find(item => item.operationId === operationId); }
  async prepare(input: Omit<SubmissionOperation, "operationId" | "state" | "createdAt" | "lastObservedAt"> & { operationId: string; now?: number }): Promise<SubmissionOperation> {
    if (!isStableOperationId(input.operationId)) throw new Error("operation_id_required");
    if (!isPrepareInput(input)) {
      // Preserve create-or-get conflict semantics for an existing operation,
      // while still rejecting a new GO whose payload fingerprint is wrong.
      if (isPrepareInput(input, { checkPayloadFingerprint: false })) {
        const operationId = (input as { operationId: string }).operationId;
        const existing = await this.get(operationId);
        if (existing && !sameOperationIdentity(existing, input)) {
          throw new Error(`operation_id_reuse_conflict:${operationId}`);
        }
      }
      throw new Error("submission_prepare_invalid");
    }
    if (this.store.dispatch) {
      const result = await this.store.dispatch({ type: "prepare", input });
      if (!isSubmissionOperation(result)) throw new Error("submission_prepare_unavailable");
      return cloneOperation(result);
    }
    return this.mutate(records => { const operationId = input.operationId; const existing = records.find(item => item.operationId === operationId); if (existing) { if (!sameOperationIdentity(existing, input)) throw new Error(`operation_id_reuse_conflict:${operationId}`); return { records, result: existing }; } const now = input.now ?? Date.now(); const operation: SubmissionOperation = { operationId, operationKind: input.operationKind, workItemId: input.workItemId, logicalThreadId: input.logicalThreadId, targetCarrierRef: input.targetCarrierRef, providerConversationRef: input.providerConversationRef, dispatchFence: input.dispatchFence, payloadFingerprint: input.payloadFingerprint, payload: input.payload, parentEpoch: input.parentEpoch, preSubmitBaseline: { ...input.preSubmitBaseline }, state: "PREPARED", createdAt: now, lastObservedAt: now }; return { records: [...records, operation], result: operation }; });
  }
  /** Persisted claim; only the caller that changes PREPARED to DISPATCHING may actuate. */
  async claim(operationId: string, context: SubmissionClaimContext, now = Date.now()): Promise<SubmissionOperation | undefined> {
    if (!isValidClaimContext(context)) return undefined;
    if (this.store.dispatch) return this.store.dispatch({ type: "claim", operationId, context, now }) as Promise<SubmissionOperation | undefined>;
    return this.mutate(async records => {
      const operation = records.find(item => item.operationId === operationId);
      const authority = operation && this.store.getAuthority ? await this.store.getAuthority(operation.logicalThreadId) : undefined;
      if (!operation || operation.state !== "PREPARED" || !isValidClaimContext(context) || !authority || !sameClaimAuthority(authority, context) || !matchesDispatchFence(operation, context)) return { records, result: undefined };
      const active = records.find(item => item.operationId !== operationId && sameExecutionTarget(item, context) && executionOwningStates.has(item.state));
      if (active) return { records, result: undefined };
      operation.state = "DISPATCHING"; operation.dispatchClaimedAt = now; operation.lastObservedAt = now;
      return { records, result: operation };
    });
  }
  async initializeAuthority(context: SubmissionClaimContext): Promise<void> {
    if (!isValidClaimContext(context)) throw new Error("submission_authority_invalid");
    if (!this.store.ensureAuthority) throw new Error("submission_authority_unavailable");
    await this.store.ensureAuthority(context);
  }
  /**
   * Re-fence a PREPARED (never claimed) or FAILED_SAFE (proven not accepted)
   * operation after its destination rolled over: the delivery identity is
   * stable, but the conversation, carrier, generations, and pre-submit baseline
   * move to the newly authoritative context. Guards mirror claim — valid
   * context, matching durable authority, retargetable state — plus a monotonic
   * now. A FAILED_SAFE re-fence is a fresh attempt: claim, receipt, evidence,
   * stamp, and error clear as the state returns to PREPARED (FAILED_SAFE
   * already proved the previous attempt was not accepted). Execution-owning
   * and terminal states refuse: they keep recover/rearm semantics.
   */
  async retarget(operationId: string, context: SubmissionClaimContext, baseline: SubmissionBaseline, now = Date.now()): Promise<SubmissionOperation | undefined> {
    if (!isValidClaimContext(context) || !isBaselineValue(baseline) || !Number.isSafeInteger(now) || now < 0) return undefined;
    if (baseline.conversationRef !== undefined && baseline.conversationRef !== context.providerConversationRef) return undefined;
    if (this.store.dispatch) return this.store.dispatch({ type: "retarget", operationId, context, baseline, now }) as Promise<SubmissionOperation | undefined>;
    return this.mutate(async records => {
      const operation = records.find(item => item.operationId === operationId);
      const authority = operation && this.store.getAuthority ? await this.store.getAuthority(operation.logicalThreadId) : undefined;
      const retargetable = operation?.state === "PREPARED" || operation?.state === "FAILED_SAFE";
      if (!operation || !retargetable || !authority || !sameClaimAuthority(authority, context) ||
        // The operation never changes logical threads: a context from another
        // thread must not retarget it (mirrors recover's fence check).
        operation.logicalThreadId !== context.logicalThreadId) return { records, result: undefined };
      if (operation.state === "FAILED_SAFE" && sameDispatchFence(operation.dispatchFence, context)) {
        // Lane separation: a same-fence FAILED_SAFE reset must go through
        // rearm (with its evidence-sameness contract), not retarget.
        return { records, result: undefined };
      }
      if (now < operation.lastObservedAt) return { records, result: undefined };
      if (operation.state === "FAILED_SAFE") {
        // Fresh-attempt semantics: the not-accepted proof belonged to the old
        // destination's attempt, not to the delivery identity.
        operation.state = "PREPARED";
        operation.dispatchClaimedAt = undefined;
        operation.dispatchReceipt = undefined;
        operation.lastReconciliationEvidence = undefined;
        operation.acceptedPayloadFingerprint = undefined;
        operation.error = undefined;
      }
      operation.providerConversationRef = context.providerConversationRef;
      operation.targetCarrierRef = context.targetCarrierRef;
      operation.dispatchFence = {
        providerConversationRef: context.providerConversationRef,
        bindingEpoch: context.bindingEpoch,
        leaseGeneration: context.leaseGeneration,
        leaseOwnerRef: context.leaseOwnerRef,
        targetCarrierRef: context.targetCarrierRef
      };
      operation.preSubmitBaseline = { ...baseline };
      operation.lastObservedAt = now;
      return { records, result: operation };
    });
  }
  async recover(operationId: string, context: SubmissionClaimContext, now = Date.now()): Promise<SubmissionOperation | undefined> {
    if (!isValidClaimContext(context) || !Number.isSafeInteger(now) || now < 0) return undefined;
    if (this.store.recover) return this.store.recover(operationId, context, now);
    if (this.store.dispatch) return this.store.dispatch({ type: "recover", operationId, context, now }) as Promise<SubmissionOperation | undefined>;
    if (this.store.ensureAuthority) await this.store.ensureAuthority(context);
    return this.mutate(async records => {
      const operation = records.find(item => item.operationId === operationId);
      const authority = operation && this.store.getAuthority ? await this.store.getAuthority(operation.logicalThreadId) : undefined;
      if (!operation || !authority || !executionOwningStates.has(operation.state) ||
        !sameClaimAuthority(authority, context) ||
        !sameRecoveryFence(operation, context)) {
        return { records, result: undefined };
      }
      operation.dispatchFence = { ...context };
      if (operation.dispatchReceipt) {
        operation.dispatchReceipt = { ...operation.dispatchReceipt, fence: { ...context } };
      }
      if (now >= operation.lastObservedAt) operation.lastObservedAt = now;
      return { records, result: operation };
    });
  }
  async record(operationId: string, state: SubmissionOperationState, details: { now?: number; error?: string; resultingTurnRef?: string; dispatchReceipt?: SubmissionDispatchReceipt } = {}): Promise<SubmissionOperation | undefined> {
    if (state === "FAILED_SAFE" || state === "OBSERVED_ACCEPTED") return undefined;
    if (this.store.dispatch) return this.store.dispatch({ type: "record", operationId, state, details }) as Promise<SubmissionOperation | undefined>;
    return this.mutate(records => {
      const operation = records.find(item => item.operationId === operationId);
      if (!operation) return { records, result: undefined };
      const now = details.now ?? Date.now();
      if (details.dispatchReceipt !== undefined && !isReceiptForOperation(operation, details.dispatchReceipt)) {
        return { records, result: operation };
      }
      if (details.dispatchReceipt !== undefined && details.dispatchReceipt.attemptedAt > now) {
        return { records, result: operation };
      }
      if (details.dispatchReceipt !== undefined && operation.dispatchReceipt &&
        details.dispatchReceipt.attemptedAt < operation.dispatchReceipt.attemptedAt) {
        return { records, result: operation };
      }
      if (details.dispatchReceipt?.outcome === "uncertain" &&
        operation.dispatchReceipt?.outcome === "dispatched") {
        return { records, result: operation };
      }
      // The provider actuation and the observation loop race each other. A
      // successful dispatch receipt may arrive after reconciliation advanced
      // the operation to UNCERTAIN/OBSERVED_ACCEPTED. In that case attach the
      // receipt without attempting to move the state backwards.
      const receiptOnlyAttach = details.dispatchReceipt !== undefined &&
        state === "DISPATCHING" &&
        executionOwningStates.has(operation.state) &&
        operation.state !== "DISPATCHING";
      if (!Number.isSafeInteger(now) || (!receiptOnlyAttach && now < operation.lastObservedAt)) return { records, result: operation };
      if (!receiptOnlyAttach && !isAllowedTransition(operation.state, state)) return { records, result: operation };
      if (state === "COMPLETED" && !isCompletionEvidence(operation)) return { records, result: undefined };
      if (!receiptOnlyAttach) operation.state = state;
      if (!receiptOnlyAttach) operation.lastObservedAt = now;
      if (details.error !== undefined) operation.error = details.error;
      if (details.resultingTurnRef !== undefined) operation.resultingTurnRef = details.resultingTurnRef;
      if (details.dispatchReceipt !== undefined) operation.dispatchReceipt = { ...details.dispatchReceipt, fence: { ...details.dispatchReceipt.fence } };
      return { records, result: operation };
    });
  }
  /** Re-arm only after explicit proven-not-accepted evidence and a fresh baseline. */
  async rearm(operationId: string, baseline: SubmissionBaseline, fence: SubmissionDispatchFence, now = Date.now()): Promise<SubmissionOperation | undefined> {
    if (!isBaselineValue(baseline) || !isDispatchFenceValue(fence)) return undefined;
    if (this.store.dispatch) return this.store.dispatch({ type: "rearm", operationId, baseline, fence, now }) as Promise<SubmissionOperation | undefined>;
    return this.mutate(async records => {
      const operation = records.find(item => item.operationId === operationId);
      const authority = operation && this.store.getAuthority ? await this.store.getAuthority(operation.logicalThreadId) : undefined;
      const evidence = operation?.lastReconciliationEvidence;
      if (!operation || operation.state !== "FAILED_SAFE" || !authority ||
        !sameClaimAuthority(authority, {
          ...fence,
          logicalThreadId: operation.logicalThreadId,
          carrierState: "READY",
          logicalControl: "CONTINUE",
          explicitGo: true,
          sourceEpoch: authority.sourceEpoch,
          sourceObservedAt: authority.sourceObservedAt
        }) ||
        !sameDispatchFence(operation.dispatchFence, fence) ||
        !evidence ||
        evidence.generationActive !== false ||
        !sameDispatchFence(evidence.dispatchFence, operation.dispatchFence) ||
        evidence.conversationRef !== operation.providerConversationRef ||
        !sameReconciliationBaseline(evidence, operation.preSubmitBaseline) ||
        !sameReconciliationBaseline(evidence, baseline) ||
        baseline.conversationRef !== operation.providerConversationRef ||
        baseline.routeRef !== operation.preSubmitBaseline.routeRef ||
        baseline.observedAt <= (evidence.observedAt ?? operation.lastObservedAt) ||
        now < baseline.observedAt) {
        return { records, result: operation };
      }
      operation.preSubmitBaseline = { ...baseline }; operation.state = "PREPARED"; operation.lastObservedAt = now; operation.error = undefined; operation.lastReconciliationEvidence = undefined; operation.acceptedPayloadFingerprint = undefined;
      return { records, result: operation };
    });
  }
  async reconcile(operationId: string, observation: SubmissionObservation): Promise<SubmissionReconcileResult> {
    if (this.store.dispatch) return this.store.dispatch({ type: "reconcile", operationId, observation }) as Promise<SubmissionReconcileResult>;
    return this.mutate<SubmissionReconcileResult>(async records => {
      const operation = records.find(item => item.operationId === operationId);
      if (!operation) return { records, result: { outcome: "STILL_AMBIGUOUS" as const } };

      // Reconciliation is only meaningful for an operation that owns (or owned)
      // execution. Terminal states are immutable and cannot be revived by stale
      // observations from a page or worker that outlived the operation.
      if (!executionOwningStates.has(operation.state)) return { records, result: { outcome: "STILL_AMBIGUOUS" as const, operation: cloneOperation(operation) } };

      // Whether the operation still carries the fence this caller dispatched
      // under. Hoisted above the gate so the SUPERSEDED verdict can report it:
      // the gate compares the slot against the observation, which is equally
      // false for a rotated slot (a real loss) and for an operation a sibling
      // carrier re-fenced through recover (not a loss — that sibling is now its
      // actuator). Only the durable fence tells the two apart.
      const sameFence = Boolean(observation.dispatchFence && operation.dispatchFence &&
        sameDispatchFence(observation.dispatchFence, operation.dispatchFence));

      // Split the gate's previously collapsed situations into a diagnosis the
      // caller can act on. The predicate is unchanged; what moved is which slot
      // is read — getAuthority is now keyed by the operation's own thread, so an
      // unrelated conversation can no longer trip the thread clause.
      const authority = this.store.getAuthority ? await this.store.getAuthority(operation.logicalThreadId) : undefined;
      if (!authority) {
        return { records, result: { outcome: "STILL_AMBIGUOUS" as const, authority: "ABSENT" as const, operation: cloneOperation(operation) } };
      }
      if (authority.logicalThreadId !== operation.logicalThreadId || !observation.dispatchFence ||
        !sameClaimAuthority(authority, {
          ...observation.dispatchFence,
          logicalThreadId: authority.logicalThreadId,
          carrierState: "READY",
          logicalControl: "CONTINUE",
          explicitGo: true,
          sourceEpoch: observation.sourceEpoch,
          sourceObservedAt: authority.sourceObservedAt
        })) {
        // The slot exists but no longer matches this operation's observation.
        // Within one thread authority only ever moves forward (ensureAuthority
        // refuses a non-newer context), so this cannot heal by waiting.
        return { records, result: { outcome: "STILL_AMBIGUOUS" as const, authority: "SUPERSEDED" as const, sameFence, operation: cloneOperation(operation) } };
      }

      const baseline = operation.preSubmitBaseline;
      const claimedAt = operation.dispatchClaimedAt;
      const observationTime = observation.observedAt;
      const lastEvidenceTime = operation.lastReconciliationEvidence?.observedAt;
      if (claimedAt === undefined || observationTime === undefined || observationTime <= claimedAt ||
        observationTime <= operation.lastObservedAt ||
        (lastEvidenceTime !== undefined && observationTime <= lastEvidenceTime) ||
        !sameFence) {
        return { records, result: { outcome: "STILL_AMBIGUOUS" as const, authority: "OK" as const, operation: cloneOperation(operation) } };
      }
      const sameConversation = typeof operation.providerConversationRef === "string" && typeof observation.conversationRef === "string" && operation.providerConversationRef === observation.conversationRef;
      const sameRoute = observation.routeRef === baseline.routeRef;
      const changed = fingerprintsChanged(observation, baseline);
      const payloadMatched = operation.operationKind !== "GO" ||
        observation.lastUserMessageFingerprint === operation.payloadFingerprint;
      const accepted = observation.generationActive !== undefined && sameConversation && sameRoute &&
        payloadMatched &&
        (observation.userMessageCount > baseline.userMessageCount || observation.assistantMessageCount > baseline.assistantMessageCount || changed);
      const unchanged = sameConversation && sameRoute && observation.userMessageCount === baseline.userMessageCount && observation.assistantMessageCount === baseline.assistantMessageCount && !changed;
      const nextState: SubmissionOperationState = accepted
        ? "OBSERVED_ACCEPTED"
        : unchanged && observation.generationActive === false &&
          (observation.providerFailure === true || (
            operation.dispatchReceipt?.outcome === "dispatched" &&
            isStableAfterClaim(observation, claimedAt)
          ))
          ? "FAILED_SAFE"
          : "UNCERTAIN";
      if (operation.state === "OBSERVED_ACCEPTED") {
        if (!sameConversation || !sameRoute || !payloadMatched) {
          return { records, result: { outcome: "STILL_AMBIGUOUS" as const, authority: "OK" as const, operation: cloneOperation(operation) } };
        }
        operation.lastObservedAt = observationTime;
        operation.lastReconciliationEvidence = cloneObservation(observation);
        if (observation.lastUserMessageFingerprint === operation.payloadFingerprint) {
          operation.acceptedPayloadFingerprint = observation.lastUserMessageFingerprint;
        }
        return { records, result: { outcome: "PROVEN_ACCEPTED" as const, authority: "OK" as const, operation: cloneOperation(operation) } };
      }
      if (!isAllowedTransition(operation.state, nextState)) return { records, result: { outcome: "STILL_AMBIGUOUS" as const, authority: "OK" as const, operation: cloneOperation(operation) } };
      operation.lastObservedAt = observation.observedAt ?? Date.now();
      operation.lastReconciliationEvidence = cloneObservation(observation);
      operation.state = nextState;
      if (nextState === "OBSERVED_ACCEPTED" && observation.lastUserMessageFingerprint === operation.payloadFingerprint) {
        // Stamp the acceptance proof: later legitimate user messages will
        // overwrite lastReconciliationEvidence, but acceptance is durable.
        operation.acceptedPayloadFingerprint = observation.lastUserMessageFingerprint;
      }
      return {
        records,
        result: {
          outcome: nextState === "OBSERVED_ACCEPTED" ? "PROVEN_ACCEPTED" as const : nextState === "FAILED_SAFE" ? "PROVEN_NOT_ACCEPTED" as const : "STILL_AMBIGUOUS" as const,
          authority: "OK" as const,
          operation: cloneOperation(operation)
        }
      };
    });
  }
  private async mutate<T>(mutator: (records: SubmissionOperation[]) => Promise<{ records: SubmissionOperation[]; result: T }> | { records: SubmissionOperation[]; result: T }): Promise<T> {
    const work = async (records: SubmissionOperation[]) => {
      const outcome = await mutator(records);
      await this.store.set({ [SUBMISSION_OPERATIONS_KEY]: outcome.records });
      return outcome;
    };
    if (this.store.atomicUpdate) return this.serialized(() => this.store.atomicUpdate!(mutator)).then(cloneMutationResult);
    return this.serialized(async () => cloneMutationResult((await work(await this.list())).result));
  }
  private async serialized<T>(work: () => Promise<T>): Promise<T> { const previous = this.queue; let release!: () => void; this.queue = new Promise(resolve => { release = resolve; }); await previous; try { return await work(); } finally { release(); } }
}
export function createChromeSubmissionStore(chromeStorage: { get(key: string): Promise<unknown>; set(value: Record<string, unknown>): Promise<unknown> }, options: ChromeSubmissionStoreOptions = {}): SubmissionOperationStore {
  const runtime = options.runtime ?? globalThis.chrome?.runtime;
  const base: SubmissionOperationStore = {
    get: key => chromeStorage.get(key ?? SUBMISSION_OPERATIONS_KEY),
    set: value => chromeStorage.set(value),
    getAuthority: async logicalThreadId => extractAuthorityMap(await chromeStorage.get(SUBMISSION_AUTHORITY_KEY))[logicalThreadId],
    ensureAuthority: async context => withSubmissionAuthorityLock(options.lock, async () => {
      const authorities = extractAuthorityMap(await chromeStorage.get(SUBMISSION_AUTHORITY_KEY));
      const existing = authorities[context.logicalThreadId];
      const now = context.sourceObservedAt;
      // Only this thread's slot is judged and written. Every other thread's
      // entry is rewritten verbatim, so a GO here cannot unseat a GO there.
      if (!existing) {
        await chromeStorage.set({
          [SUBMISSION_AUTHORITY_KEY]: {
            ...authorities,
            [context.logicalThreadId]: {
              ...context,
              authorityGeneration: 1,
              authorityEstablishedAt: now
            }
          }
        });
        return;
      }
      if (sameClaimAuthority(existing, context)) return;
      if (!isNewerAuthorityContext(context, existing)) throw new Error("submission_authority_stale");
      await chromeStorage.set({
        [SUBMISSION_AUTHORITY_KEY]: {
          ...authorities,
          [context.logicalThreadId]: {
            ...context,
            authorityGeneration: existing.authorityGeneration + 1,
            authorityEstablishedAt: now
          }
        }
      });
    })
  };
  if (options.claimViaCoordinator === false || !runtime?.sendMessage) {
    return {
      ...base,
      recover: async (operationId, context, now) => withSubmissionAuthorityLock(options.lock, async () => {
        // Scoped to this context's own thread. Writing the whole map back with
        // only this key replaced is what keeps every other thread's entry alive;
        // writing nextAuthority wholesale would silently delete them and the map
        // would un-fix itself on the first page reload.
        const authorities = extractAuthorityMap(await chromeStorage.get(SUBMISSION_AUTHORITY_KEY));
        const existingAuthority = authorities[context.logicalThreadId];
        const raw = await chromeStorage.get(SUBMISSION_OPERATIONS_KEY);
        const records = extractRecords(raw);
        const operation = records.find(item => item.operationId === operationId);
        if (!operation || !existingAuthority || !executionOwningStates.has(operation.state) ||
          !isNewerOrSameAuthorityContext(context, existingAuthority) ||
          !sameRecoveryFence(operation, context)) return undefined;
        const nextAuthority: SubmissionAuthority = {
          ...context,
          authorityGeneration: sameClaimAuthority(existingAuthority, context)
            ? existingAuthority.authorityGeneration
            : existingAuthority.authorityGeneration + 1,
          authorityEstablishedAt: context.sourceObservedAt
        };
        operation.dispatchFence = { ...context };
        if (operation.dispatchReceipt) {
          operation.dispatchReceipt = { ...operation.dispatchReceipt, fence: { ...context } };
        }
        if (now >= operation.lastObservedAt) operation.lastObservedAt = now;
        const revisionRaw = await chromeStorage.get(SUBMISSION_OPERATIONS_REVISION_KEY);
        await chromeStorage.set({
          [SUBMISSION_AUTHORITY_KEY]: { ...authorities, [context.logicalThreadId]: nextAuthority },
          [SUBMISSION_OPERATIONS_KEY]: records,
          [SUBMISSION_OPERATIONS_REVISION_KEY]: extractNumber(revisionRaw) + 1
        });
        return cloneOperation(operation);
      }),
      atomicUpdate: async mutator => withSubmissionAuthorityLock(options.lock, async () => {
        const raw = await chromeStorage.get(SUBMISSION_OPERATIONS_KEY);
        const records = extractRecords(raw);
        const outcome = await mutator(records);
        const revisionRaw = await chromeStorage.get(SUBMISSION_OPERATIONS_REVISION_KEY);
        const revision = extractNumber(revisionRaw);
        await chromeStorage.set({
          [SUBMISSION_OPERATIONS_KEY]: outcome.records,
          [SUBMISSION_OPERATIONS_REVISION_KEY]: revision + 1
        });
        return outcome.result;
      })
    };
  }
  return {
    ...base,
    dispatch: async mutation => {
      try {
        const response = await runtime.sendMessage({ type: "NOOS_SUBMISSION_MUTATION", mutation });
        if (!response || typeof response !== "object" || (response as { ok?: unknown }).ok !== true) return undefined;
        return (response as { result?: unknown }).result;
      } catch {
        // A missing or restarting service worker cannot safely mutate the ledger.
        return undefined;
      }
    }
  };
}
function extractRecords(value: unknown): SubmissionOperation[] {
  const records = value && typeof value === "object" ? (value as Record<string, unknown>)[SUBMISSION_OPERATIONS_KEY] : undefined;
  return Array.isArray(records) ? records.filter(isSubmissionOperation).map(cloneOperation) : [];
}
function extractNumber(value: unknown): number {
  const candidate = value && typeof value === "object" ? (value as Record<string, unknown>)[SUBMISSION_OPERATIONS_REVISION_KEY] : value;
  return typeof candidate === "number" && Number.isSafeInteger(candidate) && candidate >= 0 ? candidate : 0;
}
async function withSubmissionAuthorityLock<T>(injectedLock: ChromeSubmissionStoreOptions["lock"], work: () => Promise<T>): Promise<T> {
  if (injectedLock) return injectedLock(work);
  const locks = globalThis.navigator?.locks;
  if (!locks) throw new Error("submission_authority_unavailable");
  return locks.request("noos-submission-operation-authority", { mode: "exclusive" }, work);
}
function cloneMutationResult<T>(result: T): T {
  if (result && typeof result === "object") {
    if (isSubmissionOperation(result)) return cloneOperation(result) as T;
    if ("outcome" in result && typeof result === "object") {
      const value = result as { operation?: unknown };
      return { ...value, operation: isSubmissionOperation(value.operation) ? cloneOperation(value.operation) : value.operation } as T;
    }
  }
  return result;
}
function fingerprintsChanged(observation: SubmissionObservation, baseline: SubmissionBaseline): boolean {
  return (observation.headFingerprint !== undefined && baseline.headFingerprint !== undefined && observation.headFingerprint !== baseline.headFingerprint) ||
    (observation.lastUserMessageFingerprint !== undefined && baseline.lastUserMessageFingerprint !== undefined && observation.lastUserMessageFingerprint !== baseline.lastUserMessageFingerprint) ||
    (observation.lastAssistantMessageFingerprint !== undefined && baseline.lastAssistantMessageFingerprint !== undefined && observation.lastAssistantMessageFingerprint !== baseline.lastAssistantMessageFingerprint);
}
function isAllowedTransition(from: SubmissionOperationState, to: SubmissionOperationState): boolean { if (from === to) return true; if (terminalStates.has(from)) return false; if (from === "PREPARED") return to === "CANCELLED"; if (from === "DISPATCHING") return ["OBSERVED_ACCEPTED", "UNCERTAIN", "FAILED_SAFE", "CANCELLED"].includes(to); if (from === "OBSERVED_ACCEPTED") return ["COMPLETED", "UNCERTAIN"].includes(to); if (from === "UNCERTAIN") return ["OBSERVED_ACCEPTED", "FAILED_SAFE", "CANCELLED"].includes(to); return false; }
export function isSubmissionOperation(value: unknown): value is SubmissionOperation {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<SubmissionOperation>;
  return isStableOperationId(item.operationId) &&
    isSubmissionOperationKind(item.operationKind) &&
    typeof item.workItemId === "string" && item.workItemId.length > 0 &&
    typeof item.logicalThreadId === "string" && item.logicalThreadId.length > 0 &&
    typeof item.targetCarrierRef === "string" && item.targetCarrierRef.length > 0 &&
    (item.providerConversationRef === undefined || (typeof item.providerConversationRef === "string" && item.providerConversationRef.length > 0)) &&
    (item.dispatchFence === undefined || isDispatchFenceValue(item.dispatchFence)) &&
    typeof item.payloadFingerprint === "string" && item.payloadFingerprint.length > 0 &&
    (item.payload === undefined || typeof item.payload === "string") &&
    (item.parentEpoch === undefined || (Number.isSafeInteger(item.parentEpoch) && item.parentEpoch >= 0)) &&
    isSubmissionOperationState(item.state) &&
    isBaselineValue(item.preSubmitBaseline) &&
    typeof item.createdAt === "number" && Number.isSafeInteger(item.createdAt) && item.createdAt >= 0 &&
    typeof item.lastObservedAt === "number" && Number.isSafeInteger(item.lastObservedAt) && item.lastObservedAt >= 0 &&
    (item.dispatchClaimedAt === undefined || (Number.isSafeInteger(item.dispatchClaimedAt) && item.dispatchClaimedAt >= 0)) &&
    (item.dispatchReceipt === undefined || isDispatchReceiptValue(item.dispatchReceipt)) &&
    (item.lastReconciliationEvidence === undefined || isObservationValue(item.lastReconciliationEvidence)) &&
    (item.resultingTurnRef === undefined || typeof item.resultingTurnRef === "string") &&
    (item.acceptedPayloadFingerprint === undefined || (typeof item.acceptedPayloadFingerprint === "string" && item.acceptedPayloadFingerprint.length > 0)) &&
    (item.error === undefined || typeof item.error === "string");
}
function cloneOperation(operation: SubmissionOperation): SubmissionOperation { return { ...operation, preSubmitBaseline: { ...operation.preSubmitBaseline } }; }
function cloneObservation(observation: SubmissionObservation): SubmissionObservation {
  return {
    ...observation,
    dispatchFence: observation.dispatchFence ? { ...observation.dispatchFence } : undefined
  };
}
function isStableOperationId(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/.test(value); }
function isClaimContextValue(value: unknown): value is SubmissionClaimContext {
  if (!value || typeof value !== "object") return false;
  const context = value as Partial<SubmissionClaimContext>;
  return isValidClaimContext(context as SubmissionClaimContext);
}
function isAuthorityValue(value: unknown): value is SubmissionAuthority {
  if (!isClaimContextValue(value)) return false;
  const authority = value as SubmissionAuthority;
  return Number.isSafeInteger(authority.authorityGeneration) && authority.authorityGeneration > 0 &&
    Number.isSafeInteger(authority.authorityEstablishedAt) && authority.authorityEstablishedAt >= 0;
}
/**
 * Normalizes the stored authority value into a per-thread map.
 *
 * A map is read per key, not all-or-nothing: one unrecognizable entry must not
 * poison every other thread's slot. An entry whose key disagrees with its own
 * logicalThreadId is dropped, so a corrupt or misplaced record can never answer
 * for a thread it does not name.
 *
 * A legacy flat record (the pre-map shape, one browser-global slot) is folded
 * forward under its own thread. Tolerating that shape is load-bearing: a strict
 * read would leave an operation dispatched before this change unable to
 * reconcile until the next GO re-ensured authority — the very wedge that
 * per-thread scoping removes.
 */
function foldAuthorityMap(value: unknown): SubmissionAuthorityMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  // The flat shape is checked first. A map can never satisfy isAuthorityValue
  // (it carries none of the claim context's typed fields), so the two branches
  // cannot be confused.
  if (isAuthorityValue(value)) return { [value.logicalThreadId]: value };
  const folded: SubmissionAuthorityMap = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (isAuthorityValue(entry) && entry.logicalThreadId === key) folded[key] = entry;
  }
  return folded;
}
function extractAuthorityMap(raw: unknown): SubmissionAuthorityMap {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>)[SUBMISSION_AUTHORITY_KEY] : undefined;
  return foldAuthorityMap(value);
}
function isSubmissionOperationKind(value: unknown): value is SubmissionOperationKind { return value === "GO" || value === "REANCHOR_GOAL" || value === "BOOTSTRAP" || value === "REVIEW_DISPATCH" || value === "SEDIMENT" || value === "DELIVER_CHILD_RESULT"; }
function isSubmissionOperationState(value: unknown): value is SubmissionOperationState { return value === "PREPARED" || value === "DISPATCHING" || value === "OBSERVED_ACCEPTED" || value === "COMPLETED" || value === "UNCERTAIN" || value === "FAILED_SAFE" || value === "CANCELLED"; }
function isBaselineValue(value: unknown): value is SubmissionBaseline {
  if (!value || typeof value !== "object") return false;
  const baseline = value as Partial<SubmissionBaseline>;
  return typeof baseline.routeRef === "string" &&
    typeof baseline.assistantMessageCount === "number" && Number.isSafeInteger(baseline.assistantMessageCount) && baseline.assistantMessageCount >= 0 &&
    typeof baseline.userMessageCount === "number" && Number.isSafeInteger(baseline.userMessageCount) && baseline.userMessageCount >= 0 &&
    Number.isSafeInteger(baseline.observedAt) &&
    (baseline.conversationRef === undefined || typeof baseline.conversationRef === "string") &&
    (baseline.lastUserMessageFingerprint === undefined || typeof baseline.lastUserMessageFingerprint === "string") &&
    (baseline.lastAssistantMessageFingerprint === undefined || typeof baseline.lastAssistantMessageFingerprint === "string") &&
    (baseline.headFingerprint === undefined || typeof baseline.headFingerprint === "string");
}
function isPrepareInput(
  value: unknown,
  options: { checkPayloadFingerprint?: boolean } = {}
): value is Omit<SubmissionOperation, "state" | "createdAt" | "lastObservedAt"> & { now?: number } {
  if (!value || typeof value !== "object") return false;
  const input = value as Partial<SubmissionOperation> & { now?: unknown };
  return isStableOperationId(input.operationId) &&
    isSubmissionOperationKind(input.operationKind) &&
    typeof input.workItemId === "string" && input.workItemId.length > 0 &&
    typeof input.logicalThreadId === "string" && input.logicalThreadId.length > 0 &&
    typeof input.targetCarrierRef === "string" && input.targetCarrierRef.length > 0 &&
    typeof input.providerConversationRef === "string" && input.providerConversationRef.length > 0 &&
    isDispatchFenceValue(input.dispatchFence) &&
    input.dispatchFence.providerConversationRef === input.providerConversationRef &&
    input.dispatchFence.targetCarrierRef === input.targetCarrierRef &&
    typeof input.payloadFingerprint === "string" && input.payloadFingerprint.length > 0 &&
    (input.payload === undefined || typeof input.payload === "string") &&
    (options.checkPayloadFingerprint === false ||
      input.operationKind !== "GO" && input.payload === undefined ||
      typeof input.payload === "string" && fingerprintSubmissionPayload(input.payload) === input.payloadFingerprint) &&
    (input.parentEpoch === undefined || (Number.isSafeInteger(input.parentEpoch) && input.parentEpoch >= 0)) &&
    isBaselineValue(input.preSubmitBaseline) &&
    (input.now === undefined || (typeof input.now === "number" && Number.isSafeInteger(input.now) && input.now >= 0));
}
export function fingerprintSubmissionPayload(value: string): string {
  let hash = 0;
  const normalized = value.replace(/\s+/g, " ").trim().slice(0, 2000);
  for (let index = 0; index < normalized.length; index += 1) hash = (hash * 31 + normalized.charCodeAt(index)) >>> 0;
  return hash.toString(16);
}
function isObservationValue(value: unknown): value is SubmissionObservation {
  if (!value || typeof value !== "object") return false;
  const observation = value as SubmissionObservation;
  return isBaselineValue({ ...observation, observedAt: observation.observedAt ?? -1 }) &&
    Number.isSafeInteger(observation.sourceEpoch) && observation.sourceEpoch >= 0 &&
    (observation.observedAt === undefined || (Number.isSafeInteger(observation.observedAt) && observation.observedAt >= 0)) &&
    (observation.generationActive === undefined || typeof observation.generationActive === "boolean") &&
    (observation.stableSince === undefined || (Number.isSafeInteger(observation.stableSince) && observation.stableSince >= 0)) &&
    (observation.providerFailure === undefined || typeof observation.providerFailure === "boolean") &&
    isDispatchFenceValue(observation.dispatchFence);
}
function isDispatchReceiptValue(value: unknown): value is SubmissionDispatchReceipt {
  if (!value || typeof value !== "object") return false;
  const receipt = value as SubmissionDispatchReceipt;
  return Number.isSafeInteger(receipt.claimedAt) && receipt.claimedAt >= 0 &&
    Number.isSafeInteger(receipt.attemptedAt) && receipt.attemptedAt >= receipt.claimedAt &&
    (receipt.outcome === "dispatched" || receipt.outcome === "uncertain") &&
    isDispatchFenceValue(receipt.fence);
}
function isReceiptForOperation(operation: SubmissionOperation, receipt: SubmissionDispatchReceipt): boolean {
  return isDispatchReceiptValue(receipt) &&
    operation.dispatchClaimedAt !== undefined &&
    receipt.claimedAt === operation.dispatchClaimedAt &&
    sameDispatchFence(operation.dispatchFence, receipt.fence);
}
function isDispatchFenceValue(value: unknown): value is SubmissionDispatchFence {
  if (!value || typeof value !== "object") return false;
  const fence = value as Partial<SubmissionDispatchFence>;
  return typeof fence.providerConversationRef === "string" && fence.providerConversationRef.length > 0 &&
    typeof fence.bindingEpoch === "number" && Number.isSafeInteger(fence.bindingEpoch) && fence.bindingEpoch >= 0 &&
    typeof fence.leaseGeneration === "number" && Number.isSafeInteger(fence.leaseGeneration) && fence.leaseGeneration >= 0 &&
    typeof fence.leaseOwnerRef === "string" && fence.leaseOwnerRef.length > 0 &&
    typeof fence.targetCarrierRef === "string" && fence.targetCarrierRef.length > 0;
}
function sameOperationIdentity(existing: SubmissionOperation, input: Omit<SubmissionOperation, "operationId" | "state" | "createdAt" | "lastObservedAt"> & { operationId: string; now?: number }): boolean {
  return existing.operationKind === input.operationKind &&
    existing.workItemId === input.workItemId &&
    existing.logicalThreadId === input.logicalThreadId &&
    existing.targetCarrierRef === input.targetCarrierRef &&
    existing.providerConversationRef === input.providerConversationRef &&
    sameDispatchFence(existing.dispatchFence, input.dispatchFence) &&
    existing.payloadFingerprint === input.payloadFingerprint &&
    existing.payload === input.payload &&
    existing.parentEpoch === input.parentEpoch &&
    sameBaseline(existing.preSubmitBaseline, input.preSubmitBaseline);
}
function sameDispatchFence(left: SubmissionDispatchFence | undefined, right: SubmissionDispatchFence | undefined): boolean {
  return left?.providerConversationRef === right?.providerConversationRef &&
    left?.bindingEpoch === right?.bindingEpoch &&
    left?.leaseGeneration === right?.leaseGeneration &&
    left?.leaseOwnerRef === right?.leaseOwnerRef &&
    left?.targetCarrierRef === right?.targetCarrierRef;
}
function sameRecoveryFence(operation: SubmissionOperation, context: SubmissionClaimContext): boolean {
  return operation.logicalThreadId === context.logicalThreadId &&
    operation.dispatchFence?.providerConversationRef === context.providerConversationRef &&
    operation.dispatchFence.bindingEpoch === context.bindingEpoch &&
    operation.dispatchFence.leaseGeneration === context.leaseGeneration &&
    operation.dispatchFence.targetCarrierRef === context.targetCarrierRef;
}
function sameBaseline(left: SubmissionBaseline, right: SubmissionBaseline): boolean {
  return left.routeRef === right.routeRef &&
    left.assistantMessageCount === right.assistantMessageCount &&
    left.userMessageCount === right.userMessageCount &&
    left.lastUserMessageFingerprint === right.lastUserMessageFingerprint &&
    left.lastAssistantMessageFingerprint === right.lastAssistantMessageFingerprint &&
    left.headFingerprint === right.headFingerprint &&
    left.observedAt === right.observedAt &&
    left.conversationRef === right.conversationRef;
}
function sameReconciliationBaseline(observation: SubmissionObservation, baseline: SubmissionBaseline): boolean {
  return observation.routeRef === baseline.routeRef &&
    observation.assistantMessageCount === baseline.assistantMessageCount &&
    observation.userMessageCount === baseline.userMessageCount &&
    observation.lastUserMessageFingerprint === baseline.lastUserMessageFingerprint &&
    observation.lastAssistantMessageFingerprint === baseline.lastAssistantMessageFingerprint &&
    observation.headFingerprint === baseline.headFingerprint;
}
function isStableAfterClaim(observation: SubmissionObservation, claimedAt: number): boolean {
  return observation.observedAt !== undefined &&
    observation.stableSince !== undefined &&
    observation.observedAt - Math.max(claimedAt, observation.stableSince) >= SUBMISSION_STABLE_WINDOW_MS;
}
function isCompletionEvidence(operation: SubmissionOperation): boolean {
  const evidence = operation.lastReconciliationEvidence;
  return operation.state === "OBSERVED_ACCEPTED" &&
    operation.dispatchClaimedAt !== undefined &&
    evidence !== undefined &&
    evidence.generationActive === false &&
    isStableAfterClaim(evidence, operation.dispatchClaimedAt) &&
    (!["GO", "REANCHOR_GOAL"].includes(operation.operationKind) || evidence.lastUserMessageFingerprint === operation.payloadFingerprint);
}
export function isValidClaimContext(context: SubmissionClaimContext): boolean {
  return context.explicitGo === true &&
    context.carrierState === "READY" &&
    context.logicalControl === "CONTINUE" &&
    typeof context.logicalThreadId === "string" && context.logicalThreadId.length > 0 &&
    isStableOperationId(context.leaseOwnerRef) &&
    typeof context.providerConversationRef === "string" &&
    context.providerConversationRef.length > 0 &&
    Number.isSafeInteger(context.bindingEpoch) && context.bindingEpoch >= 0 &&
    Number.isSafeInteger(context.leaseGeneration) && context.leaseGeneration >= 0 &&
    typeof context.targetCarrierRef === "string" && context.targetCarrierRef.length > 0 &&
    Number.isSafeInteger(context.sourceEpoch) && context.sourceEpoch >= 0 &&
    Number.isSafeInteger(context.sourceObservedAt) && context.sourceObservedAt >= 0;
}
function matchesDispatchFence(operation: SubmissionOperation, context: SubmissionClaimContext): boolean {
  const fence = operation.dispatchFence;
  return Boolean(fence &&
    fence.providerConversationRef === context.providerConversationRef &&
    fence.bindingEpoch === context.bindingEpoch &&
    fence.leaseGeneration === context.leaseGeneration &&
    fence.leaseOwnerRef === context.leaseOwnerRef &&
    fence.targetCarrierRef === context.targetCarrierRef &&
    operation.providerConversationRef === context.providerConversationRef &&
    operation.targetCarrierRef === context.targetCarrierRef);
}
function sameExecutionTarget(operation: SubmissionOperation, context: SubmissionClaimContext): boolean {
  return operation.dispatchFence?.providerConversationRef === context.providerConversationRef &&
    operation.dispatchFence?.bindingEpoch === context.bindingEpoch &&
    operation.dispatchFence?.leaseGeneration === context.leaseGeneration;
}
function sameClaimAuthority(left: SubmissionClaimContext, right: SubmissionClaimContext): boolean {
  return left.logicalThreadId === right.logicalThreadId &&
    left.providerConversationRef === right.providerConversationRef &&
    left.bindingEpoch === right.bindingEpoch &&
    left.leaseGeneration === right.leaseGeneration &&
    left.leaseOwnerRef === right.leaseOwnerRef &&
    left.targetCarrierRef === right.targetCarrierRef &&
    left.sourceEpoch === right.sourceEpoch &&
    left.carrierState === right.carrierState &&
    left.logicalControl === right.logicalControl &&
    left.explicitGo === right.explicitGo;
}
function isNewerAuthorityContext(context: SubmissionClaimContext, existing: SubmissionAuthority): boolean {
  return context.sourceObservedAt > existing.sourceObservedAt ||
    (context.sourceObservedAt === existing.sourceObservedAt && context.sourceEpoch > existing.sourceEpoch);
}
function isNewerOrSameAuthorityContext(context: SubmissionClaimContext, existing: SubmissionAuthority): boolean {
  return context.sourceObservedAt >= existing.sourceObservedAt &&
    (sameClaimAuthority(existing, context) || isNewerAuthorityContext(context, existing));
}
