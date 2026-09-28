import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * #130: the Hub shell must scroll per-pane, not per-page. The load-bearing
 * trio: #app pins the grid to the viewport (height, not just min-height —
 * min-height alone lets the tallest column grow the page and the body scrolls
 * everything away together); .workspace gets min-height:0 (without it the grid
 * row track grows to content height and the page scroll returns) and its own
 * overflow-y (this column is THE scroller). Behavioral verification runs via
 * scripts/verify-hub-shell-scroll.mjs (Playwright); these static pins guard
 * against silent regression of exactly those declarations.
 */

function rules(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "g"))].map(m => m[1]);
  return matches.join("\n");
}

const css = readFileSync("apps/noos-hub/src/styles.css", "utf8");

describe("hub shell scrolls per pane (#130)", () => {
  it("#app pins the grid to the viewport height, not just min-height", () => {
    const app = rules(css, "#app");
    expect(app).toMatch(/(^|\s)height:\s*100vh\s*;/);
    expect(app).toMatch(/min-height:\s*720px\s*;/);
  });

  it(".workspace owns its overflow-y — the load-bearing scroller declaration", () => {
    const workspace = rules(css, ".workspace");
    // min-height:0 is deliberately NOT pinned: review F1 of PR #131 proved it
    // redundant while overflow-y:auto stands (a scroll container's automatic
    // minimum size is already zero). The declaration remains in the CSS as
    // defensive cover for a future descendant-scroller refactor.
    expect(workspace).toMatch(/overflow-y:\s*auto\s*;/);
  });

  it("the update-dialog cap still anchors to the visual viewport (unchanged on purpose)", () => {
    const dialog = rules(css, ".update-dialog");
    expect(dialog).toMatch(/max-height:\s*min\(640px,\s*calc\(100vh\s*-\s*48px\)\)\s*;/);
  });
});
