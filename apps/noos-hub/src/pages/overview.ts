import { adapterStatus, adapterStatusSummary, chooseNextAction } from "../status";
import type { HubHealth } from "../types";
import { escapeHtml, formatDisplayPath } from "../ui/html";
import { metric, pipelineStep } from "./components";

export function renderOverview(health: HubHealth): string {
  const summary = adapterStatusSummary(health.adapters);
  const nextAction = chooseNextAction(health.adapters);

  return `
    <section class="summary-grid">
      ${metric("就绪", String(summary.ready), "可直接使用的连接器")}
      ${metric("需处理", String(summary.needsAction), "未安装或等待确认")}
      ${metric("部分就绪", String(summary.partial), "可用但仍需补齐")}
      ${metric("异常", String(summary.error), "需要优先排查")}
    </section>
    <section class="next-action ${nextAction ? "" : "next-action--ready"}">
      <div>
        <p>${nextAction ? "建议下一步" : "系统状态"}</p>
        <h2>${nextAction ? escapeHtml(nextAction.name) : "核心连接器已就绪"}</h2>
        <span>${nextAction ? escapeHtml(nextAction.summary) : "可以开始捕获和消费 NOOS Handoff。"}</span>
      </div>
      ${
        nextAction?.actions[0]
          ? `<button type="button" data-run="${escapeHtml(nextAction.actions[0].id)}">${escapeHtml(
              nextAction.actions[0].label
            )}</button>`
          : `<button type="button" data-run="doctor">再次检查</button>`
      }
    </section>
    <section class="pipeline">
      ${pipelineStep("捕获", "ChatGPT / Claude / Gemini", adapterStatus(health, "capture"))}
      ${pipelineStep("存储", "Handoff / Crystal / Browser Mirror", adapterStatus(health, "transport"))}
      ${pipelineStep("解析", "NOOS Resolver", "ready")}
      ${pipelineStep("消费", "Codex / Claude Code", adapterStatus(health, "consumer"))}
    </section>
    <section class="overview-context">
      <article class="panel panel--compact">
        <h3>本机 NOOS Home</h3>
        <code>${escapeHtml(formatDisplayPath(health.noos_home, health.noos_home))}</code>
      </article>
      <article class="panel panel--compact">
        <h3>当前项目</h3>
        <code>${escapeHtml(formatDisplayPath(health.repo_root, health.noos_home))}</code>
      </article>
    </section>
  `;
}

