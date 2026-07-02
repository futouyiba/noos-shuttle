import type { HubHealth, VaultFileSummary } from "../types";
import { escapeHtml, formatDisplayPath, formatModifiedAt } from "../ui/html";
import { configRow } from "./components";

export function renderVault(health: HubHealth): string {
  const mirrorCount = health.vault_stats.browser_handoffs + health.vault_stats.browser_crystals;
  const vaultCount = health.vault_stats.handoffs_active + health.vault_stats.crystals_active;
  const isFirstUse = vaultCount === 0 && mirrorCount === 0;
  const connectionState = health.local_write.paired ? "已连接" : "等待首次自动连接";
  const recommendedAction = isFirstUse
    ? "创建第一个 Handoff"
    : mirrorCount > 0
      ? "导入 Browser Mirror"
      : health.local_write.paired
        ? "打开 Vault"
        : "保存时自动连接";

  return `
    <section class="section-head">
      <div>
        <p class="eyebrow">NOOS Vault</p>
        <h2>本机产物存储中心</h2>
      </div>
      <div class="section-actions">
        <button type="button" data-run="open-vault">打开 Vault</button>
        <button type="button" data-run="import-browser-vault">导入 Browser Mirror</button>
        <button type="button" data-run="sync-handoffs-git">同步 Handoff 到 Git</button>
        <button type="button" data-run="open-runtime-current">打开当前 Projection</button>
      </div>
    </section>
    <section class="vault-command">
      <div>
        <p class="eyebrow">推荐动作</p>
        <h3>${escapeHtml(recommendedAction)}</h3>
        <p>${escapeHtml(recommendedVaultCopy({ isFirstUse, mirrorCount, paired: health.local_write.paired }))}</p>
      </div>
      <span class="pill pill--${health.local_write.paired ? "ready" : "needs_action"} connection-pill">${escapeHtml(connectionState)}</span>
    </section>
    ${isFirstUse ? renderVaultEmptyState() : ""}
    <section class="vault-flow" aria-label="Vault workflow">
      ${vaultFlowCard({
        index: "01",
        title: "收进来",
        status: mirrorCount > 0 ? `${mirrorCount} 个待导入` : health.local_write.paired ? "浏览器可直写" : "等待首次连接",
        detail:
          mirrorCount > 0
            ? "先把 Browser Mirror 的回退文件导入本机 Vault，避免同一份上下文散在两个地方。"
            : "浏览器保存的新 Handoff / Crystal 会优先写入本机 Vault；Hub 不在时才回退到 Mirror。",
        primaryAction: { id: mirrorCount > 0 ? "import-browser-vault" : "open-browser-mirror", label: mirrorCount > 0 ? "导入 Mirror" : "查看 Mirror" },
        secondaryAction: { id: "open-browser-mirror", label: "打开目录" }
      })}
      ${vaultFlowCard({
        index: "02",
        title: "放稳",
        status: `${health.vault_stats.handoffs_active} Handoff · ${health.vault_stats.crystals_active} Crystal`,
        detail: `本机 Vault 位于 ${formatDisplayPath(`${health.noos_home}/vault`, health.noos_home)}。默认先本地保存，Git 同步由你主动触发。`,
        primaryAction: { id: "open-vault", label: "打开 Vault" }
      })}
      ${vaultFlowCard({
        index: "03",
        title: "交出去",
        status: vaultCount > 0 ? "可生成 Projection" : "等待本机对象",
        detail: "把选中的 Handoff / Crystal 复制成 agent 能直接读取的 runtime/current 任务文件夹。",
        primaryAction: { id: "open-runtime-current", label: "打开 Projection" },
        secondaryAction: { id: "sync-handoffs-git", label: "同步 Handoff" }
      })}
    </section>
    <section class="vault-recent">
      ${recentVaultPanel("handoffs", "最近 Handoff", "交给下游 Agent 继续执行", health.recent_files.handoffs, health.noos_home)}
      ${recentVaultPanel("crystals", "最近 Crystal", "长期复用的讨论结晶", health.recent_files.crystals, health.noos_home)}
    </section>
    <section id="vault-browser" class="vault-browser">
      <div class="vb-loading">加载文件列表…</div>
    </section>
    <details class="diagnostics">
      <summary>高级 / 诊断</summary>
      <div class="diagnostics-grid">
        ${configRow("浏览器连接", health.local_write.paired ? "已连接" : "首次保存时自动连接", "本机 token 只用于授权 Browser Shuttle 写入 Hub。")}
        ${configRow("本机端口", health.local_write.endpoint, "只监听本机 127.0.0.1。")}
        ${configRow("Handoff Vault", formatDisplayPath(`${health.noos_home}/vault/handoffs/active`, health.noos_home), "面向下游 coding agent 的任务交接稿。")}
        ${configRow("Crystal Vault", formatDisplayPath(`${health.noos_home}/vault/crystals/active`, health.noos_home), "面向长期复用的讨论结晶。")}
        ${configRow("Browser Mirror", "~/Downloads/NOOS/vault", "Hub 未运行时的浏览器可写回退目录。")}
      </div>
      <button type="button" data-run="reset-browser-connection">重置浏览器连接</button>
    </details>
  `;
}

function vaultFlowCard({
  index,
  title,
  status,
  detail,
  primaryAction,
  secondaryAction
}: {
  index: string;
  title: string;
  status: string;
  detail: string;
  primaryAction: { id: string; label: string };
  secondaryAction?: { id: string; label: string };
}): string {
  return `
    <article class="vault-flow-card">
      <span>${escapeHtml(index)}</span>
      <div>
        <h3>${escapeHtml(title)}</h3>
        <strong>${escapeHtml(status)}</strong>
        <p>${escapeHtml(detail)}</p>
      </div>
      <div class="vault-flow-actions">
        <button type="button" data-run="${escapeHtml(primaryAction.id)}">${escapeHtml(primaryAction.label)}</button>
        ${secondaryAction ? `<button type="button" data-run="${escapeHtml(secondaryAction.id)}">${escapeHtml(secondaryAction.label)}</button>` : ""}
      </div>
    </article>
  `;
}

function recommendedVaultCopy({
  isFirstUse,
  mirrorCount,
  paired
}: {
  isFirstUse: boolean;
  mirrorCount: number;
  paired: boolean;
}): string {
  if (isFirstUse) {
    return "Vault 还没有本机产物。先从浏览器保存一次 Handoff，或导入已有的 Browser Mirror 文件。";
  }
  if (mirrorCount > 0) {
    return "Browser Mirror 里还有待导入文件。先导入本机 Vault，再决定是否同步到 Git。";
  }
  if (paired) {
    return "Browser Shuttle 已可直接写入本机 NOOS Vault。";
  }
  return "Browser Shuttle 会在首次保存时自动连接 Hub；Hub 未运行时才回退到 Browser Mirror。";
}

function renderVaultEmptyState(): string {
  return `
    <section class="empty-state vault-empty-state">
      <p class="eyebrow">首次使用</p>
      <h3>还没有 Handoff 或 Crystal</h3>
      <p>从浏览器插件保存一次对话，Hub 会把它放入本机 Vault；如果之前离线保存过，也可以先导入 Browser Mirror。</p>
      <div class="empty-actions">
        <button type="button" data-run="open-vault">打开 Vault</button>
        <button type="button" data-run="import-browser-vault">导入 Browser Mirror</button>
      </div>
    </section>
  `;
}

function recentVaultPanel(
  groupId: string,
  title: string,
  subtitle: string,
  files: VaultFileSummary[],
  noosHome: string
): string {
  return `
    <article class="recent-panel">
      <header>
        <div>
          <h3>${escapeHtml(title)}</h3>
          <p>${escapeHtml(subtitle)}</p>
        </div>
      </header>
      ${
        files.length
          ? `<div class="recent-list">${files.map((file, index) => renderRecentFile(groupId, file, index, noosHome)).join("")}</div>`
          : `<div class="recent-empty">还没有本机文件。</div>`
      }
    </article>
  `;
}

function renderRecentFile(groupId: string, file: VaultFileSummary, index: number, noosHome: string): string {
  const title = file.title || file.name;
  const key = file.key || file.name.replace(/\.md$/i, "");
  return `
    <article class="recent-file">
      <div class="recent-file-title">
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(formatModifiedAt(file.modified_epoch))}</span>
      </div>
      <span>${escapeHtml(key)}</span>
      <code>${escapeHtml(formatDisplayPath(file.path, noosHome))}</code>
      ${file.source_url ? `<small>${escapeHtml(file.source_url)}</small>` : ""}
      <div class="recent-actions">
        <button type="button" data-vault-group="${escapeHtml(groupId)}" data-vault-index="${index}" data-vault-file-action="open-vault-file">打开</button>
        <button type="button" data-vault-group="${escapeHtml(groupId)}" data-vault-index="${index}" data-vault-file-action="project-runtime">交给 Agent</button>
      </div>
    </article>
  `;
}
