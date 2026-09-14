/**
 * Durable child-result delivery.
 * Routes a child's result to the parent Logical Thread (never a raw tab), with
 * a deterministic ResultDeliveryKey so delivery is create-or-get idempotent.
 * INSERTED is persisted before transport; COMPLETED is recorded only after the
 * result reached the parent, and clears the parent's mechanical wait.
 * See docs: Primary Design + Child Worker Lifecycle v0 §§10-13, 16.
 */

export type ResultDeliveryState = "INSERTED" | "COMPLETED";
export type ParentWaitKind = "WAIT_REVIEW" | "WAIT_WORKER";

export interface ResultDeliveryRecord {
  deliveryKey: string;
  parentThreadId: string;
  childThreadId: string;
  workItemId: string;
  resultRef: string;
  state: ResultDeliveryState;
  createdAt: number;
  updatedAt: number;
  /** Provider conversation the result was handed to, resolved at delivery time (§11). */
  deliveredTo?: string;
  deliveredAt?: number;
  completionReceipt?: string;
}

export interface ParentWaitRecord {
  parentThreadId: string;
  kind: ParentWaitKind;
  childThreadId: string;
  since: number;
}

export interface CreateDeliveryInput {
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
 * Deterministic ResultDeliveryKey. One result from one child to one parent is
 * exactly one delivery, however many times the return path is retried (§11).
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

  /** Idempotent: re-issuing the same delivery returns the existing record. */
  async createDelivery(input: CreateDeliveryInput): Promise<ResultDeliveryRecord> {
    if (!isCreateDeliveryInput(input)) throw new Error("delivery_input_invalid");
    const deliveryKey = resultDeliveryKey(input);
    return this.mutate<ResultDeliveryRecord, ResultDeliveryRecord>(
      RESULT_DELIVERIES_KEY, isResultDeliveryRecord,
      records => {
        const existing = records.find(item => item.deliveryKey === deliveryKey);
        if (existing) return { records, result: existing };
        const now = input.now ?? Date.now();
        const record: ResultDeliveryRecord = {
          deliveryKey,
          parentThreadId: input.parentThreadId,
          childThreadId: input.childThreadId,
          workItemId: input.workItemId,
          resultRef: input.resultRef,
          state: "INSERTED",
          createdAt: now,
          updatedAt: now
        };
        return { records: [...records, record], result: record };
      }
    );
  }

  /**
   * INSERTED → COMPLETED after the result reached the parent, then clear the
   * parent's mechanical wait. Delivering is not semantic acceptance (§12), so
   * the parent wait is only cleared when it still names this child.
   */
  async completeDelivery(
    deliveryKey: string,
    receipt: { deliveredTo: string; completionReceipt: string },
    now = Date.now()
  ): Promise<ResultDeliveryRecord> {
    if (!isNonEmptyString(receipt.deliveredTo) || !isNonEmptyString(receipt.completionReceipt)) {
      throw new Error("delivery_receipt_invalid");
    }
    const completed = await this.mutate<ResultDeliveryRecord, ResultDeliveryRecord>(
      RESULT_DELIVERIES_KEY, isResultDeliveryRecord,
      records => {
        const index = records.findIndex(item => item.deliveryKey === deliveryKey);
        if (index === -1) throw new Error(`delivery_not_found:${deliveryKey}`);
        const current = records[index];
        if (current.state === "COMPLETED") return { records, result: current };
        const record: ResultDeliveryRecord = {
          ...current,
          state: "COMPLETED",
          deliveredTo: receipt.deliveredTo,
          deliveredAt: now,
          completionReceipt: receipt.completionReceipt,
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

  /** Enter (or re-enter) a parent mechanical wait. One wait per parent thread (§14). */
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
    isThreadId(record.parentThreadId) &&
    isThreadId(record.childThreadId) &&
    record.parentThreadId !== record.childThreadId &&
    isNonEmptyString(record.workItemId) &&
    isNonEmptyString(record.resultRef) &&
    (record.state === "INSERTED" || record.state === "COMPLETED") &&
    isFiniteInteger(record.createdAt) &&
    isFiniteInteger(record.updatedAt) &&
    (record.deliveredTo === undefined || isNonEmptyString(record.deliveredTo)) &&
    (record.deliveredAt === undefined || isFiniteInteger(record.deliveredAt)) &&
    (record.completionReceipt === undefined || isNonEmptyString(record.completionReceipt)) &&
    (record.state !== "COMPLETED" || isNonEmptyString(record.completionReceipt));
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
  return isThreadId(input.parentThreadId) &&
    isThreadId(input.childThreadId) &&
    input.parentThreadId !== input.childThreadId &&
    isNonEmptyString(input.workItemId) &&
    isNonEmptyString(input.resultRef) &&
    (input.now === undefined || isFiniteInteger(input.now));
}

function isParentWaitKind(value: unknown): value is ParentWaitKind {
  return value === "WAIT_REVIEW" || value === "WAIT_WORKER";
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
