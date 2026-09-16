import { statusLabels } from "../status";
import type { AdapterHealth, HubHealth } from "../types";
import { escapeHtml as e, formatDisplayPath } from "../ui/html";
import { renderAdapters } from "./adapters";
import { renderConfig, type ConfigData } from "./config";

/**
 * System — supporting infrastructure plane.
 *
 * Quiet when healthy: a one-line summary, connection/configuration rows, a
 * contextual Doctor entry and Advanced runtime details. The full connector
 * manager and configuration editor stay available inside collapsed details so
 * normal work is never interrupted by infrastructure chrome.
 */
export function renderSystem(health: HubHealth, config: ConfigData | null): string {
  const adapters = health.adapters;
  const broken = adapters.filter((adapter) => adapter.status === "error").length;
  const incomplete = adapters.filter(
    (adapter) => adapter.status === "missing" || adapter.status === "needs_action" || adapter.status === "partial"
  ).length;
  const healthy = broken === 0 && incomplete === 0;

  const summaryTitle = healthy
    ? "Everything needed for normal work is available."
    : `${broken + incomplete} 个连接需要处理`;
  const summaryPill = healthy
    ? `<span class="pill pill--ready">Operational</span>`
    : `<span class="pill pill--${broken > 0 ? "error" : "partial"}">${broken > 0 ? "Needs attention" : "Partial"}</span>`;

  return `
  <div class="system-page">
    <section class="system-summary" aria-label="System summary">
      <div>
        <strong>${e(summaryTitle)}</strong>
        <p>System details stay out of the way unless they affect work.</p>
      </div>
      ${summaryPill}
    </section>

    <section class="system-section" aria-label="Connections">
      <h2>Connections</h2>
      ${adapters.map(adapterRow).join("")}
      <details class="system-manage">
        <summary>管理连接器</summary>
        <div class="system-manage-body">${renderAdapters(health)}</div>
      </details>
    </section>

    <section class="system-section" aria-label="Configuration">
      <h2>Configuration</h2>
      ${sysRow("NOOS Home", "Local root", pathPill(formatDisplayPath(health.noos_home, health.noos_home)))}
      ${sysRow("Vault", "Artifact storage", pathPill(formatDisplayPath(`${health.noos_home}/vault`, health.noos_home)))}
      ${sysRow("Runtime", "Runtime state", pathPill(formatDisplayPath(`${health.noos_home}/runtime`, health.noos_home)))}
      <details class="system-manage">
        <summary>管理配置与更新</summary>
        <div class="system-manage-body">${renderConfig(health, config)}</div>
      </details>
    </section>

    <section class="system-section" aria-label="Diagnostics">
      <h2>Diagnostics</h2>
      ${sysRow(
        "Doctor",
        "Check installation, bridges and connections when something looks wrong.",
        `<button type="button" class="text-link" data-run="doctor">Run Doctor →</button>`
      )}
    </section>

    <section class="system-section" aria-label="Advanced">
      <h2>Advanced</h2>
      ${sysRow("Sleep recovery", "休眠与唤醒恢复状态", `<span class="recovery-pill" data-recovery-state="running">检查中…</span>`)}
      ${sysRow("Local endpoint", e(health.local_write.endpoint.replace(/^https?:\/\//, "")), `<span class="sys-arrow" aria-hidden="true">›</span>`)}
      ${sysRow("Runtime diagnostics", "Low-level state and logs", `<a class="text-link" href="#harness">Open →</a>`)}
    </section>
  </div>`;
}

function adapterRow(adapter: AdapterHealth): string {
  return `
    <div class="sys-row">
      <div class="sys-row-body">
        <strong>${e(adapter.name)}</strong>
        <span>${e(adapter.summary)}</span>
      </div>
      <span class="pill pill--${adapter.status}">${e(statusLabels[adapter.status])}</span>
    </div>`;
}

function sysRow(name: string, subHtml: string, rightHtml: string): string {
  return `
    <div class="sys-row">
      <div class="sys-row-body">
        <strong>${e(name)}</strong>
        <span>${subHtml}</span>
      </div>
      ${rightHtml}
    </div>`;
}

function pathPill(path: string): string {
  return `<span class="sys-pill">${e(path)}</span>`;
}
