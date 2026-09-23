import { statusLabels } from "../status";
import type { AdapterHealth, HubHealth } from "../types";
import { copy as c } from "../ui/copy";
import { escapeHtml as e, formatDisplayPath } from "../ui/html";
import { renderAdapters } from "./adapters";
import { renderConfig, type ConfigData } from "./config";

/**
 * System — supporting infrastructure plane.
 *
 * Quiet when healthy: a one-line summary, connection/configuration rows, a
 * contextual Doctor entry and Advanced runtime details. Refreshing health
 * state lives here too, not in the global topbar. The full connector manager
 * and configuration editor stay available inside collapsed details so normal
 * work is never interrupted by infrastructure chrome.
 */
export function renderSystem(health: HubHealth, config: ConfigData | null): string {
  const adapters = health.adapters;
  const broken = adapters.filter((adapter) => adapter.status === "error").length;
  const incomplete = adapters.filter(
    (adapter) => adapter.status === "missing" || adapter.status === "needs_action" || adapter.status === "partial"
  ).length;
  const healthy = broken === 0 && incomplete === 0;

  const summaryTitle = healthy
    ? c.system.summaryHealthy
    : c.system.summaryUnhealthy.replace("{n}", String(broken + incomplete));
  const summaryPill = healthy
    ? `<span class="pill pill--ready">${e(c.system.operational)}</span>`
    : `<span class="pill pill--${broken > 0 ? "error" : "partial"}">${e(broken > 0 ? c.system.needsAttention : c.system.partial)}</span>`;

  return `
  <div class="system-page">
    <section class="system-summary" aria-label="System summary">
      <div>
        <strong>${e(summaryTitle)}</strong>
        <p>${e(c.system.summarySub)}</p>
      </div>
      ${summaryPill}
    </section>

    <section class="system-section" aria-label="${e(c.system.connections)}">
      <h2>${e(c.system.connections)}</h2>
      ${adapters.map(adapterRow).join("")}
      <details class="system-manage">
        <summary>${e(c.system.manageAdapters)}</summary>
        <div class="system-manage-body">${renderAdapters(health)}</div>
      </details>
    </section>

    <section class="system-section" aria-label="${e(c.system.configuration)}">
      <h2>${e(c.system.configuration)}</h2>
      ${sysRow(c.system.noosHome[0], c.system.noosHome[1], pathPill(formatDisplayPath(health.noos_home, health.noos_home)))}
      ${sysRow(c.system.vaultStore[0], c.system.vaultStore[1], pathPill(formatDisplayPath(`${health.noos_home}/vault`, health.noos_home)))}
      ${sysRow(c.system.runtimeState[0], c.system.runtimeState[1], pathPill(formatDisplayPath(`${health.noos_home}/runtime`, health.noos_home)))}
      <details class="system-manage">
        <summary>${e(c.system.manageConfig)}</summary>
        <div class="system-manage-body">${renderConfig(health, config)}</div>
      </details>
    </section>

    <section class="system-section" aria-label="Browser pairing">
      <h2>Browser pairing</h2>
      <div id="pairing-panel" data-pairing-state="loading"><span class="sys-pill">…</span></div>
    </section>

    <section class="system-section" aria-label="${e(c.system.diagnostics)}">
      <h2>${e(c.system.diagnostics)}</h2>
      ${sysRow(
        c.system.doctor[0],
        c.system.doctor[1],
        `<button type="button" class="text-link" data-run="doctor">${e(c.system.runDoctor)}</button>`
      )}
      ${sysRow(
        c.system.refresh[0],
        c.system.refresh[1],
        `<button type="button" class="text-link" data-action="refresh">${e(c.system.refreshLink)}</button>`
      )}
    </section>

    <section class="system-section" aria-label="${e(c.system.advanced)}">
      <h2>${e(c.system.advanced)}</h2>
      ${sysRow(c.system.sleepRecovery[0], c.system.sleepRecovery[1], `<span class="recovery-pill" data-recovery-state="running">检查中…</span>`)}
      ${sysRow(c.system.localEndpoint[0], health.local_write.endpoint.replace(/^https?:\/\//, ""), `<span class="sys-arrow" aria-hidden="true">›</span>`)}
      ${sysRow(c.system.runtimeDiagnostics[0], c.system.runtimeDiagnostics[1], `<a class="text-link" href="#harness">${e(c.system.open)}</a>`)}
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

function sysRow(name: string, subText: string, rightHtml: string): string {
  return `
    <div class="sys-row">
      <div class="sys-row-body">
        <strong>${e(name)}</strong>
        <span>${e(subText)}</span>
      </div>
      ${rightHtml}
    </div>`;
}

function pathPill(path: string): string {
  return `<span class="sys-pill">${e(path)}</span>`;
}
