import { createThreadFilenameFromThread } from "../core/filename";
import type { NoosThread } from "../core/noos-thread";
import { EXTENSION_CONTEXT_INVALID, sendExtensionMessage } from "../shared/extension-runtime";
import type { SaveOptions, SaveResult, StorageAdapter } from "./StorageAdapter";

interface VaultSaveResponse {
  ok: boolean;
  backend?: string;
  location?: string;
  lookupKey?: string;
  key?: string;
  objectId?: string;
  importHint?: string;
  errorCode?: string;
  message?: string;
}

export class NoosVaultAdapter implements StorageAdapter {
  id = "noos-vault";
  name = "NOOS Vault";

  async saveThread(thread: NoosThread, options?: SaveOptions): Promise<SaveResult> {
    const filename = options?.filename ?? createThreadFilenameFromThread(thread);

    try {
      const response = await sendExtensionMessage<
        {
        type: "NOOS_SAVE_HANDOFF_TO_VAULT";
        filename: string;
        content: string;
        },
        VaultSaveResponse
      >({
        type: "NOOS_SAVE_HANDOFF_TO_VAULT",
        filename,
        content: thread.rawMarkdown
      });

      return {
        ok: response?.ok ?? false,
        adapterId: this.id,
        backend: response?.backend,
        location: response?.location,
        errorCode: response?.errorCode,
        message: response?.message ?? "NOOS Vault save failed.",
        lookupKey: response?.lookupKey ?? response?.key,
        key: response?.lookupKey ?? response?.key,
        objectId: response?.objectId
      };
    } catch (error) {
      return {
        ok: false,
        adapterId: this.id,
        errorCode: error instanceof Error && error.message === EXTENSION_CONTEXT_INVALID ? EXTENSION_CONTEXT_INVALID : "vault_failed",
        message: error instanceof Error ? error.message : "NOOS Vault save failed."
      };
    }
  }
}
