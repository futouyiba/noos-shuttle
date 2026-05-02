import type { NoosThread } from "../core/noos-thread";
import type { SaveOptions, SaveResult, StorageAdapter } from "./StorageAdapter";

export class GitHubAdapter implements StorageAdapter {
  id = "github";
  name = "GitHub";

  async saveThread(_thread: NoosThread, _options?: SaveOptions): Promise<SaveResult> {
    return {
      ok: false,
      adapterId: this.id,
      errorCode: "not_implemented",
      message: "GitHub delivery is planned after copy/download are stable."
    };
  }
}
