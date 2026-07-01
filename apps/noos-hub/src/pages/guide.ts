import { chooseNextAction } from "../status";
import type { AdapterAction, AdapterHealth, AdapterStatus, HubHealth } from "../types";
import { escapeHtml, formatDisplayPath } from "../ui/html";
import { metric, modelRoadmap } from "./components";

type ModelModeId = "local" | "user-key" | "noos-cloud";

const modelModes: Array<{
  id: ModelModeId;
  name: string;
  status: AdapterStatus;
  detail: string;
}> = [
  {
    id: "local",
    name: "本地引导",
    status: "ready",
    detail: "默认启用：基于 doctor、连接器状态和本机配置生成下一步建议。"
  },
  {
    id: "user-key",
    name: "用户 Provider Key",
    status: "needs_action",
    detail: "支持 OpenAI-compatible、Anthropic、Gemini 等供应商配置。"
  },
  {
    id: "noos-cloud",
    name: "NOOS Cloud Relay",
    status: "missing",
    detail: "预留产品化入口：由 NOOS 分发额度 token，Hub 不保存供应商主 key。"
  }
];

export function renderGuide(health: HubHealth): string {
  const items = guideItems(health);
  return `
    <section class="guide-layout">
      <article class="guide-main">
        <p class="eyebrow">引导 Agent</p>
        <h2>本机安装引导</h2>
        <p>当前版本先用本地规则读取连接器状态。模型接入后，它会解释错误、总结 doctor 输出，并把下一步动作压缩成可确认的按钮。</p>
        <div class="guide-steps">
          ${items
            .map(
              (item, index) => `
                <article class="guide-step guide-step--${item.status}">
                  <span>${String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <strong>${escapeHtml(item.title)}</strong>
                    <p>${escapeHtml(item.detail)}</p>
                  </div>
                  ${item.action ? `<button type="button" data-run="${escapeHtml(item.action.id)}">${escapeHtml(item.action.label)}</button>` : ""}
                </article>
              `
            )
            .join("")}
        </div>
      </article>
      <aside class="model-panel">
        <p class="eyebrow">模型层</p>
        <h2>模型接入策略</h2>
        <div class="model-modes">
          ${modelModes
            .map(
              (mode) => `
                <article class="model-mode model-mode--${mode.status}">
                  <span class="dot dot--${mode.status}"></span>
                  <div>
                    <strong>${escapeHtml(mode.name)}</strong>
                    <small>${escapeHtml(mode.detail)}</small>
                  </div>
                </article>
              `
            )
            .join("")}
        </div>
      </aside>
    </section>
    <section class="model-roadmap">
      ${modelRoadmap("v0", "本地规则", "不需要 token；只解释本机状态和安装脚本结果。")}
      ${modelRoadmap("v1", "Provider Adapter", "用户配置 base URL、model 和 API key；Hub 只调用抽象 provider。")}
      ${modelRoadmap("v2", "NOOS Relay", "NOOS Cloud 分发短期额度 token；客户端不接触供应商主 key。")}
    </section>
  `;
}

export function renderGuideSnapshot(health: HubHealth): string {
  const nextAction = chooseNextAction(health.adapters);
  const ready = health.adapters.filter((adapter) => adapter.status === "ready").length;
  return `
    <section class="snapshot-grid">
      ${metric("就绪", String(ready), "可用连接器")}
      ${metric("下一步", nextAction?.name ?? "Doctor", "建议动作")}
      <article class="snapshot-note">
        <strong>${nextAction ? escapeHtml(nextAction.summary) : "核心链路已具备基础可用性。"}</strong>
        <span>${escapeHtml(formatDisplayPath(health.repo_root, health.noos_home))}</span>
      </article>
    </section>
  `;
}

function guideItems(health: HubHealth): Array<{
  title: string;
  detail: string;
  status: AdapterStatus;
  action?: AdapterAction;
}> {
  const nextAction = chooseNextAction(health.adapters);
  const inbox = findAdapter(health.adapters, "local-inbox");
  const codex = findAdapter(health.adapters, "codex");

  return [
    {
      title: "确认 NOOS Hub 状态",
      detail: `本机 Hub 位于 ${formatDisplayPath(health.noos_home, health.noos_home)}，Doctor 会刷新 workspace、consumer skill、browser extension 和 GitHub auth。`,
      status: "ready",
      action: { id: "doctor", label: "运行 Doctor" }
    },
    {
      title: nextAction ? `处理 ${nextAction.name}` : "核心链路已就绪",
      detail: nextAction ? nextAction.summary : "可以开始从浏览器捕获 Handoff，并交给 coding agent 消费。",
      status: nextAction?.status ?? "ready",
      action: nextAction?.actions[0]
    },
    {
      title: "补齐本地上下文收件箱",
      detail: inbox?.status === "ready" ? "Local Inbox 已可用于 download 和跨工具交换。" : "Local Inbox 可以作为 Chatbox 到本机 agent 的最低摩擦传输层。",
      status: inbox?.status ?? "missing",
      action: { id: "create-inbox", label: "创建 Inbox" }
    },
    {
      title: "准备模型引导层",
      detail: codex?.status === "ready" ? "Codex consumer 已就绪，后续可加入模型解释层。" : "先使用本地引导；配置 provider key 或 NOOS Cloud Relay 后再启用模型解释。",
      status: "partial"
    }
  ];
}

function findAdapter(adapters: AdapterHealth[], id: string): AdapterHealth | undefined {
  return adapters.find((adapter) => adapter.id === id);
}
