/**
 * ResultDeliveryKey index + durable ResultDeliveryReceipt projection.
 *
 * The canonical transport lifecycle for a child result is the
 * SubmissionOperation(kind=DELIVER_CHILD_RESULT); this ledger owns only the
 * logical delivery identity and the recipient-side receipt (child-result-
 * delivery-idempotency-contract v0 §1-§4, §8-§9, §12, §14). Every record
 * references the owning SubmissionOperation; a receipt is minted only when the
 * transport reaches OBSERVED_ACCEPTED (INSERTED) and the resulting parent turn
 * completes (COMPLETED). A delivery waiting for a safe carrier has an index
 * row and NO receipt: PREPARED != UNCERTAIN != INSERTED. Clearing the parent
 * mechanical wait on COMPLETED is not semantic acceptance (§14).
 */

export type ResultDeliveryReceiptState = "INSERTED" | "COMPLETED";
export type ParentWaitKind = "WAIT_REVIEW" | "WAIT_WORKER";

export interface RecordedDispatchFence {
  providerConversationRef: string;
  bindingEpoch: number;
  leaseGeneration: number;
  leaseOwnerRef: string;
  targetCarrierRef: string;
}

export interface ResultDeliveryRecord {
  deliveryKey: string;
  /** Canonical transport owner: SubmissionOperation(kind=DELIVER_CHILD_RESULT). */
  submissionOperationId: string;
  parentThreadId: string;
  childThreadId: string;
  workItemId: string;
  resultRef: string;
  /** Absent until the transport is OBSERVED_ACCEPTED — waiting is not inserted. */
  receiptState?: ResultDeliveryReceiptState;
  dispatchFence?: RecordedDispatchFence;
  deliveredTo?: string;
  insertedMessageRef?: string;
  resultingParentTurnRef?: string;
  insertedAt?: number;
  completedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface ParentWaitRecord {
  parentThreadId: string;
  kind: ParentWaitKind;
  childThreadId: string;
  since: number;
}

export interface CreateDeliveryInput {
  submissionOperationId: string;
  parentThreadId: string;
  childThreadId: string;
  workItemId: string;
  resultRef: string;
  now?: number;
}

export interface ResultDeliveryStore {
  get(key?: string): Promise<unknown>;
  set(value: Record<string, unknown>): Promise<unknown>;
}

export const RESULT_DELIVERIES_KEY = "noosResultDeliveries";
export const PARENT_WAITS_KEY = "noosParentWaits";

/**
 * Deterministic logical delivery identity (§2.2): which result goes to which
 * parent Logical Thread. The concrete carrier/generation of any physical
 * attempt lives in the transport's DispatchFence, not here.
 */
export function resultDeliveryKey(input: { parentThreadId: string; childThreadId: string; resultRef: string }): string {
  return `${input.parentThreadId}>${input.childThreadId}>${input.resultRef}`;
}

export class ResultDeliveryLedger {
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly store: ResultDeliveryStore) {}

  async listDeliveries(): Promise<ResultDeliveryRecord[]> {
    return this.read(RESULT_DELIVERIES_KEY, isResultDeliveryRecord);
  }

  async getDelivery(deliveryKey: string): Promise<ResultDeliveryRecord | undefined> {
    return (await this.listDeliveries()).find(item => item.deliveryKey === deliveryKey);
  }

  /** Idempotent create-or-get. Mints no receipt: the transport may still be PREPARED. */
  async createDelivery(input: CreateDeliveryInput): Promise<ResultDeliveryRecord> {
    if (!isCreateDeliveryInput(input)) throw new Error("delivery_input_invalid");
    const deliveryKey = resultDeliveryKey(input);
    return this.mutate<ResultDeliveryRecord, ResultDeliveryRecord>(
      RESULT_DELIVERIES_KEY, isResultDeliveryRecord,
      records => {
        const existing = records.find(item => item.deliveryKey === deliveryKey);
        if (existing) {
          if (existing.submissionOperationId !== input.submissionOperationId || existing.workItemId !== input.workItemId) {
            throw new Error(`delivery_reuse_conflict:${deliveryKey}`);
          }
          return { records, result: existing };
        }
        const now = input.now ?? Date.now();
        const record: ResultDeliveryRecord = {
          deliveryKey,
          submissionOperationId: input.submissionOperationId,
          parentThreadId: input.parentThreadId,
          childThreadId: input.childThreadId,
          workItemId: input.workItemId,
          resultRef: input.resultRef,
          createdAt: now,
          updatedAt: now
        };
        return { records: [...records, record], result: record };
      }
    );
  }

  /**
   * Mint the INSERTED receipt. Caller obligation: the transport operation has
   * reached OBSERVED_ACCEPTED (directly or by reconciliation). After this
   * exists, replaying the same ResultDeliveryKey must not insert again.
   */
  async recordInserted(
    deliveryKey: string,
    evidence: { deliveredTo: string; dispatchFence?: RecordedDispatchFence; insertedMessageRef?: string },
    now = Date.now()
  ): Promise<ResultDeliveryRecord> {
    if (!isNonEmptyString(evidence.deliveredTo)) throw new Error("delivery_receipt_invalid");
    return this.mutate<ResultDeliveryRecord, ResultDeliveryRecord>(
      RESULT_DELIVERIES_KEY, isResultDeliveryRecord,
      records => {
        const index = records.findIndex(item => item.deliveryKey === deliveryKey);
        if (index === -1) throw new Error(`delivery_not_found:${deliveryKey}`);
        const current = records[index];
        if (current.receiptState) return { records, result: current };
        const record: ResultDeliveryRecord = {
          ...current,
          receiptState: "INSERTED",
          deliveredTo: evidence.deliveredTo,
          dispatchFence: evidence.dispatchFence ? { ...evidence.dispatchFence } : current.dispatchFence,
          insertedMessageRef: evidence.insertedMessageRef ?? current.insertedMessageRef,
          insertedAt: now,
          updatedAt: now
        };
        const nextRecords = records.slice();
        nextRecords[index] = record;
        return { records: nextRecords, result: record };
      }
    );
  }

  /**
   * INSERTED → COMPLETED when the result-bearing parent turn finishes, then
   * clear the parent mechanical wait. Completion is not semantic acceptance.
   */
  async completeDelivery(deliveryKey: string, input: { resultingParentTurnRef?: string } = {}, now = Date.now()): Promise<ResultDeliveryRecord> {
    const completed = await this.mutate<ResultDeliveryRecord, ResultDeliveryRecord>(
      RESULT_DELIVERIES_KEY, isResultDeliveryRecord,
      records => {
        const index = records.findIndex(item => item.deliveryKey === deliveryKey);
        if (index === -1) throw new Error(`delivery_not_found:${deliveryKey}`);
        const current = records[index];
        if (current.receiptState === "COMPLETED") return { records, result: current };
        if (current.receiptState !== "INSERTED") throw new Error(`delivery_not_inserted:${deliveryKey}`);
        const record: ResultDeliveryRecord = {
          ...current,
          receiptState: "COMPLETED",
          resultingParentTurnRef: input.resultingParentTurnRef ?? current.resultingParentTurnRef,
          completedAt: now,
          updatedAt: now
        };
        const nextRecords = records.slice();
        nextRecords[index] = record;
        return { records: nextRecords, result: record };
      }
    );
    await this.clearWait(completed.parentThreadId, completed.childThreadId);
    return completed;
  }

  async getWait(parentThreadId: string): Promise<ParentWaitRecord | undefined> {
    return (await this.read(PARENT_WAITS_KEY, isParentWaitRecord)).find(item => item.parentThreadId === parentThreadId);
  }

  /** Enter (or re-enter) a parent mechanical wait. One wait per parent thread (§12, lifecycle §14). */
  async setWait(parentThreadId: string, wait: { kind: ParentWaitKind; childThreadId: string }, now = Date.now()): Promise<ParentWaitRecord> {
    if (!isThreadId(parentThreadId) || !isThreadId(wait.childThreadId) || !isParentWaitKind(wait.kind) || parentThreadId === wait.childThreadId) {
      throw new Error("parent_wait_invalid");
    }
    const record: ParentWaitRecord = { parentThreadId, kind: wait.kind, childThreadId: wait.childThreadId, since: now };
    await this.mutate<ParentWaitRecord, ParentWaitRecord>(
      PARENT_WAITS_KEY, isParentWaitRecord,
      records => ({ records: [...records.filter(item => item.parentThreadId !== parentThreadId), record], result: record })
    );
    return record;
  }

  /**
   * Clear a parent wait. When childThreadId is given the wait is only cleared if
   * it still names that child, so a completed delivery cannot clear a newer wait.
   */
  async clearWait(parentThreadId: string, childThreadId?: string): Promise<boolean> {
    return this.mutate<boolean, ParentWaitRecord>(
      PARENT_WAITS_KEY, isParentWaitRecord,
      records => {
        const current = records.find(item => item.parentThreadId === parentThreadId);
        if (!current || (childThreadId !== undefined && current.childThreadId !== childThreadId)) {
          return { records, result: false };
        }
        return { records: records.filter(item => item.parentThreadId !== parentThreadId), result: true };
      }
    );
  }

  private async read<R>(key: string, isRecord: (value: unknown) => value is R): Promise<R[]> {
    const raw = await this.store.get(key);
    const records = raw && typeof raw === "object" ? (raw as Record<string, unknown>)[key] : undefined;
    return Array.isArray(records) ? records.filter(isRecord) : [];
  }

  private async mutate<T, R>(
    key: string,
    isRecord: (value: unknown) => value is R,
    mutator: (records: R[]) => { records: R[]; result: T }
  ): Promise<T> {
    const run = async (): Promise<T> => {
      const raw = await this.store.get(key);
      const records = raw && typeof raw === "object" ? (raw as Record<string, unknown>)[key] : undefined;
      const valid = Array.isArray(records) ? records.filter(isRecord) : [];
      const { records: nextRecords, result } = mutator(valid);
      await this.store.set({ [key]: nextRecords });
      return result;
    };
    const chained = this.queue.then(run, run);
    this.queue = chained.then(() => undefined, () => undefined);
    return chained;
  }
}

export function createChromeResultDeliveryStore(chromeStorage: {
  get(key: string): Promise<unknown>;
  set(value: Record<string, unknown>): Promise<unknown>;
}): ResultDeliveryStore {
  return {
    get: key => chromeStorage.get(key ?? RESULT_DELIVERIES_KEY),
    set: value => chromeStorage.set(value)
  };
}

export function isResultDeliveryRecord(value: unknown): value is ResultDeliveryRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return isNonEmptyString(record.deliveryKey) &&
    isOperationId(record.submissionOperationId) &&
    isThreadId(record.parentThreadId) &&
    isThreadId(record.childThreadId) &&
    record.parentThreadId !== record.childThreadId &&
    isNonEmptyString(record.workItemId) &&
    isNonEmptyString(record.resultRef) &&
    (record.receiptState === undefined || record.receiptState === "INSERTED" || record.receiptState === "COMPLETED") &&
    (record.dispatchFence === undefined || isRecordedDispatchFence(record.dispatchFence)) &&
    (record.deliveredTo === undefined || isNonEmptyString(record.deliveredTo)) &&
    (record.insertedMessageRef === undefined || isNonEmptyString(record.insertedMessageRef)) &&
    (record.resultingParentTurnRef === undefined || isNonEmptyString(record.resultingParentTurnRef)) &&
    (record.insertedAt === undefined || isFiniteInteger(record.insertedAt)) &&
    (record.completedAt === undefined || isFiniteInteger(record.completedAt)) &&
    isFiniteInteger(record.createdAt) &&
    isFiniteInteger(record.updatedAt) &&
    // Receipt lifecycle shape: INSERTED requires insertion evidence; COMPLETED
    // requires INSERTED and completion evidence; no receipt means no evidence.
    (record.receiptState !== "INSERTED" ||
      (isFiniteInteger(record.insertedAt) && isNonEmptyString(record.deliveredTo))) &&
    (record.receiptState !== "COMPLETED" ||
      (isFiniteInteger(record.insertedAt) && isNonEmptyString(record.deliveredTo) && isFiniteInteger(record.completedAt))) &&
    (record.receiptState !== undefined ||
      (record.insertedAt === undefined && record.completedAt === undefined && record.deliveredTo === undefined));
}

function isRecordedDispatchFence(value: unknown): value is RecordedDispatchFence {
  if (!value || typeof value !== "object") return false;
  const fence = value as Record<string, unknown>;
  return isNonEmptyString(fence.providerConversationRef) &&
    isNonEmptyString(fence.leaseOwnerRef) &&
    isNonEmptyString(fence.targetCarrierRef) &&
    isFiniteInteger(fence.bindingEpoch) && fence.bindingEpoch >= 0 &&
    isFiniteInteger(fence.leaseGeneration) && fence.leaseGeneration >= 0;
}

function isParentWaitRecord(value: unknown): value is ParentWaitRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return isThreadId(record.parentThreadId) &&
    isThreadId(record.childThreadId) &&
    record.parentThreadId !== record.childThreadId &&
    isParentWaitKind(record.kind) &&
    isFiniteInteger(record.since);
}

function isCreateDeliveryInput(value: unknown): value is CreateDeliveryInput {
  if (!value || typeof value !== "object") return false;
  const input = value as Record<string, unknown>;
  return isOperationId(input.submissionOperationId) &&
    isThreadId(input.parentThreadId) &&
    isThreadId(input.childThreadId) &&
    input.parentThreadId !== input.childThreadId &&
    isNonEmptyString(input.workItemId) &&
    isNonEmptyString(input.resultRef) &&
    (input.now === undefined || isFiniteInteger(input.now));
}

function isParentWaitKind(value: unknown): value is ParentWaitKind {
  return value === "WAIT_REVIEW" || value === "WAIT_WORKER";
}

function isOperationId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/.test(value);
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
