import { describe, expect, it } from "vitest";
import { parseSectionId } from "../apps/noos-hub/src/routes";
import { renderConfig } from "../apps/noos-hub/src/pages/config";
import { renderHelp } from "../apps/noos-hub/src/pages/help";
import { renderLogs } from "../apps/noos-hub/src/pages/logs";
import { renderSystem } from "../apps/noos-hub/src/pages/system";
import { renderVault } from "../apps/noos-hub/src/pages/vault";
import { renderWorkDetail, renderWorkOverview } from "../apps/noos-hub/src/pages/work";
import type { AdapterHealth, HubHealth } from "../apps/noos-hub/src/types";

describe("NOOS Hub hash routing", () => {
  it("normalizes legacy deep links onto the new primary sections", () => {
    expect(parseSectionId("home")).toBe("work");
    expect(parseSectionId("adapters")).toBe("system");
    expect(parseSectionId("config")).toBe("system");
  });

  it("keeps harness as a diagnostic deep link and defaults unknown hashes to work", () => {
    expect(parseSectionId("harness")).toBe("harness");
    expect(parseSectionId("vault")).toBe("vault");
    expect(parseSectionId("work-detail")).toBe("work-detail");
    expect(parseSectionId("nonsense")).toBe("work");
    expect(parseSectionId(undefined)).toBe("work");
  });
});

describe("NOOS Hub Work pages (presentation fixtures)", () => {
  it("renders Work Overview with the approved hierarchy and no mutation hooks", () => {
    const html = renderWorkOverview(healthFixture());

    expect(html).toContain("Needs your attention");
    expect(html).toContain("In progress");
    expect(html).toContain("Recently changed");
    expect(html).toContain("UI fixture");
    expect(html).toContain('href="#work-detail"');
    expect(html).toContain('href="#vault"');
    expect(html).toContain('href="#system"');
    expect(html).not.toContain("data-run");
    expect(html).not.toContain("data-hc-");
  });

  it("renders Work Detail human-first with read-only adjudication intent", () => {
    const html = renderWorkDetail();

    expect(html).toContain("Needs your decision");
    expect(html).toContain("Current state");
    expect(html).toContain("Review findings");
    expect(html).toContain("Recent progress");
    expect(html).toContain("Artifacts");
    expect(html).toContain("Who is involved");
    expect(html).toContain("What happens next");
    expect(html).toContain("Start adjudication");
    expect(html).toContain("no backend mutation");
    expect(html).toContain('href="#harness"');
    expect(html).not.toContain("data-run");
  });
});

describe("NOOS Hub System page", () => {
  it("absorbs connections, configuration, diagnostics and advanced runtime surfaces", () => {
    const html = renderSystem(healthFixture(), null);

    expect(html).toContain("Connections");
    expect(html).toContain("Configuration");
    expect(html).toContain("Diagnostics");
    expect(html).toContain("Advanced");
    expect(html).toContain("Sleep recovery");
    expect(html).toContain('data-run="doctor"');
    expect(html).toContain("data-config-key");
    expect(html).toContain('href="#harness"');
    expect(html).toContain("recovery-pill");
  });
});

describe("NOOS Hub page renderers", () => {
  it("shows a first-use Vault state when all Vault and Mirror counts are zero", () => {
    const html = renderVault(
      healthFixture({
        vault_stats: {
          handoffs_active: 0,
          crystals_active: 0,
          browser_handoffs: 0,
          browser_crystals: 0
        },
        recent_files: { handoffs: [], crystals: [] }
      })
    );

    expect(html).toContain("首次使用");
    expect(html).toContain("创建第一个 Handoff");
    expect(html).toContain("~/.noos/vault");
  });

  it("formats recent Vault paths without injecting them into data-run attributes", () => {
    const html = renderVault(
      healthFixture({
        recent_files: {
          handoffs: [
            {
              name: "quote.md",
              path: `/Users/songfu/.noos/vault/handoffs/active/quote-"x"-and-equals=.md`,
              modified_epoch: 1,
              title: "Quoted Path"
            }
          ],
          crystals: []
        }
      })
    );

    expect(html).toContain("~/.noos/vault/handoffs/active/quote-&quot;x&quot;-and-equals=.md");
    expect(html).not.toContain("open-vault-file:/Users/songfu");
  });

  it("renders the current log inside the Logs page and escapes output", () => {
    const html = renderLogs("hello <script>alert(1)</script>");

    expect(html).toContain("log-page-output");
    expect(html).toContain("hello &lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("renders help content around concepts, status, and local-first storage", () => {
    const html = renderHelp(healthFixture());

    expect(html).toContain("Handoff");
    expect(html).toContain("Crystal");
    expect(html).toContain("Browser Mirror");
    expect(html).toContain("Hub 默认是本机优先");
    expect(html).toContain("~/.noos/vault/handoffs/active");
    expect(html).toContain("~/Downloads/NOOS/vault");
    expect(html).not.toContain("vault/browser-mirror");
  });

  it("escapes non-standard config select values", () => {
    const html = renderConfig(healthFixture(), {
      default_agent: `<img src=x onerror="alert(1)">`
    });

    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).not.toContain(`<img src=x onerror="alert(1)">`);
  });
});

function healthFixture(overrides: Partial<HubHealth> = {}): HubHealth {
  return {
    repo_root: "/Users/songfu/project",
    noos_home: "/Users/songfu/.noos",
    local_write: { endpoint: "http://127.0.0.1:17642", paired: true },
    vault_stats: {
      handoffs_active: 1,
      crystals_active: 1,
      browser_handoffs: 0,
      browser_crystals: 0
    },
    recent_files: {
      handoffs: [],
      crystals: []
    },
    adapters: [readyAdapter("Browser Shuttle")],
    ...overrides
  };
}

function readyAdapter(name: string): AdapterHealth {
  return {
    id: name.toLowerCase().replace(/\s+/g, "-"),
    name,
    kind: "capture",
    status: "ready",
    summary: `${name} summary`,
    checks: [],
    actions: []
  };
}
