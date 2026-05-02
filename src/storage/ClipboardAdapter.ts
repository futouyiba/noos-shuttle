import type { NoosThread } from "../core/noos-thread";
import type { SaveOptions, SaveResult, StorageAdapter } from "./StorageAdapter";

export class ClipboardAdapter implements StorageAdapter {
  id = "clipboard";
  name = "Clipboard";

  async saveThread(thread: NoosThread, _options?: SaveOptions): Promise<SaveResult> {
    try {
      await navigator.clipboard.writeText(thread.rawMarkdown);
      return {
        ok: true,
        adapterId: this.id,
        location: "clipboard",
        message: "Copied to clipboard."
      };
    } catch (error) {
      return {
        ok: false,
        adapterId: this.id,
        errorCode: "clipboard_failed",
        message: error instanceof Error ? error.message : "Clipboard write failed."
      };
    }
  }
}
