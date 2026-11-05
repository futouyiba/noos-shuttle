import { afterEach, describe, expect, it, vi } from "vitest";
import { DownloadAdapter } from "../src/storage/DownloadAdapter";

/**
 * Issue #61 slice 4, proposal §6 Q9/F8: the HTML artifact needs a new Downloads
 * call shape (not the Markdown `saveThread` signature), but no new landing
 * category. The bytes go to a Blob and an `<a download>`; nothing parses or
 * renders them.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DownloadAdapter.saveHtml", () => {
  it("downloads the exact HTML bytes with a text/html Blob", async () => {
    let createdBlob: Blob | undefined;
    let clicked: { download?: string; href?: string } | undefined;
    const anchor = {
      href: "",
      download: "",
      rel: "",
      click() { clicked = this; }
    };
    vi.stubGlobal("document", { createElement: () => anchor });
    vi.stubGlobal("URL", {
      createObjectURL: (blob: Blob) => { createdBlob = blob; return "blob:overview"; },
      revokeObjectURL: () => undefined
    });

    const html = "<!DOCTYPE html><html><body><script>globalThis.__pwned = true;</script></body></html>";
    const result = await new DownloadAdapter().saveHtml(html, { filename: "2026-10-30-overview.html" });

    expect(result).toMatchObject({ ok: true, location: "2026-10-30-overview.html" });
    expect(createdBlob?.type).toBe("text/html;charset=utf-8");
    expect(await createdBlob?.text()).toBe(html);
    expect(clicked?.download).toBe("2026-10-30-overview.html");
    expect(clicked?.href).toBe("blob:overview");
    expect((globalThis as { __pwned?: boolean }).__pwned).toBeUndefined();
  });

  it("returns a failure result instead of throwing when the download fails", async () => {
    vi.stubGlobal("document", { createElement: () => { throw new Error("blocked"); } });
    vi.stubGlobal("URL", { createObjectURL: () => "blob:overview", revokeObjectURL: () => undefined });

    const result = await new DownloadAdapter().saveHtml("<html></html>", { filename: "x.html" });
    expect(result).toMatchObject({ ok: false, errorCode: "download_failed", message: "blocked" });
  });
});
