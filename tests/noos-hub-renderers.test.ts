import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { parseSectionId, navSectionFor } from "../apps/noos-hub/src/routes";
import { renderConfig } from "../apps/noos-hub/src/pages/config";
import { renderHelp } from "../apps/noos-hub/src/pages/help";
import { renderLogs } from "../apps/noos-hub/src/pages/logs";
import { renderSystem } from "../apps/noos-hub/src/pages/system";
import { renderVault } from "../apps/noos-hub/src/pages/vault";
import { renderWorkDetail, renderWorkOverview } from "../apps/noos-hub/src/pages/work";
import { bindContentActions } from "../apps/noos-hub/src/ui/content-actions";
import { copyLocales } from "../apps/noos-hub/src/ui/copy";
import type { AdapterHealth, HubHealth } from "../apps/noos-hub/src/types";

describe("NOOS Hub content action binding", () => {
  it("restores refresh/run/check-update handlers after an innerHTML redraw", () => {
    const dom = new JSDOM(`
      <div id="content">
        <button type="button" data-run="doctor">doctor</button>
        <button type="button" data-action="refresh">refresh</button>
        <button type="button" data-action="check-update">check</button>
      </div>
    `);
    const calls: string[] = [];
    const handlers = {
      run: (action: string) => calls.push(`run:${action}`),
      refresh: () => calls.push("refresh"),
      checkUpdate: () => calls.push("check-update")
    };
    const content = dom.window.document.querySelector("#content")!;
    const markup = content.innerHTML;

    bindContentActions(content, handlers);
    (content.querySelector('[data-action="refresh"]') as HTMLButtonElement).click();
    expect(calls).toEqual(["refresh"]);

    // The async config redraw replaces innerHTML, dropping all listeners.
    // Re-running the same binder must bring every hook back — this is the
    // regression guard for the dead System Refresh button (PR #34).
    content.innerHTML = markup;
    bindContentActions(content, handlers);
    (content.querySelector('[data-action="refresh"]') as HTMLButtonElement).click();
    (content.querySelector("[data-run]") as HTMLButtonElement).click();
    (content.querySelector('[data-action="check-update"]') as HTMLButtonElement).click();
    expect(calls).toEqual(["refresh", "refresh", "run:doctor", "check-update"]);
  });
});

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

  it("keeps Work as the active primary section on Work Detail, none on Harness", () => {
    expect(navSectionFor("work-detail")).toBe("work");
    expect(navSectionFor("work")).toBe("work");
    expect(navSectionFor("harness")).toBe("harness");
    expect(navSectionFor("system")).toBe("system");
  });
});

describe("NOOS Hub Work pages (presentation fixtures, zh-CN default)", () => {
  it("renders Work Overview with the approved hierarchy and no mutation hooks", () => {
    const html = renderWorkOverview(healthFixture());

    expect(html).toContain("需要你注意");
    expect(html).toContain("进行中");
    expect(html).toContain("最近变化");
    expect(html).toContain("UI fixture");
    expect(html).toContain('href="#work-detail"');
    expect(html).toContain('href="#vault"');
    expect(html).toContain('href="#system"');
    expect(html).toContain('href="#harness"');
    expect(html).not.toContain("data-run");
    expect(html).not.toContain("data-hc-");
  });

  it("renders Work Detail human-first with read-only adjudication intent", () => {
    const html = renderWorkDetail();

    expect(html).toContain("需要你决定");
    expect(html).toContain("当前状态");
    expect(html).toContain("评审发现");
    expect(html).toContain("最近进展");
    expect(html).toContain("产物");
    expect(html).toContain("参与者");
    expect(html).toContain("接下来会发生什么");
    expect(html).toContain("开始裁定");
    expect(html).toContain("backend mutation");
    expect(html).toContain("示例 fixture；v0 未连接任何真实对象");
    expect(html).not.toContain("Illustrative fixture; nothing is connected");
    expect(html).toContain('href="#harness"');
    expect(html).not.toContain("data-run");
  });

  it("labels the supporting System plane by worst adapter status", () => {
    const ready = renderWorkOverview(healthFixture({ adapters: [readyAdapter("Browser Shuttle")] }));
    expect(ready).toContain("运行正常");

    const partial = renderWorkOverview(
      healthFixture({ adapters: [{ ...readyAdapter("Codex"), status: "partial" }] })
    );
    expect(partial).toContain("部分可用");

    const broken = renderWorkOverview(
      healthFixture({ adapters: [{ ...readyAdapter("Codex"), status: "error" }] })
    );
    expect(broken).toContain("需要处理");
  });
});

describe("NOOS Hub System page", () => {
  it("absorbs connections, configuration, diagnostics and advanced runtime surfaces", () => {
    const html = renderSystem(healthFixture(), null);

    expect(html).toContain("连接");
    expect(html).toContain("配置");
    expect(html).toContain("诊断");
    expect(html).toContain("高级");
    expect(html).toContain("睡眠恢复");
    expect(html).toContain('data-run="doctor"');
    expect(html).toContain('data-action="refresh"');
    expect(html).toContain("data-config-key");
    expect(html).toContain('href="#harness"');
    expect(html).toContain("recovery-pill");
  });

  it("stays quiet when healthy and surfaces a count when connections need work", () => {
    const healthy = renderSystem(healthFixture(), null);
    expect(healthy).toContain("正常工作所需的一切均可用。");
    expect(healthy).toContain("运行正常");
    expect(healthy).not.toContain("个连接需要处理");

    const degraded = renderSystem(
      healthFixture({
        adapters: [
          { ...readyAdapter("Codex"), status: "error" },
          { ...readyAdapter("Local Inbox"), status: "needs_action" }
        ]
      }),
      null
    );
    expect(degraded).toContain("2 个连接需要处理");
    expect(degraded).toContain("需要处理");
  });
});

describe("NOOS Hub copy locales", () => {
  it("keeps zh-CN and en structurally identical", () => {
    const keyPaths = (value: unknown, prefix = ""): string[] =>
      typeof value === "object" && value !== null
        ? Object.entries(value).flatMap(([key, child]) => keyPaths(child, `${prefix}${key}.`))
        : [prefix.slice(0, -1)];

    expect(keyPaths(copyLocales["zh-CN"])).toEqual(keyPaths(copyLocales.en));
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
