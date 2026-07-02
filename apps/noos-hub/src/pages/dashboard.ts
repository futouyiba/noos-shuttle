import { adapterStatusSummary, chooseNextAction, kindLabels, statusLabels } from "../status";
import type { AdapterHealth, AdapterKind, HubHealth, VaultFileSummary } from "../types";
import { escapeHtml, formatModifiedAt } from "../ui/html";

const kindOrder: AdapterKind[] = ["capture", "transport", "consumer", "workspace"];

export function renderDashboard(health: HubHealth): string {
  const summary = adapterStatusSummary(health.adapters);
  const nextAction = chooseNextAction(health.adapters);
  const mirrorCount = health.vault_stats.browser_handoffs + health.vault_stats.browser_crystals;
  const vaultCount = health.vault_stats.handoffs_active + health.vault_stats.crystals_active;
  const blockers = summary.error + summary.needsAction + summary.partial;

  return `
    <section class="db-hero">
      <div class="db-hero-left">
        <p class="eyebrow">本机上下文中枢</p>
        <h2>${nextAction ? `${blockers} 项待处理` : "一切就绪"}</h2>
        <p>${escapeHtml(dashboardSummary({ summary, vaultCount, mirrorCount }))}</p>
        <div class="db-hero-actions">
          <button type="button" data-run="doctor">运行 Doctor</button>
        </div>
      </div>
      <div class="db-hero-right">
        <div class="db-hero-stat">
          <span>${summary.ready}</span>
          <strong>就绪</strong>
        </div>
        <div class="db-hero-stat">
          <span>${vaultCount}</span>
          <strong>本机对象</strong>
        </div>
        ${mirrorCount > 0 ? `
        <div class="db-hero-stat db-hero-stat--warn">
          <span>${mirrorCount}</span>
          <strong>待导入</strong>
        </div>` : ""}
      </div>
    </section>

    <section class="db-status-cards">
      ${kindOrder.map((kind) => renderStatusCard(health.adapters, kind)).join("")}
    </section>

    ${nextAction ? renderRecommendedAction(nextAction) : ""}

    <section class="db-recent">
      <div class="db-recent-header">
        <h3>最近文件</h3>
        <button type="button" data-section="vault">打开 Vault</button>
      </div>
      <div class="db-recent-grid">
        ${renderRecentGroup("handoffs", "Handoff", health.recent_files.handoffs, health.noos_home)}
        ${renderRecentGroup("crystals", "Crystal", health.recent_files.crystals, health.noos_home)}
      </div>
    </section>

    <details class="db-about">
      <summary>NOOS 是什么？</summary>
      <div class="db-about-grid">
        <div class="db-about-card">
          <strong>Handoff（任务交接单）</strong>
          <p>AI 对话整理出的结构化任务稿，包含目标、上下文、约束和验收标准，交给下游 coding agent 继续执行。</p>
        </div>
        <div class="db-about-card">
          <strong>Crystal（结论卡片）</strong>
          <p>从对话中提炼的可复用结论——设计决策、技术选型、架构原则——以 key 索引，长期保存在 Vault 里。</p>
        </div>
        <div class="db-about-card">
          <strong>Vault（本机资料库）</strong>
          <p>Handoff 和 Crystal 都存在 <code>~/.noos/vault/</code> 下面。Git 同步是独立动作，不会自动推到远端。</p>
        </div>
        <div class="db-about-card">
          <strong>连接器</strong>
          <p>Hub 通过连接器感知浏览器插件、Git、Codex / Claude Code 的安装状态，并生成对应的安装或修复动作。</p>
        </div>
      </div>
      <div class="db-about-actions">
        <button type="button" data-section="help">打开完整帮助</button>
      </div>
    </details>
  `;
}

function dashboardSummary({
  summary,
  vaultCount,
  mirrorCount
}: {
  summary: ReturnType<typeof adapterStatusSummary>;
  vaultCount: number;
  mirrorCount: number;
}): string {
  const total = summary.ready + summary.partial + summary.error + summary.needsAction;
  if (total === 0) return "还没有检测到任何连接器。——运行 Doctor 开始配置。";

  const lines: string[] = [];
  lines.push(`${summary.ready}/${total} 个连接器就绪`);

  if (vaultCount > 0 || mirrorCount > 0) {
    const fileParts: string[] = [];
    if (vaultCount > 0) fileParts.push(`${vaultCount} 个本机文件`);
    if (mirrorCount > 0) fileParts.push(`${mirrorCount} 个待导入`);
    lines.push(fileParts.join("，"));
  }

  const issues: string[] = [];
  if (summary.error > 0) issues.push(`${summary.error} 异常`);
  if (summary.needsAction > 0) issues.push(`${summary.needsAction} 未安装`);
  if (summary.partial > 0) issues.push(`${summary.partial} 待完善`);
  if (issues.length > 0) lines.push(`${issues.join("、")}`);

  return lines.join("  ·  ");
}

function renderStatusCard(adapters: AdapterHealth[], kind: AdapterKind): string {
  const group = adapters.filter((adapter) => adapter.kind === kind);
  if (!group.length) return "";

  const worstStatus = group.reduce<AdapterHealth["status"]>((worst, adapter) => {
    const order: AdapterHealth["status"][] = ["ready", "partial", "needs_action", "missing", "error"];
    return order.indexOf(adapter.status) > order.indexOf(worst) ? adapter.status : worst;
  }, "ready");

  return `
    <article class="db-card db-card--${worstStatus}">
      <header>
        <span class="pill pill--${worstStatus}">${statusLabels[worstStatus]}</span>
        <strong>${kindLabels[kind]}</strong>
      </header>
      <ul>
        ${group.map((adapter) => `
          <li class="db-card-item">
            <span class="dot dot--${adapter.status}" title="${statusLabels[adapter.status]}"></span>
            <strong>${escapeHtml(adapter.name)}</strong>
            ${adapter.actions.length > 0 ? adapter.actions.slice(0, 1).map((action) =>
              `<button type="button" data-run="${escapeHtml(action.id)}" class="db-card-action">${escapeHtml(action.label)}</button>`
            ).join("") : ""}
          </li>
        `).join("")}
      </ul>
    </article>
  `;
}

function renderRecommendedAction(nextAction: AdapterHealth): string {
  const firstAction = nextAction.actions[0];
  const isCritical = nextAction.status === "error" || nextAction.status === "missing";

  return `
    <section class="db-recommend ${isCritical ? "db-recommend--critical" : "db-recommend--normal"}">
      <div class="db-recommend-icon">${isCritical ? "!" : "→"}</div>
      <div>
        <p class="eyebrow">建议操作</p>
        <h3>${escapeHtml(nextAction.name)}</h3>
        <p>${escapeHtml(nextAction.summary)}</p>
      </div>
      ${firstAction ? `<button type="button" data-run="${escapeHtml(firstAction.id)}">${escapeHtml(firstAction.label)}</button>` : ""}
    </section>
  `;
}

function renderRecentGroup(
  groupId: string,
  label: string,
  files: VaultFileSummary[],
  noosHome: string
): string {
  return `
    <article class="db-recent-group">
      <h4>${label}${files.length > 0 ? ` · ${files.length}` : ""}</h4>
      ${
        files.length
          ? `<div class="db-recent-list">${files.slice(0, 4).map((file, index) => renderRecentFile(groupId, file, index, noosHome)).join("")}</div>`
          : `<div class="recent-empty">还没有 ${label}。从浏览器插件保存一次对话即可生成。</div>`
      }
    </article>
  `;
}

function renderRecentFile(groupId: string, file: VaultFileSummary, index: number, noosHome: string): string {
  const title = file.title || file.name;
  return `
    <article class="db-recent-file">
      <div>
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(formatModifiedAt(file.modified_epoch))}</span>
      </div>
      <div class="db-recent-actions">
        <button type="button" data-vault-group="${escapeHtml(groupId)}" data-vault-index="${index}" data-vault-file-action="open-vault-file">打开</button>
      </div>
    </article>
  `;
}
