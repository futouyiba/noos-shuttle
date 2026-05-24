import { describe, expect, it } from "vitest";
import {
  createCrystalFilename,
  createCrystalPreferredPath,
  createPreferredPath,
  createThreadFilename,
  createThreadFilenameFromThread,
  slugify
} from "../src/core/filename";

const DATE = new Date("2026-05-02T00:00:00.000Z");

describe("filename helpers", () => {
  it("slugifies titles for portable markdown filenames", () => {
    expect(slugify("Build NOOS Shuttle: v0 / Capture!")).toBe("build-noos-shuttle-v0-capture");
  });

  it("creates dated markdown filenames", () => {
    expect(createThreadFilename("Build NOOS Shuttle", DATE)).toBe("2026-05-02-build-noos-shuttle.md");
  });

  it("prefers handoff filename slugs from frontmatter", () => {
    expect(
      createThreadFilenameFromThread(
        {
          id: "thread",
          title: "NOOS Thread",
          rawMarkdown: "",
          frontmatter: { filename_slug: "noos-hub-auto-connect" },
          bodyMarkdown: "",
          markerRange: { begin: 0, end: 0 },
          detectedAt: DATE.toISOString(),
          warnings: []
        },
        DATE
      )
    ).toBe("2026-05-02-noos-hub-auto-connect.md");
  });

  it("derives a semantic ascii fallback from handoff content", () => {
    expect(
      createThreadFilenameFromThread(
        {
          id: "thread",
          title: "NOOS Thread",
          rawMarkdown: "",
          bodyMarkdown: "## 任务\n修复 Browser Shuttle 保存到 NOOS Vault 的自动连接流程，并更新 Hub diagnostics。",
          markerRange: { begin: 0, end: 0 },
          detectedAt: DATE.toISOString(),
          warnings: []
        },
        DATE
      )
    ).toBe("2026-05-02-browser-shuttle-vault-hub-diagnostics.md");
  });

  it("creates the preferred handoff path", () => {
    expect(createPreferredPath("Build NOOS Shuttle", DATE)).toBe(
      ".noos/handoffs/active/2026-05-02-build-noos-shuttle.md"
    );
  });

  it("creates the preferred crystal path", () => {
    expect(createCrystalFilename("NOOS Vault Route", DATE)).toBe("2026-05-02-noos-vault-route.md");
    expect(createCrystalPreferredPath("NOOS Vault Route", DATE)).toBe(
      ".noos/crystals/active/2026-05-02-noos-vault-route.md"
    );
  });
});
