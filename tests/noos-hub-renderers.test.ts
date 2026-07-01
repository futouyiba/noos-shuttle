import { describe, expect, it } from "vitest";
import { renderLogs } from "../apps/noos-hub/src/pages/logs";
import { renderOverview } from "../apps/noos-hub/src/pages/overview";
import { renderVault } from "../apps/noos-hub/src/pages/vault";
import type { AdapterHealth, HubHealth } from "../apps/noos-hub/src/types";

describe("NOOS Hub page renderers", () => {
  it("keeps the overview focused on summary instead of duplicating adapter cards", () => {
    const html = renderOverview(
      healthFixture({
        adapters: [readyAdapter("Browser Shuttle"), readyAdapter("NOOS Vault")]
      })
    );

    expect(html).toContain("需处理");
    expect(html).toContain("核心连接器已就绪");
    expect(html).not.toContain('class="card');
    expect(html).not.toContain("安装状态");
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

