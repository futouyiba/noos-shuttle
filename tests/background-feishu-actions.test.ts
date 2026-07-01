import { describe, expect, it, vi } from "vitest";

describe("background Feishu action mapping", () => {
  it("maps new export MD actions to Hub commands and keeps sync aliases", async () => {
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: {
        onInstalled: { addListener: vi.fn() },
        onMessage: { addListener: vi.fn() }
      }
    };

    const { feishuCommandForAction } = await import("../src/background/service-worker");

    expect(feishuCommandForAction("export_md")).toBe("feishu.exportMd");
    expect(feishuCommandForAction("export_md_and_organize")).toBe("feishu.exportMdAndOrganize");
    expect(feishuCommandForAction("sync_markdown")).toBe("feishu.syncMarkdown");
    expect(feishuCommandForAction("sync_markdown_and_organize")).toBe("feishu.syncMarkdownAndOrganize");
  });
});
