import { describe, expect, it } from "vitest";
import { COPY } from "../src/shared/i18n";

describe("COPY", () => {
  it("keeps English and Chinese copy keys in sync", () => {
    expect(Object.keys(COPY.zh).sort()).toEqual(Object.keys(COPY.en).sort());
  });

  it("provides non-empty strings and working formatters for both locales", () => {
    for (const localeCopy of Object.values(COPY)) {
      for (const [key, value] of Object.entries(localeCopy)) {
        if (typeof value === "function") {
          expect(value(2), key).toContain("2");
        } else {
          expect(value.trim(), key).not.toBe("");
        }
      }
    }
  });
});
