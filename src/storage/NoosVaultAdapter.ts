import { createThreadFilename } from "../core/filename";
import type { NoosThread } from "../core/noos-thread";
import type { SaveOptions, SaveResult, StorageAdapter } from "./StorageAdapter";

interface VaultSaveResponse {
  ok: boolean;
  backend?: string;
  location?: string;
  importHint?: string;
  errorCode?: string;
  message?: string;
}

export class NoosVaultAdapter implements StorageAdapter {
  id = "noos-vault";
  name = "NOOS Vault";

  async saveThread(thread: NoosThread, options?: SaveOptions): Promise<SaveResult> {
    const filename = options?.filename ?? createThreadFilename(thread.title);

    try {
      const response = await chrome.runtime.sendMessage<{
        type: "NOOS_SAVE_HANDOFF_TO_VAULT";
        filename: string;
        content: string;
      }, VaultSaveResponse>({
        type: "NOOS_SAVE_HANDOFF_TO_VAULT",
        filename,
        content: thread.rawMarkdown
      });

      return {
        ok: response?.ok ?? false,
        adapterId: this.id,
        location: response?.location,
        errorCode: response?.errorCode,
        message: response?.message ?? "NOOS Vault save failed."
      };
    } catch (error) {
      return {
        ok: false,
        adapterId: this.id,
        errorCode: "vault_failed",
        message: error instanceof Error ? error.message : "NOOS Vault save failed."
      };
    }
  }
}
