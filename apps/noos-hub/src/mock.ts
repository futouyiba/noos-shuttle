import type { AdapterHealth, AdapterKind, AdapterStatus, HubHealth, SleepRecoveryStatus } from "./types";

export function mockHealth(): HubHealth {
  return {
    repo_root: "/Users/you/Projects/noos-shuttle",
    noos_home: "/Users/you/.noos",
    local_write: {
      endpoint: "http://127.0.0.1:17642",
      paired: true
    },
    vault_stats: {
      handoffs_active: 3,
      crystals_active: 2,
      browser_handoffs: 1,
      browser_crystals: 1
    },
    recent_files: {
      handoffs: [
        {
          name: "2026-05-20-noos-hub-vault.md",
          path: "/Users/you/.noos/vault/handoffs/active/2026-05-20-noos-hub-vault.md",
          modified_epoch: 1779290000,
          title: "NOOS Hub Vault 改版",
          key: "noos-hub-vault"
        }
      ],
      crystals: [
        {
          name: "2026-05-20-handoff-vs-crystal.md",
          path: "/Users/you/.noos/vault/crystals/active/2026-05-20-handoff-vs-crystal.md",
          modified_epoch: 1779290000,
          title: "Handoff 与 Crystal 分工",
          key: "handoff-vs-crystal"
        }
      ]
    },
    adapters: [
      mockAdapter("browser-extension", "Browser Shuttle", "capture", "needs_action", "ChatGPT 网页端生成、捕获和交付 Handoff 的扩展。"),
      mockAdapter("local-inbox", "Local Inbox", "transport", "missing", "本地 Handoff 收件箱，用于 download 和跨工具交换。"),
      mockAdapter("noos-vault", "NOOS Vault", "transport", "ready", "NOOS 本机存储中心，包含 Wiki、Handoff 和 Crystal。"),
      mockAdapter("github", "Git Sync", "transport", "ready", "把本机 NOOS Handoff Vault 同步到项目 Git 仓库。"),
      mockAdapter("workspace", "Workspace Kit", "workspace", "ready", "项目级 .noos 工作区和 agent 入口文件。"),
      mockAdapter("codex", "Codex", "consumer", "partial", "Codex 消费 NOOS Handoff 的用户级 skill。"),
      mockAdapter("claude-code", "Claude Code", "consumer", "missing", "Claude Code 消费 NOOS Handoff 的用户级和项目级 skill。")
    ]
  };
}

export function mockSleepRecoveryStatus(): SleepRecoveryStatus {
  return {
    state: "running",
    last_reason: "browser preview",
    attempts: 0,
    local_write_healthy: true,
    relaunch_recommended: false,
    message: "NOOS Hub sleep recovery is ready."
  };
}

function mockAdapter(
  id: string,
  name: string,
  kind: AdapterKind,
  status: AdapterStatus,
  summary: string
): AdapterHealth {
  return {
    id,
    name,
    kind,
    status,
    summary,
    checks: [
      { label: "主要文件", status, detail: status === "ready" ? "detected" : "needs setup" },
      { label: "配置", status: status === "missing" ? "missing" : "ready", detail: "NOOS config" }
    ],
    actions: [{ id: id === "browser-extension" ? "browser-dev-profile" : "doctor", label: "处理", requires_user_action: status === "needs_action" }]
  };
}

