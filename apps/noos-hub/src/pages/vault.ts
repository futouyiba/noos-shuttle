import type { HubHealth, VaultFileSummary } from "../types";
import { escapeHtml, formatDisplayPath } from "../ui/html";
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
    <div class="vault-layout">
      <article class="panel panel--primary">
        <h3>NOOS Vault</h3>
        <p>本机存储中心：<code>${escapeHtml(formatDisplayPath(`${health.noos_home}/vault`, health.noos_home))}</code></p>
        <p>Wiki、Handoff 和 Crystal 都先落到本机 NOOS 文件系统。Git 同步是单独动作，避免把临时文件无意推到远端。</p>
        <button type="button" data-run="open-vault">打开 Vault</button>
      </article>
      <article class="panel">
        <h3>Runtime Projection</h3>
        <p>把选中的 Handoff / Crystal 复制成 Codex、Claude Code、OpenCode 能自然读取的任务文件夹。</p>
        <p>Agent 进入任务后先读 <code>.noos/runtime/current/READ_ME_FIRST.md</code>。</p>
        <button type="button" data-run="open-runtime-current">打开当前 Projection</button>
      </article>
      <article class="panel">
        <h3>Browser Mirror</h3>
        <p>待导入文件：<strong>${mirrorCount}</strong></p>
        <p>Hub 未运行时，插件会先把 Handoff / Crystal 保存到 Browser Mirror。</p>
        <button type="button" data-run="import-browser-vault">导入 Mirror</button>
        <button type="button" data-run="open-browser-mirror">打开 Mirror</button>
      </article>
      <article class="panel">
        <h3>Git Sync</h3>
        <p>Handoff 需要跨机器或给远端 agent 消费时，再同步到 Git。</p>
        <p>Crystal 默认保留在本机 Vault，可按 key 检索。</p>
        <button type="button" data-run="sync-handoffs-git">同步 Handoff 到 Git</button>
      </article>
    </div>
    <section class="vault-inline-stats" aria-label="Vault counts">
      <span>Handoff: <strong>${health.vault_stats.handoffs_active}</strong></span>
      <span>Crystal: <strong>${health.vault_stats.crystals_active}</strong></span>
      <span>Mirror: <strong>${mirrorCount}</strong></span>
    </section>
    <section class="vault-recent">
      ${recentVaultPanel("handoffs", "最近 Handoff", "交给下游 Agent 继续执行", health.recent_files.handoffs, health.noos_home)}
      ${recentVaultPanel("crystals", "最近 Crystal", "长期复用的讨论结晶", health.recent_files.crystals, health.noos_home)}
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
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(key)}</span>
      <code>${escapeHtml(formatDisplayPath(file.path, noosHome))}</code>
      ${file.source_url ? `<small>${escapeHtml(file.source_url)}</small>` : ""}
      <div class="recent-actions">
        <button type="button" data-vault-group="${escapeHtml(groupId)}" data-vault-index="${index}" data-vault-file-action="open-vault-file">打开文件</button>
        <button type="button" data-vault-group="${escapeHtml(groupId)}" data-vault-index="${index}" data-vault-file-action="project-runtime">生成 Agent Projection</button>
      </div>
    </article>
  `;
}
