import type { NoosThread } from "../core/noos-thread";
import type { SaveOptions, SaveResult, StorageAdapter } from "./StorageAdapter";

export class DownloadAdapter implements StorageAdapter {
  id = "download";
  name = "Markdown Download";

  async saveThread(thread: NoosThread, options?: SaveOptions): Promise<SaveResult> {
    const filename = options?.filename ?? "noos-thread.md";
    const blob = new Blob([thread.rawMarkdown], { type: "text/markdown;charset=utf-8" });
    const objectUrl = URL.createObjectURL(blob);

    try {
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      anchor.rel = "noopener";
      anchor.click();

      return {
        ok: true,
        adapterId: this.id,
        location: filename,
        message: `Downloaded ${filename}.`
      };
    } catch (error) {
      return {
        ok: false,
        adapterId: this.id,
        errorCode: "download_failed",
        message: error instanceof Error ? error.message : "Download failed."
      };
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  /**
   * Downloads one self-contained HTML document (issue #61 slice 4, proposal
   * §6 Q9). This is a new *call shape*, not a new landing category: the bytes go
   * to a Blob and an `<a download>` exactly like the Markdown path. The HTML is
   * never parsed, rendered, or executed by the extension.
   */
  async saveHtml(html: string, options?: SaveOptions): Promise<SaveResult> {
    const filename = options?.filename ?? "noos-overview.html";
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const objectUrl = URL.createObjectURL(blob);

    try {
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      anchor.rel = "noopener";
      anchor.click();

      return {
        ok: true,
        adapterId: this.id,
        location: filename,
        message: `Downloaded ${filename}.`
      };
    } catch (error) {
      return {
        ok: false,
        adapterId: this.id,
        errorCode: "download_failed",
        message: error instanceof Error ? error.message : "Download failed."
      };
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }
}
