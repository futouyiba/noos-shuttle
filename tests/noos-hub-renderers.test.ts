import { describe, expect, it } from "vitest";
import { renderConfig } from "../apps/noos-hub/src/pages/config";
import { renderDashboard } from "../apps/noos-hub/src/pages/dashboard";
import { renderHelp } from "../apps/noos-hub/src/pages/help";
import { renderLogs } from "../apps/noos-hub/src/pages/logs";
import { renderVault } from "../apps/noos-hub/src/pages/vault";
import type { AdapterHealth, HubHealth } from "../apps/noos-hub/src/types";

describe("NOOS Hub page renderers", () => {
  it("renders dashboard with status cards, not old card-grid layout", () => {
    const html = renderDashboard(
      healthFixture({
        adapters: [
          readyAdapter("Browser Shuttle"),
          { ...readyAdapter("NOOS Vault"), kind: "transport" }
        ]
      })
    );

    expect(html).toContain("一切就绪");
    expect(html).toContain("个连接器就绪");
    expect(html).toContain("db-card");
    expect(html).not.toContain('class="card"');
    expect(html).not.toContain("card-grid");
  });

  it("does not call partial adapters fully ready on the dashboard", () => {
    const html = renderDashboard(
      healthFixture({
        adapters: [{ ...readyAdapter("Codex"), status: "partial", summary: "Skill installed, manual setup remains" }]
      })
    );

    expect(html).toContain("1 项待处理");
    expect(html).toContain("Codex");
    expect(html).not.toContain("一切就绪");
  });

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
