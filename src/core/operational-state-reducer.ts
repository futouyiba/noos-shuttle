/**
 * Small, storage-agnostic authority boundary for Harness binding and dispatch.
 *
 * The reducer owns the canonical current binding relation. Reverse lookup,
 * lease fencing, and submission claims are derived from the same state and
 * are applied atomically per reducer call.
 */

export type ReducerActor = "system" | "human" | "worker";
export type ReducerErrorCode =
  | "BINDING_EXPECTATION_MISMATCH"
  | "BINDING_REVERSE_CONFLICT"
  | "BINDING_BLOCKED_BY_EXECUTION"
  | "BINDING_NOT_FOUND"
  | "LEASE_EXPECTATION_MISMATCH"
  | "LEASE_BINDING_MISMATCH"
  | "LEASE_BLOCKED_BY_EXECUTION"
  | "LEASE_TIME_REGRESSION"
  | "INVALID_MUTATION_INPUT"
  | "OPERATION_NOT_FOUND"
  | "OPERATION_NOT_PREPARED"
  | "OPERATION_REUSE_CONFLICT"
  | "DISPATCH_BINDING_MISMATCH"
  | "DISPATCH_LEASE_MISMATCH"
  | "DISPATCH_CARRIER_MISMATCH"
  | "DISPATCH_OPERATION_METADATA_MISMATCH"
  | "DISPATCH_ALREADY_OWNED"
  | "SETTLE_STATE_MISMATCH"
  | "SETTLE_FENCE_MISMATCH"
  | "SETTLE_TRANSITION_INVALID";

export interface CurrentConversationBinding {
  logicalThreadId: string;
  providerConversationRef: string;
  generation: number;
  mutationAt: number;
}

export interface ActuationLease {
  logicalThreadId: string;
  providerConversationRef: string;
  carrierRef: string;
  bindingGeneration: number;
  leaseGeneration: number;
  claimedAt: number;
  claimedBy: ReducerActor;
}

export type ReducerSubmissionState =
  | "PREPARED"
  | "DISPATCHING"
  | "OBSERVED_ACCEPTED"
  | "UNCERTAIN"
  | "COMPLETED"
  | "FAILED_SAFE"
  | "CANCELLED";

export interface ReducerSubmissionOperation {
  operationId: string;
  logicalThreadId: string;
  providerConversationRef: string;
  carrierRef: string;
  bindingGeneration: number;
  leaseGeneration: number;
  requestFingerprint?: string;
  state: ReducerSubmissionState;
  dispatchClaimedAt?: number;
  dispatchFence?: DispatchFence;
}

export interface DispatchFence {
  providerConversationRef: string;
  carrierRef: string;
  bindingGeneration: number;
  leaseGeneration: number;
}

export interface OperationalStateReducerState {
  bindings: Record<string, CurrentConversationBinding>;
  leases: Record<string, ActuationLease>;
  operations: Record<string, ReducerSubmissionOperation>;
  /** Last authority-bearing mutation actor retained for audit/recovery diagnostics. */
  lastMutationActor?: ReducerActor;
  /** Global monotonic timestamp fence for authority-bearing mutations. */
  lastMutationAt?: number;
}

export interface ReducerSuccess<T> {
  ok: true;
  value: T;
  state: OperationalStateReducerState;
}

export interface ReducerFailure {
  ok: false;
  error: {
    code: ReducerErrorCode;
    message: string;
  };
  state: OperationalStateReducerState;
}

export type ReducerResult<T> = ReducerSuccess<T> | ReducerFailure;

export interface CommitCurrentConversationBindingInput {
  logicalThreadId: string;
  providerConversationRef: string;
  expected: CurrentConversationBinding | null;
  actor: ReducerActor;
  now: number;
}

export interface TransferActuationLeaseInput {
  logicalThreadId: string;
  providerConversationRef: string;
  expectedBindingGeneration: number;
  expectedLeaseGeneration: number | null;
  carrierRef: string;
  actor: ReducerActor;
  now: number;
}

export interface ClaimSubmissionDispatchInput {
  operationId: string;
  logicalThreadId: string;
  providerConversationRef: string;
  bindingGeneration: number;
  leaseGeneration: number;
  carrierRef: string;
  actor: ReducerActor;
  now: number;
}

export interface SettleSubmissionDispatchInput {
  operationId: string;
  expectedCurrentState: ReducerSubmissionState;
  expectedDispatchFence: DispatchFence;
  targetState: "OBSERVED_ACCEPTED" | "COMPLETED" | "UNCERTAIN" | "FAILED_SAFE" | "CANCELLED";
  /** Journal/evidence ref proving the observed transport fact. */
  executionEvidenceRef: string;
  /** Durable audit rationale carried on the delta's audit record. */
  reason: string;
  actor: ReducerActor;
  now: number;
}

const executionOwningStates = new Set<ReducerSubmissionState>([
  "DISPATCHING",
  "OBSERVED_ACCEPTED",
  "UNCERTAIN",
]);

export class OperationalStateReducer {
  private state: OperationalStateReducerState;

  constructor(initial?: Partial<OperationalStateReducerState>) {
    const candidate = {
      bindings: createMap<CurrentConversationBinding>(),
      leases: createMap<ActuationLease>(),
      operations: createMap<ReducerSubmissionOperation>(),
      ...initial,
    } as OperationalStateReducerState;
    assertValidState(candidate);
    this.state = cloneState(candidate);
  }

  snapshot(): OperationalStateReducerState {
    return cloneState(this.state);
  }

  replace(snapshot: OperationalStateReducerState): void {
    assertValidState(snapshot);
    if (
      this.state.lastMutationAt !== undefined &&
      (snapshot.lastMutationAt === undefined ||
        snapshot.lastMutationAt < this.state.lastMutationAt)
    ) {
      throw new Error(
        "INVALID_STATE_SNAPSHOT: replacement snapshot would move the mutation clock backwards",
      );
    }
    assertReplacementTimes(this.state, snapshot);
    assertReplacementEntities(this.state, snapshot);
    assertReplacementOperations(this.state, snapshot);
    this.state = cloneState(snapshot);
  }

  seedOperation(operation: ReducerSubmissionOperation): void {
    const candidate = this.snapshot();
    const existing = candidate.operations[operation.operationId];
    if (existing) {
      if (sameOperation(existing, operation)) return;
      throw new Error(
        `OPERATION_REUSE_CONFLICT: operation ${operation.operationId} already exists with different metadata`,
      );
    }
    candidate.operations[operation.operationId] = cloneOperation(operation);
    assertValidState(candidate);
    this.state = candidate;
  }

  getBinding(logicalThreadId: string): CurrentConversationBinding | undefined {
    const binding = this.state.bindings[logicalThreadId];
    return binding && { ...binding };
  }

  getLease(logicalThreadId: string): ActuationLease | undefined {
    const lease = this.state.leases[logicalThreadId];
    return lease && { ...lease };
  }

  commitCurrentConversationBinding(
    input: CommitCurrentConversationBindingInput,
  ): ReducerResult<CurrentConversationBinding> {
    const inputError = validateMutationInput(input.actor, input.now);
    if (inputError) return this.fail("INVALID_MUTATION_INPUT", inputError);
    const orderError = this.validateMutationOrder(input.now);
    if (orderError) return this.fail("INVALID_MUTATION_INPUT", orderError);
    const identityError = validateIdentities(
      ["logicalThreadId", input.logicalThreadId],
      ["providerConversationRef", input.providerConversationRef],
    );
    if (identityError) return this.fail("INVALID_MUTATION_INPUT", identityError);
    const current = this.state.bindings[input.logicalThreadId] ?? null;
    if (!sameBinding(current, input.expected)) {
      return this.fail(
        "BINDING_EXPECTATION_MISMATCH",
        `current binding for ${input.logicalThreadId} does not match the expected fence`,
      );
    }
    if (current && input.now < current.mutationAt) {
      return this.fail(
        "INVALID_MUTATION_INPUT",
        "binding mutation time cannot move backwards",
      );
    }
    if (
      current &&
      current.providerConversationRef === input.providerConversationRef
    ) {
      this.state.lastMutationActor = input.actor;
      this.state.lastMutationAt = input.now;
      return this.ok({ ...current });
    }
    const reverseOwner = Object.values(this.state.bindings).find(
      (binding) =>
        binding.providerConversationRef === input.providerConversationRef &&
        binding.logicalThreadId !== input.logicalThreadId,
    );
    if (reverseOwner) {
      return this.fail(
        "BINDING_REVERSE_CONFLICT",
        `${input.providerConversationRef} is already current for ${reverseOwner.logicalThreadId}`,
      );
    }
    if (
      current &&
      current.providerConversationRef !== input.providerConversationRef &&
      this.hasExecutionOwner(current.providerConversationRef)
    ) {
      return this.fail(
        "BINDING_BLOCKED_BY_EXECUTION",
        `binding ${current.providerConversationRef}@${current.generation} has unresolved execution`,
      );
    }

    const next: CurrentConversationBinding = {
      logicalThreadId: input.logicalThreadId,
      providerConversationRef: input.providerConversationRef,
      generation: (current?.generation ?? 0) + 1,
      mutationAt: input.now,
    };
    this.state.bindings[input.logicalThreadId] = next;
    if (current?.providerConversationRef !== next.providerConversationRef) {
      delete this.state.leases[input.logicalThreadId];
    }
    this.state.lastMutationActor = input.actor;
    this.state.lastMutationAt = input.now;
    return this.ok({ ...next });
  }

  transferActuationLease(
    input: TransferActuationLeaseInput,
  ): ReducerResult<ActuationLease> {
    const inputError = validateMutationInput(input.actor, input.now);
    if (inputError) return this.fail("INVALID_MUTATION_INPUT", inputError);
    const orderError = this.validateMutationOrder(input.now);
    if (orderError) return this.fail("INVALID_MUTATION_INPUT", orderError);
    const identityError = validateIdentities(
      ["logicalThreadId", input.logicalThreadId],
      ["providerConversationRef", input.providerConversationRef],
      ["carrierRef", input.carrierRef],
    );
    if (identityError) return this.fail("INVALID_MUTATION_INPUT", identityError);
    const binding = this.state.bindings[input.logicalThreadId];
    if (!binding) {
      return this.fail(
        "BINDING_NOT_FOUND",
        `no current binding for ${input.logicalThreadId}`,
      );
    }
    if (
      binding.providerConversationRef !== input.providerConversationRef ||
      binding.generation !== input.expectedBindingGeneration
    ) {
      return this.fail(
        "LEASE_BINDING_MISMATCH",
        "lease transfer does not match the current binding fence",
      );
    }
    const current = this.state.leases[input.logicalThreadId];
    const actualGeneration = current?.leaseGeneration ?? null;
    if (actualGeneration !== input.expectedLeaseGeneration) {
      return this.fail(
        "LEASE_EXPECTATION_MISMATCH",
        "lease transfer does not match the expected lease generation",
      );
    }
    if (current && input.now < current.claimedAt) {
      return this.fail(
        "LEASE_TIME_REGRESSION",
        "lease transfer time cannot precede the current lease claim",
      );
    }
    if (input.now < binding.mutationAt) {
      return this.fail(
        "INVALID_MUTATION_INPUT",
        "lease claim time cannot precede the binding mutation",
      );
    }
    if (this.hasExecutionOwner(input.providerConversationRef)) {
      return this.fail(
        "LEASE_BLOCKED_BY_EXECUTION",
        `execution on ${input.providerConversationRef} must reconcile before lease transfer`,
      );
    }

    const next: ActuationLease = {
      logicalThreadId: input.logicalThreadId,
      providerConversationRef: input.providerConversationRef,
      carrierRef: input.carrierRef,
      bindingGeneration: binding.generation,
      leaseGeneration: (actualGeneration ?? 0) + 1,
      claimedAt: input.now,
      claimedBy: input.actor,
    };
    this.state.leases[input.logicalThreadId] = next;
    this.state.lastMutationActor = input.actor;
    this.state.lastMutationAt = input.now;
    return this.ok({ ...next });
  }

  claimSubmissionDispatch(
    input: ClaimSubmissionDispatchInput,
  ): ReducerResult<ReducerSubmissionOperation> {
    const inputError = validateMutationInput(input.actor, input.now);
    if (inputError) return this.fail("INVALID_MUTATION_INPUT", inputError);
    const orderError = this.validateMutationOrder(input.now);
    if (orderError) return this.fail("INVALID_MUTATION_INPUT", orderError);
    const identityError = validateIdentities(
      ["operationId", input.operationId],
      ["logicalThreadId", input.logicalThreadId],
      ["providerConversationRef", input.providerConversationRef],
      ["carrierRef", input.carrierRef],
    );
    if (identityError) return this.fail("INVALID_MUTATION_INPUT", identityError);
    const operation = this.state.operations[input.operationId];
    if (!operation) {
      return this.fail(
        "OPERATION_NOT_FOUND",
        `submission operation ${input.operationId} does not exist`,
      );
    }
    if (
      operation.logicalThreadId !== input.logicalThreadId ||
      operation.providerConversationRef !== input.providerConversationRef ||
      operation.carrierRef !== input.carrierRef ||
      operation.bindingGeneration !== input.bindingGeneration ||
      operation.leaseGeneration !== input.leaseGeneration
    ) {
      return this.fail(
        "DISPATCH_OPERATION_METADATA_MISMATCH",
        "dispatch claim does not match the submission operation metadata",
      );
    }
    if (operation.state !== "PREPARED") {
      if (
        ["DISPATCHING", "OBSERVED_ACCEPTED", "UNCERTAIN"].includes(
          operation.state,
        ) &&
        sameFence(operation.dispatchFence, {
          providerConversationRef: input.providerConversationRef,
          carrierRef: input.carrierRef,
          bindingGeneration: input.bindingGeneration,
          leaseGeneration: input.leaseGeneration,
        })
      ) {
        if (
          operation.dispatchClaimedAt !== undefined &&
          input.now < operation.dispatchClaimedAt
        ) {
          return this.fail(
            "INVALID_MUTATION_INPUT",
            "idempotent dispatch replay cannot move claim time backwards",
          );
        }
        return this.ok(cloneOperation(operation));
      }
      return this.fail(
        "OPERATION_NOT_PREPARED",
        `submission operation ${input.operationId} is ${operation.state}`,
      );
    }
    const binding = this.state.bindings[input.logicalThreadId];
    const lease = this.state.leases[input.logicalThreadId];
    if (
      !binding ||
      binding.providerConversationRef !== input.providerConversationRef ||
      binding.generation !== input.bindingGeneration
    ) {
      return this.fail(
        "DISPATCH_BINDING_MISMATCH",
        "dispatch claim is stale against the current binding",
      );
    }
    if (
      !lease ||
      lease.providerConversationRef !== input.providerConversationRef ||
      lease.carrierRef !== input.carrierRef ||
      lease.bindingGeneration !== input.bindingGeneration ||
      lease.leaseGeneration !== input.leaseGeneration
    ) {
      return this.fail(
        "DISPATCH_LEASE_MISMATCH",
        "dispatch claim is stale against the current actuation lease",
      );
    }
    if (input.now < lease.claimedAt) {
      return this.fail(
        "INVALID_MUTATION_INPUT",
        "dispatch claim time cannot precede the lease claim",
      );
    }
    const active = Object.values(this.state.operations).find(
      (candidate) =>
        candidate.operationId !== input.operationId &&
        candidate.providerConversationRef === input.providerConversationRef &&
        executionOwningStates.has(candidate.state),
    );
    if (active) {
      return this.fail(
        "DISPATCH_ALREADY_OWNED",
        `dispatch authority is already owned by ${active.operationId}`,
      );
    }

    const fence: DispatchFence = {
      providerConversationRef: input.providerConversationRef,
      carrierRef: input.carrierRef,
      bindingGeneration: input.bindingGeneration,
      leaseGeneration: input.leaseGeneration,
    };
    operation.state = "DISPATCHING";
    operation.dispatchClaimedAt = input.now;
    operation.dispatchFence = fence;
    this.state.lastMutationActor = input.actor;
    this.state.lastMutationAt = input.now;
    return this.ok(cloneOperation(operation));
  }

  /**
   * Settle a claimed dispatch from execution evidence: advance or release the
   * execution authority that claimSubmissionDispatch granted. Expectation-fenced
   * (current state + fence), transition-table governed (terminal states are
   * irreversible), and idempotent for an equal-state replay.
   */
  settleSubmissionDispatch(
    input: SettleSubmissionDispatchInput,
  ): ReducerResult<ReducerSubmissionOperation> {
    const inputError = validateMutationInput(input.actor, input.now);
    if (inputError) return this.fail("INVALID_MUTATION_INPUT", inputError);
    const orderError = this.validateMutationOrder(input.now);
    if (orderError) return this.fail("INVALID_MUTATION_INPUT", orderError);
    const identityError = validateIdentities(
      ["operationId", input.operationId],
      ["executionEvidenceRef", input.executionEvidenceRef],
    );
    if (identityError) return this.fail("INVALID_MUTATION_INPUT", identityError);
    if (typeof input.reason !== "string" || input.reason.trim().length === 0) {
      return this.fail("INVALID_MUTATION_INPUT", "reason is required");
    }
    const operation = this.state.operations[input.operationId];
    if (!operation) {
      return this.fail(
        "OPERATION_NOT_FOUND",
        `submission operation ${input.operationId} does not exist`,
      );
    }
    if (operation.state !== input.expectedCurrentState) {
      return this.fail(
        "SETTLE_STATE_MISMATCH",
        `submission operation ${input.operationId} is ${operation.state}, not ${input.expectedCurrentState}`,
      );
    }
    if (
      !operation.dispatchFence ||
      !sameFence(operation.dispatchFence, input.expectedDispatchFence)
    ) {
      return this.fail(
        "SETTLE_FENCE_MISMATCH",
        `settlement fence does not match the fence recorded on ${input.operationId}`,
      );
    }
    if (!isAllowedLifecycleTransition(operation.state, input.targetState)) {
      return this.fail(
        "SETTLE_TRANSITION_INVALID",
        `cannot settle ${input.operationId} from ${operation.state} to ${input.targetState}`,
      );
    }
    if (input.now < (operation.dispatchClaimedAt ?? 0)) {
      return this.fail(
        "INVALID_MUTATION_INPUT",
        "settlement time cannot precede the dispatch claim",
      );
    }
    operation.state = input.targetState;
    this.state.lastMutationActor = input.actor;
    this.state.lastMutationAt = input.now;
    return this.ok(cloneOperation(operation));
  }

  private validateMutationOrder(now: number): string | undefined {
    if (
      this.state.lastMutationAt !== undefined &&
      now < this.state.lastMutationAt
    ) {
      return "mutation time cannot move backwards from the global reducer fence";
    }
    return undefined;
  }

  private hasExecutionOwner(providerConversationRef: string): boolean {
    return Object.values(this.state.operations).some(
      (operation) =>
        operation.providerConversationRef === providerConversationRef &&
        executionOwningStates.has(operation.state),
    );
  }

  private ok<T>(value: T): ReducerSuccess<T> {
    return { ok: true, value, state: this.snapshot() };
  }

  private fail(code: ReducerErrorCode, message: string): ReducerFailure {
    return { ok: false, error: { code, message }, state: this.snapshot() };
  }
}

function sameBinding(
  left: CurrentConversationBinding | null,
  right: CurrentConversationBinding | null,
): boolean {
  if (!left || !right) return !left && !right;
  return (
    left.logicalThreadId === right.logicalThreadId &&
    left.providerConversationRef === right.providerConversationRef &&
    left.generation === right.generation
  );
}

function sameFence(left: DispatchFence | undefined, right: DispatchFence): boolean {
  return Boolean(
    left &&
      left.providerConversationRef === right.providerConversationRef &&
      left.carrierRef === right.carrierRef &&
      left.bindingGeneration === right.bindingGeneration &&
      left.leaseGeneration === right.leaseGeneration,
  );
}

function cloneOperation(
  operation: ReducerSubmissionOperation,
): ReducerSubmissionOperation {
  return {
    ...operation,
    dispatchFence: operation.dispatchFence && { ...operation.dispatchFence },
  };
}

function cloneState(state: OperationalStateReducerState): OperationalStateReducerState {
  return {
    bindings: cloneMap(state.bindings, (value) => ({ ...value })),
    leases: cloneMap(state.leases, (value) => ({ ...value })),
    operations: cloneMap(state.operations, cloneOperation),
    lastMutationActor: state.lastMutationActor,
    lastMutationAt: state.lastMutationAt,
  };
}

function assertValidState(state: OperationalStateReducerState): void {
  if (
    !isRecord(state) ||
    !isRecord(state.bindings) ||
    !isRecord(state.leases) ||
    !isRecord(state.operations)
  ) {
    throw new Error("INVALID_STATE_SNAPSHOT: state maps must be plain objects");
  }
  if (
    state.lastMutationActor !== undefined &&
    !isReducerActor(state.lastMutationActor)
  ) {
    throw new Error("INVALID_STATE_SNAPSHOT: invalid mutation actor");
  }
  if (
    state.lastMutationAt !== undefined &&
    !isValidTimestamp(state.lastMutationAt)
  ) {
    throw new Error("INVALID_STATE_SNAPSHOT: invalid last mutation time");
  }
  const mutationTimes: number[] = [];
  const bindingOwners = new Set<string>();
  for (const [logicalThreadId, binding] of Object.entries(state.bindings)) {
    assertSafeMapKey(logicalThreadId);
    if (
      !isRecord(binding) ||
      typeof binding.logicalThreadId !== "string" ||
      typeof binding.providerConversationRef !== "string"
    ) {
      throw new Error("INVALID_STATE_SNAPSHOT: malformed current binding");
    }
    assertIdentity(binding.logicalThreadId, "binding logical thread");
    assertIdentity(binding.providerConversationRef, "binding provider conversation");
    if (binding.logicalThreadId !== logicalThreadId) {
      throw new Error(
        `INVALID_STATE_SNAPSHOT: binding map key does not match logical thread ${binding.logicalThreadId}`,
      );
    }
    assertPositiveGeneration(binding.generation, "binding generation");
    assertTimestamp(binding.mutationAt, "binding mutation time");
    mutationTimes.push(binding.mutationAt);
    if (bindingOwners.has(binding.providerConversationRef)) {
      throw new Error(
        `INVALID_STATE_SNAPSHOT: provider conversation ${binding.providerConversationRef} has multiple current owners`,
      );
    }
    bindingOwners.add(binding.providerConversationRef);
  }

  for (const [logicalThreadId, lease] of Object.entries(state.leases)) {
    assertSafeMapKey(logicalThreadId);
    if (
      !isRecord(lease) ||
      typeof lease.logicalThreadId !== "string" ||
      typeof lease.providerConversationRef !== "string" ||
      typeof lease.carrierRef !== "string" ||
      !isReducerActor(lease.claimedBy) ||
      !Number.isFinite(lease.claimedAt)
    ) {
      throw new Error("INVALID_STATE_SNAPSHOT: malformed actuation lease");
    }
    assertIdentity(lease.logicalThreadId, "lease logical thread");
    assertIdentity(lease.providerConversationRef, "lease provider conversation");
    assertIdentity(lease.carrierRef, "lease carrier");
    assertTimestamp(lease.claimedAt, "lease claim time");
    assertPositiveGeneration(lease.bindingGeneration, "lease binding generation");
    assertPositiveGeneration(lease.leaseGeneration, "lease generation");
    mutationTimes.push(lease.claimedAt);
    const binding = state.bindings[logicalThreadId];
    if (
      lease.logicalThreadId !== logicalThreadId ||
      !binding ||
      lease.providerConversationRef !== binding.providerConversationRef ||
      lease.bindingGeneration !== binding.generation
    ) {
      throw new Error(
        `INVALID_STATE_SNAPSHOT: lease ${logicalThreadId} is not fenced to its current binding`,
      );
    }
    if (lease.claimedAt < binding.mutationAt) {
      throw new Error(
        `INVALID_STATE_SNAPSHOT: lease ${logicalThreadId} predates binding mutation`,
      );
    }
  }

  const executionOwners = new Set<string>();
  for (const [operationId, operation] of Object.entries(state.operations)) {
    assertSafeMapKey(operationId);
    if (
      !isRecord(operation) ||
      typeof operation.operationId !== "string" ||
      typeof operation.logicalThreadId !== "string" ||
      typeof operation.providerConversationRef !== "string" ||
      typeof operation.carrierRef !== "string" ||
      !isReducerSubmissionState(operation.state)
    ) {
      throw new Error("INVALID_STATE_SNAPSHOT: malformed submission operation");
    }
    assertIdentity(operation.operationId, "operation id");
    assertIdentity(operation.logicalThreadId, "operation logical thread");
    assertIdentity(operation.providerConversationRef, "operation provider conversation");
    assertIdentity(operation.carrierRef, "operation carrier");
    if (
      operation.requestFingerprint !== undefined &&
      !isValidIdentity(operation.requestFingerprint)
    ) {
      throw new Error(
        `INVALID_STATE_SNAPSHOT: operation ${operationId} request fingerprint is invalid`,
      );
    }
    assertPositiveGeneration(
      operation.bindingGeneration,
      "operation binding generation",
    );
    assertPositiveGeneration(
      operation.leaseGeneration,
      "operation lease generation",
    );
    if (operation.operationId !== operationId) {
      throw new Error(
        `INVALID_STATE_SNAPSHOT: operation map key does not match operation id ${operation.operationId}`,
      );
    }
    if (operation.state === "PREPARED") {
      if (operation.dispatchFence || operation.dispatchClaimedAt !== undefined) {
        throw new Error(
          `INVALID_STATE_SNAPSHOT: prepared operation ${operationId} has dispatch metadata`,
        );
      }
    }
    if (
      operation.dispatchClaimedAt !== undefined &&
      !isValidTimestamp(operation.dispatchClaimedAt)
    ) {
      throw new Error(
        `INVALID_STATE_SNAPSHOT: invalid dispatch claim time for ${operationId}`,
      );
    }
    if (operation.dispatchClaimedAt !== undefined) {
      mutationTimes.push(operation.dispatchClaimedAt);
    }
    if (operation.dispatchFence !== undefined) {
      const fence = operation.dispatchFence;
      if (
        !isRecord(fence) ||
        typeof fence.providerConversationRef !== "string" ||
        typeof fence.carrierRef !== "string"
      ) {
        throw new Error(
          `INVALID_STATE_SNAPSHOT: malformed dispatch fence for ${operationId}`,
        );
      }
      assertIdentity(fence.providerConversationRef, "dispatch fence provider conversation");
      assertIdentity(fence.carrierRef, "dispatch fence carrier");
      assertPositiveGeneration(
        fence.bindingGeneration,
        "dispatch fence binding generation",
      );
      assertPositiveGeneration(
        fence.leaseGeneration,
        "dispatch fence lease generation",
      );
    }
    if (
      executionOwningStates.has(operation.state) &&
      (!operation.dispatchFence ||
        !Number.isFinite(operation.dispatchClaimedAt))
    ) {
      throw new Error(
        `INVALID_STATE_SNAPSHOT: execution-owning operation ${operationId} lacks claim metadata`,
      );
    }
    if (operation.dispatchFence && !sameFence(operation.dispatchFence, {
      providerConversationRef: operation.providerConversationRef,
      carrierRef: operation.carrierRef,
      bindingGeneration: operation.bindingGeneration,
      leaseGeneration: operation.leaseGeneration,
    })) {
      throw new Error(
        `INVALID_STATE_SNAPSHOT: dispatch fence metadata mismatch for ${operationId}`,
      );
    }
    if (executionOwningStates.has(operation.state)) {
      const binding = state.bindings[operation.logicalThreadId];
      const lease = state.leases[operation.logicalThreadId];
      if (
        !binding ||
        !lease ||
        binding.providerConversationRef !== operation.providerConversationRef ||
        binding.generation !== operation.bindingGeneration ||
        lease.providerConversationRef !== operation.providerConversationRef ||
        lease.carrierRef !== operation.carrierRef ||
        lease.bindingGeneration !== operation.bindingGeneration ||
        lease.leaseGeneration !== operation.leaseGeneration
      ) {
        throw new Error(
          `INVALID_STATE_SNAPSHOT: execution-owning operation ${operationId} is stale against binding or lease`,
        );
      }
      if (
        operation.dispatchClaimedAt === undefined ||
        operation.dispatchClaimedAt < lease.claimedAt ||
        operation.dispatchClaimedAt < binding.mutationAt
      ) {
        throw new Error(
          `INVALID_STATE_SNAPSHOT: dispatch claim time precedes lease claim for ${operationId}`,
        );
      }
      if (executionOwners.has(operation.providerConversationRef)) {
        throw new Error(
          `INVALID_STATE_SNAPSHOT: provider conversation ${operation.providerConversationRef} has multiple execution owners`,
        );
      }
      executionOwners.add(operation.providerConversationRef);
    }
  }
  if (
    mutationTimes.some(
      (mutationTime) =>
        state.lastMutationAt === undefined ||
        mutationTime > state.lastMutationAt,
    )
  ) {
    throw new Error(
      "INVALID_STATE_SNAPSHOT: last mutation time does not cover persisted mutations",
    );
  }
}

function assertReplacementTimes(
  current: OperationalStateReducerState,
  replacement: OperationalStateReducerState,
): void {
  for (const [logicalThreadId, binding] of Object.entries(current.bindings)) {
    const next = replacement.bindings[logicalThreadId];
    if (next && next.mutationAt < binding.mutationAt) {
      throw new Error(
        `INVALID_STATE_SNAPSHOT: binding ${logicalThreadId} mutation time moved backwards`,
      );
    }
  }
  for (const [logicalThreadId, lease] of Object.entries(current.leases)) {
    const next = replacement.leases[logicalThreadId];
    if (next && next.claimedAt < lease.claimedAt) {
      throw new Error(
        `INVALID_STATE_SNAPSHOT: lease ${logicalThreadId} claim time moved backwards`,
      );
    }
  }
  for (const [operationId, operation] of Object.entries(current.operations)) {
    const next = replacement.operations[operationId];
    if (
      next &&
      operation.dispatchClaimedAt !== undefined &&
      (next.dispatchClaimedAt === undefined ||
        next.dispatchClaimedAt < operation.dispatchClaimedAt)
    ) {
      throw new Error(
        `INVALID_STATE_SNAPSHOT: operation ${operationId} dispatch time moved backwards`,
      );
    }
  }
}

function assertReplacementEntities(
  current: OperationalStateReducerState,
  replacement: OperationalStateReducerState,
): void {
  for (const [logicalThreadId, binding] of Object.entries(current.bindings)) {
    const next = replacement.bindings[logicalThreadId];
    if (!next) {
      throw new Error(
        `INVALID_STATE_SNAPSHOT: binding ${logicalThreadId} cannot be removed during restore`,
      );
    }
    if (next.generation < binding.generation) {
      throw new Error(
        `INVALID_STATE_SNAPSHOT: binding ${logicalThreadId} generation moved backwards`,
      );
    }
    if (
      next.generation === binding.generation &&
      next.providerConversationRef !== binding.providerConversationRef
    ) {
      throw new Error(
        `INVALID_STATE_SNAPSHOT: binding ${logicalThreadId} identity changed without generation advance`,
      );
    }
  }
  for (const [logicalThreadId, lease] of Object.entries(current.leases)) {
    const next = replacement.leases[logicalThreadId];
    if (!next) {
      throw new Error(
        `INVALID_STATE_SNAPSHOT: lease ${logicalThreadId} cannot be removed during restore`,
      );
    }
    if (next.leaseGeneration < lease.leaseGeneration) {
      throw new Error(
        `INVALID_STATE_SNAPSHOT: lease ${logicalThreadId} generation moved backwards`,
      );
    }
    const binding = current.bindings[logicalThreadId];
    const nextBinding = replacement.bindings[logicalThreadId];
    if (
      binding &&
      nextBinding &&
      nextBinding.generation > binding.generation &&
      next.leaseGeneration <= lease.leaseGeneration
    ) {
      throw new Error(
        `INVALID_STATE_SNAPSHOT: lease ${logicalThreadId} generation must advance with binding`,
      );
    }
    if (next.leaseGeneration === lease.leaseGeneration) {
      if (
        next.providerConversationRef !== lease.providerConversationRef ||
        next.carrierRef !== lease.carrierRef ||
        next.bindingGeneration !== lease.bindingGeneration ||
        next.claimedBy !== lease.claimedBy
      ) {
        throw new Error(
          `INVALID_STATE_SNAPSHOT: lease ${logicalThreadId} identity changed without generation advance`,
        );
      }
    }
  }
}

function assertReplacementOperations(
  current: OperationalStateReducerState,
  replacement: OperationalStateReducerState,
): void {
  for (const [operationId, previous] of Object.entries(current.operations)) {
    const next = replacement.operations[operationId];
    if (!next) {
      throw new Error(
        `INVALID_STATE_SNAPSHOT: operation ${operationId} cannot be removed during restore`,
      );
    }
    if (
      previous.logicalThreadId !== next.logicalThreadId ||
      previous.providerConversationRef !== next.providerConversationRef ||
      previous.carrierRef !== next.carrierRef ||
      previous.bindingGeneration !== next.bindingGeneration ||
      previous.leaseGeneration !== next.leaseGeneration ||
      previous.requestFingerprint !== next.requestFingerprint
    ) {
      throw new Error(
        `INVALID_STATE_SNAPSHOT: operation ${operationId} identity metadata changed during restore`,
      );
    }
    if (!isAllowedLifecycleTransition(previous.state, next.state)) {
      throw new Error(
        `INVALID_STATE_SNAPSHOT: operation ${operationId} lifecycle cannot move from ${previous.state} to ${next.state}`,
      );
    }
    const isPersistedClaim =
      previous.state === "PREPARED" &&
      next.state === "DISPATCHING" &&
      !previous.dispatchFence &&
      Boolean(next.dispatchFence) &&
      next.dispatchClaimedAt !== undefined;
    if (
      Boolean(previous.dispatchFence) !== Boolean(next.dispatchFence) &&
      !isPersistedClaim
    ) {
      throw new Error(
        `INVALID_STATE_SNAPSHOT: operation ${operationId} dispatch fence presence changed during restore`,
      );
    }
    if (
      previous.dispatchFence &&
      !sameFence(previous.dispatchFence, next.dispatchFence!)
    ) {
      throw new Error(
        `INVALID_STATE_SNAPSHOT: operation ${operationId} dispatch fence changed during restore`,
      );
    }
  }
}

function isAllowedLifecycleTransition(
  from: ReducerSubmissionState,
  to: ReducerSubmissionState,
): boolean {
  if (from === to) return true;
  if (from === "PREPARED") return to === "DISPATCHING" || to === "CANCELLED";
  if (from === "DISPATCHING") {
    return (
      to === "OBSERVED_ACCEPTED" ||
      to === "UNCERTAIN" ||
      to === "FAILED_SAFE" ||
      to === "CANCELLED"
    );
  }
  if (from === "OBSERVED_ACCEPTED") {
    return to === "COMPLETED";
  }
  if (from === "UNCERTAIN") {
    return (
      to === "OBSERVED_ACCEPTED" ||
      to === "FAILED_SAFE" ||
      to === "CANCELLED"
    );
  }
  return false;
}

function sameOperation(
  left: ReducerSubmissionOperation,
  right: ReducerSubmissionOperation,
): boolean {
  return (
    left.operationId === right.operationId &&
    left.logicalThreadId === right.logicalThreadId &&
    left.providerConversationRef === right.providerConversationRef &&
    left.carrierRef === right.carrierRef &&
    left.bindingGeneration === right.bindingGeneration &&
    left.leaseGeneration === right.leaseGeneration &&
    left.requestFingerprint === right.requestFingerprint &&
    left.state === right.state &&
    left.dispatchClaimedAt === right.dispatchClaimedAt &&
    sameFenceOrUndefined(left.dispatchFence, right.dispatchFence)
  );
}

function sameFenceOrUndefined(
  left: DispatchFence | undefined,
  right: DispatchFence | undefined,
): boolean {
  if (!left || !right) return !left && !right;
  return sameFence(left, right);
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isReducerActor(value: unknown): value is ReducerActor {
  return value === "system" || value === "human" || value === "worker";
}

function isReducerSubmissionState(
  value: unknown,
): value is ReducerSubmissionState {
  return (
    value === "PREPARED" ||
    value === "DISPATCHING" ||
    value === "OBSERVED_ACCEPTED" ||
    value === "COMPLETED" ||
    value === "UNCERTAIN" ||
    value === "FAILED_SAFE" ||
    value === "CANCELLED"
  );
}

function assertPositiveGeneration(value: unknown, label: string): void {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 1
  ) {
    throw new Error(`INVALID_STATE_SNAPSHOT: ${label} must be a positive integer`);
  }
}

function assertTimestamp(value: unknown, label: string): void {
  if (!isValidTimestamp(value)) {
    throw new Error(`INVALID_STATE_SNAPSHOT: ${label} must be finite and non-negative`);
  }
}

function validateMutationInput(
  actor: unknown,
  now: unknown,
): string | undefined {
  if (!isReducerActor(actor)) return "mutation actor is invalid";
  if (!isValidTimestamp(now)) {
    return "mutation time must be a finite non-negative number";
  }
  return undefined;
}

function validateIdentities(
  ...identities: Array<[string, unknown]>
): string | undefined {
  for (const [label, value] of identities) {
    if (!isValidIdentity(value)) return `${label} is invalid`;
  }
  return undefined;
}

function assertIdentity(value: unknown, label: string): void {
  if (!isValidIdentity(value)) {
    throw new Error(`INVALID_STATE_SNAPSHOT: ${label} is invalid`);
  }
}

function isValidIdentity(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(value)
  );
}

function isValidTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function assertSafeMapKey(key: string): void {
  if (key === "__proto__" || key === "constructor" || key === "prototype") {
    throw new Error(`INVALID_STATE_SNAPSHOT: reserved map key ${key}`);
  }
}

function createMap<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

function cloneMap<T>(
  source: Record<string, T>,
  clone: (value: T) => T,
): Record<string, T> {
  const result = createMap<T>();
  for (const [key, value] of Object.entries(source)) {
    assertSafeMapKey(key);
    result[key] = clone(value);
  }
  return result;
}
