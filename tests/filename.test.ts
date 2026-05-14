import { describe, expect, it } from "vitest";
import { createCrystalFilename, createCrystalPreferredPath, createPreferredPath, createThreadFilename, slugify } from "../src/core/filename";

const DATE = new Date("2026-05-02T00:00:00.000Z");

describe("filename helpers", () => {
  it("slugifies titles for portable markdown filenames", () => {
    expect(slugify("Build NOOS Shuttle: v0 / Capture!")).toBe("build-noos-shuttle-v0-capture");
  });

  it("creates dated markdown filenames", () => {
    expect(createThreadFilename("Build NOOS Shuttle", DATE)).toBe("2026-05-02-build-noos-shuttle.md");
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
