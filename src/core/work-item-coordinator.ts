import { WorkItemValidationError, type WorkItemInboxState } from "./work-item-inbox";

export interface WorkItemCoordinatorStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(value: Record<string, unknown>): Promise<void>;
}

export interface WorkItemCoordinator {
  update(expectedRevision: number, next: WorkItemInboxState): Promise<boolean>;
}

export interface WorkItemLockManager {
  request<T>(
    name: string,
    options: { mode: "exclusive" },
    callback: () => Promise<T>
  ): Promise<T>;
}

export function createChromeWorkItemCoordinator(
  storage: WorkItemCoordinatorStorage,
  key = "noosWorkItemInbox",
  lockManager: WorkItemLockManager | null | undefined =
    typeof navigator !== "undefined" && navigator.locks
      ? (navigator.locks as unknown as WorkItemLockManager)
      : undefined
): WorkItemCoordinator {
  return {
    update(expectedRevision, next) {
      if (!lockManager) {
        return Promise.reject(
          new WorkItemValidationError(
            "atomic_coordinator_unavailable",
            "A shared browser lock is required for atomic Work Item persistence."
          )
        );
      }
      return lockManager.request(`noos-work-item:${key}`, { mode: "exclusive" }, async () => {
          const stored = await storage.get(key);
          const current = stored[key] as WorkItemInboxState | undefined;
          if ((current?.revision ?? 0) !== expectedRevision) {
            return false;
          }
          await storage.set({ [key]: structuredClone(next) });
          return true;
        });
    }
  };
}
