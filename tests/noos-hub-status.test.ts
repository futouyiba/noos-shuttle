import { describe, expect, it } from "vitest";
import { adapterStatus, adapterStatusSummary, chooseNextAction, sleepRecoveryDisplay } from "../apps/noos-hub/src/status";
import type { AdapterHealth, AdapterKind, AdapterStatus, HubHealth, SleepRecoveryStatus } from "../apps/noos-hub/src/types";
import { formatDisplayPath } from "../apps/noos-hub/src/ui/html";

describe("NOOS Hub status helpers", () => {
  it("splits adapter counts into explicit status buckets", () => {
    const adapters = [
      adapter("a", "capture", "ready"),
      adapter("b", "transport", "missing"),
      adapter("c", "consumer", "needs_action"),
      adapter("d", "consumer", "partial"),
      adapter("e", "workspace", "error")
    ];

    expect(adapterStatusSummary(adapters)).toEqual({
      ready: 1,
      needsAction: 2,
      partial: 1,
      error: 1
    });
  });

  it("prioritizes errors before setup actions", () => {
    const adapters = [
      adapter("needs-setup", "transport", "missing"),
      adapter("broken", "consumer", "error")
    ];

    expect(chooseNextAction(adapters)?.id).toBe("broken");
  });

  it("summarizes pipeline status by adapter kind", () => {
    const health = healthWith([
      adapter("transport-ready", "transport", "ready"),
      adapter("transport-missing", "transport", "missing")
    ]);

    expect(adapterStatus(health, "transport")).toBe("needs_action");
    expect(adapterStatus(health, "capture")).toBe("missing");
  });

  it("uses a clear preview label outside Tauri runtime", () => {
    const display = sleepRecoveryDisplay(recoveryStatus("running"), false);

    expect(display.dataState).toBe("preview");
    expect(display.text).toBe("睡眠恢复：预览模式");
  });

  it("formats local home paths with a tilde", () => {
    expect(formatDisplayPath("/Users/songfu/.noos/vault/handoffs/active/a.md", "/Users/songfu/.noos")).toBe(
      "~/.noos/vault/handoffs/active/a.md"
    );
  });
});

function healthWith(adapters: AdapterHealth[]): HubHealth {
  return {
    repo_root: "/Users/songfu/project",
    noos_home: "/Users/songfu/.noos",
    local_write: { endpoint: "http://127.0.0.1:17642", paired: true },
    vault_stats: {
      handoffs_active: 0,
      crystals_active: 0,
      browser_handoffs: 0,
      browser_crystals: 0
    },
    recent_files: { handoffs: [], crystals: [] },
    adapters
  };
}

function adapter(id: string, kind: AdapterKind, status: AdapterStatus): AdapterHealth {
  return {
    id,
    name: id,
    kind,
    status,
    summary: `${id} summary`,
    checks: [],
    actions: [{ id: `fix-${id}`, label: "处理" }]
  };
}

function recoveryStatus(state: SleepRecoveryStatus["state"]): SleepRecoveryStatus {
  return {
    state,
    last_reason: "browser preview",
    attempts: 0,
    local_write_healthy: true,
    relaunch_recommended: false,
    message: "ready"
  };
}

