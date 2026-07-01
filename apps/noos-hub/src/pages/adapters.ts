import { kindLabels, kindOrder, statusLabels } from "../status";
import type { AdapterCheck, AdapterHealth, HubHealth } from "../types";
import { escapeHtml, formatDisplayPath } from "../ui/html";

export function renderAdapters(health: HubHealth): string {
  return `
    <section class="section-head">
      <div>
        <p class="eyebrow">连接器</p>
        <h2>安装状态</h2>
      </div>
      <span>${escapeHtml(formatDisplayPath(health.repo_root, health.noos_home))}</span>
    </section>
    ${kindOrder
      .map((kind) => {
        const adapters = health.adapters.filter((adapter) => adapter.kind === kind);
        if (!adapters.length) return "";
        return `
          <section class="adapter-group">
            <h3>${kindLabels[kind]}</h3>
            <div class="card-grid">${adapters.map(renderAdapter).join("")}</div>
          </section>
        `;
      })
      .join("")}
  `;
}

function renderAdapter(adapter: AdapterHealth): string {
  return `
    <article class="card card--${adapter.status}">
      <header>
        <div>
          <p>${kindLabels[adapter.kind]}</p>
          <h2>${escapeHtml(adapter.name)}</h2>
        </div>
        <span class="pill pill--${adapter.status}">${statusLabels[adapter.status]}</span>
      </header>
      <p class="summary">${escapeHtml(adapter.summary)}</p>
      <ul>
        ${adapter.checks.map(renderCheck).join("")}
      </ul>
      <div class="card-actions">
        ${adapter.actions
          .map((action) => {
            const label = action.requires_user_action ? `${action.label} · 需确认` : action.label;
            return `<button type="button" data-run="${escapeHtml(action.id)}">${escapeHtml(label)}</button>`;
          })
          .join("")}
      </div>
    </article>
  `;
}

function renderCheck(check: AdapterCheck): string {
  return `
    <li>
      <span class="dot dot--${check.status}"></span>
      <div>
        <strong>${escapeHtml(check.label)}</strong>
        ${check.detail ? `<small>${escapeHtml(check.detail)}</small>` : ""}
      </div>
    </li>
  `;
}
