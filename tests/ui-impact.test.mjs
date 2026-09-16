import { describe, expect, it } from "vitest";
import { classifyUiImpact, renderUiImpactMarkdown } from "../scripts/ui-impact-core.mjs";

const baseSha = "a".repeat(40);
const headSha = "b".repeat(40);

function classify(changedFiles, diffByFile = {}) {
  return classifyUiImpact({ baseSha, headSha, changedFiles, diffByFile });
}

describe("NOOS Hub UI impact classifier", () => {
  it("classifies backend-only work as U0", () => {
    const report = classify(["src/core/cross-agent-mailbox.ts", "tests/cross-agent-mailbox.test.ts"]);
    expect(report.level).toBe("U0");
    expect(report.ui_files).toEqual([]);
    expect(report.risk_flags.review_evidence_only).toBe(false);
  });

  it("classifies review screenshots and Hub UI tests only as U1", () => {
    const report = classify([
      ".review-assets/pr-99/work.png",
      "tests/noos-hub-renderers.test.ts",
    ]);
    expect(report.level).toBe("U1");
    expect(report.risk_flags.review_evidence_only).toBe(true);
    expect(report.surfaces).toContain("Review evidence");
    expect(report.surfaces).toContain("UI tests");
  });

  it("classifies feature-local Hub page UI as U2", () => {
    const file = "apps/noos-hub/src/pages/work.ts";
    const report = classify([file], {
      [file]: '@@\n+<section class="work-local">\n+  <button type="button">Open</button>\n',
    });
    expect(report.level).toBe("U2");
    expect(report.risk_flags.user_action_surface_changed).toBe(true);
    expect(report.surfaces).toEqual(["Page:work"]);
  });

  it("keeps local page copy edits at U2 rather than inventing a structural gate", () => {
    const file = "apps/noos-hub/src/pages/system.ts";
    const report = classify([file], {
      [file]: '@@\n-<p>Old copy</p>\n+<p>New copy</p>\n',
    });
    expect(report.level).toBe("U2");
    expect(report.risk_flags.navigation_changed).toBe(false);
    expect(report.risk_flags.shell_changed).toBe(false);
  });

  it("classifies route changes as hard U3", () => {
    const file = "apps/noos-hub/src/routes.ts";
    const report = classify([file], { [file]: '@@\n+export type SectionId = "work" | "governance";\n' });
    expect(report.level).toBe("U3");
    expect(report.risk_flags.navigation_changed).toBe(true);
  });

  it("classifies shell/navigation changes in main.ts as U3", () => {
    const file = "apps/noos-hub/src/main.ts";
    const report = classify([file], {
      [file]: '@@\n+const navItems = [sectionMeta.work, sectionMeta.vault, sectionMeta.system, sectionMeta.governance];\n',
    });
    expect(report.level).toBe("U3");
    expect(report.risk_flags.shell_changed).toBe(true);
  });

  it("classifies global shell CSS as U3 but local CSS as U2", () => {
    const file = "apps/noos-hub/src/styles.css";
    const global = classify([file], { [file]: '@@\n+.sidebar { width: 260px; }\n' });
    expect(global.level).toBe("U3");
    expect(global.risk_flags.global_styles_changed).toBe(true);

    const local = classify([file], { [file]: '@@\n+.finding { padding: 12px 0; }\n' });
    expect(local.level).toBe("U2");
    expect(local.risk_flags.global_styles_changed).toBe(false);
  });

  it("marks responsive changes and shared copy changes as U2 minimum", () => {
    const style = "apps/noos-hub/src/styles.css";
    const copy = "apps/noos-hub/src/ui/copy.ts";
    const report = classify([style, copy], {
      [style]: "@@\n+@media (max-width: 700px) { .finding { display: block; } }\n",
      [copy]: '@@\n+needsAttention: "Needs attention"\n',
    });
    expect(report.level).toBe("U2");
    expect(report.risk_flags.responsive_changed).toBe(true);
    expect(report.risk_flags.copy_surface_changed).toBe(true);
  });

  it("renders exact-head machine-readable evidence in markdown", () => {
    const report = classify(["apps/noos-hub/src/pages/work.ts"]);
    const markdown = renderUiImpactMarkdown(report);
    expect(markdown).toContain(`head=${headSha}`);
    expect(markdown).toContain("Minimum impact: **U2**");
    expect(markdown).toContain('"schema": "noos.ui-impact.v0"');
    expect(markdown).toContain("not semantic authority");
  });
});
