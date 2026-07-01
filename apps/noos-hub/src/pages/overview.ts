import { adapterStatus, adapterStatusSummary, chooseNextAction } from "../status";
import type { HubHealth } from "../types";
import { escapeHtml, formatDisplayPath } from "../ui/html";
import { metric, pipelineStep } from "./components";

export function renderOverview(health: HubHealth): string {
  const summary = adapterStatusSummary(health.adapters);
  const nextAction = chooseNextAction(health.adapters);
  const mirrorCount = health.vault_stats.browser_handoffs + health.vault_stats.browser_crystals;
  const vaultCount = health.vault_stats.handoffs_active + health.vault_stats.crystals_active;

  return `
    <section class="overview-hero ${nextAction ? "overview-hero--attention" : "overview-hero--ready"}">
      <div>
        <p class="eyebrow">${nextAction ? "当前阻塞点" : "当前状态"}</p>
        <h2>${nextAction ? escapeHtml(nextAction.name) : "核心链路可以使用"}</h2>
        <p>${nextAction ? escapeHtml(nextAction.summary) : "可以从浏览器捕获 Handoff / Crystal，也可以把已有本机对象交给 agent 继续处理。"}</p>
      </div>
      ${
        nextAction?.actions[0]
          ? `<button type="button" data-run="${escapeHtml(nextAction.actions[0].id)}">${escapeHtml(
              nextAction.actions[0].label
            )}</button>`
          : `<button type="button" data-run="doctor">重新检查</button>`
      }
    </section>
    <section class="summary-grid">
      ${metric("就绪连接器", String(summary.ready), "能直接使用")}
      ${metric("待处理", String(summary.needsAction), "未安装或待确认")}
      ${metric("本机对象", String(vaultCount), "Handoff + Crystal")}
      ${metric("待导入", String(mirrorCount), "Browser Mirror")}
    </section>
    <section class="pipeline">
      ${pipelineStep("捕获", "ChatGPT / Claude / Gemini", adapterStatus(health, "capture"))}
      ${pipelineStep("存储", "Handoff / Crystal / Browser Mirror", adapterStatus(health, "transport"))}
      ${pipelineStep("解析", "NOOS Resolver", "ready")}
      ${pipelineStep("消费", "Codex / Claude Code", adapterStatus(health, "consumer"))}
    </section>
    <section class="overview-context" aria-label="Local context">
      <article class="panel panel--compact">
        <h3>本机 NOOS Home</h3>
        <p>个人级 Vault、配置和收件箱。</p>
        <code>${escapeHtml(formatDisplayPath(health.noos_home, health.noos_home))}</code>
      </article>
      <article class="panel panel--compact">
        <h3>当前项目</h3>
        <p>项目级 runtime projection 和 handoff 同步位置。</p>
        <code>${escapeHtml(formatDisplayPath(health.repo_root, health.noos_home))}</code>
      </article>
    </section>
  `;
}
