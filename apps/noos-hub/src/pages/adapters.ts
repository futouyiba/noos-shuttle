import { kindLabels, kindOrder, statusLabels } from "../status";
import type { AdapterCheck, AdapterHealth, AdapterKind, HubHealth } from "../types";
import { escapeHtml } from "../ui/html";

export function renderAdapters(health: HubHealth): string {
  const all = kindOrder.flatMap((kind) =>
    health.adapters.filter((adapter) => adapter.kind === kind)
  );

  if (!all.length) {
    return `
      <section class="section-head">
        <div>
          <p class="eyebrow">连接器</p>
          <h2>安装状态</h2>
        </div>
      </section>
      <div class="empty-state">还没有检测到任何连接器。运行 Doctor 开始配置。</div>
    `;
  }

  const ready = all.filter((adapter) => adapter.status === "ready").length;
  const needsAction = all.filter(
    (adapter) => adapter.status === "missing" || adapter.status === "needs_action"
  ).length;
  const hasError = all.some((adapter) => adapter.status === "error");

  return `
    <section class="section-head">
      <div>
        <p class="eyebrow">连接器</p>
        <h2>${hasError ? "有连接器异常" : needsAction > 0 ? `${needsAction} 个连接器需要处理` : `${ready} 个连接器就绪`}</h2>
      </div>
      <button type="button" data-run="doctor">运行 Doctor</button>
    </section>
    ${kindOrder.map((kind) => renderKindSection(health.adapters, kind)).join("")}
  `;
}

function renderKindSection(adapters: AdapterHealth[], kind: AdapterKind): string {
  const group = adapters.filter((adapter) => adapter.kind === kind);
  if (!group.length) return "";

  const statusSummary = group
    .map((adapter) => statusLabels[adapter.status])
    .join(" · ");

  return `
    <section class="adapter-section">
      <div class="adapter-section-head">
        <h3>${kindLabels[kind]}</h3>
        <span>${statusSummary}</span>
      </div>
      <div class="adapter-stack">
        ${group.map(renderAdapterRow).join("")}
      </div>
    </section>
  `;
}

function renderAdapterRow(adapter: AdapterHealth): string {
  const firstAction = adapter.actions[0];
  const tags = adapter.checks.map(renderCheckTag).join("");

  return `
    <article class="adapter-row adapter-row--${adapter.status}">
      <div class="adapter-row-body">
        <span class="pill pill--${adapter.status}">${statusLabels[adapter.status]}</span>
        <div class="adapter-row-main">
          <div class="adapter-row-head">
            <strong>${escapeHtml(adapter.name)}</strong>
            ${tags ? `<span class="adapter-row-tags">${tags}</span>` : ""}
          </div>
          <p>${escapeHtml(adapter.summary)}</p>
        </div>
      </div>
      ${firstAction ? `<button type="button" data-run="${escapeHtml(firstAction.id)}" class="adapter-row-btn">${escapeHtml(firstAction.label)}</button>` : ""}
    </article>
  `;
}

function renderCheckTag(check: AdapterCheck): string {
  return `
    <span class="check-tag check-tag--${check.status}" title="${escapeHtml(check.detail || check.label)}">
      ${escapeHtml(check.label)}
    </span>
  `;
}
