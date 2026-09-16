import type { HubHealth } from "../types";
import { copy as c } from "../ui/copy";
import { escapeHtml as e } from "../ui/html";

/**
 * Work pages v0 — temporary UI presentation fixtures.
 *
 * Everything below is an illustrative presentation projection: names, counts,
 * timestamps and review examples are fixture copy from the reviewed Figma
 * frames (localized via ui/copy.ts), not canonical WorkItem state and not
 * derived from Harness events, leases or submission journals. No control on
 * these pages triggers a backend mutation; "Start adjudication" is UX intent
 * only.
 *
 * Exception (issue #44): the 对话待办 section on the Work overview is live
 * data — active Vault handoffs — and its 查看对话 button enqueues a carrier
 * focus request (observation-only, no lease). It is the sole live block on
 * these pages.
 */

const unavailable = `disabled title="${e(c.work.detail.fixtureTooltip)}"`;

const statusOrder = ["ready", "partial", "needs_action", "missing", "error"] as const;

function worstAdapterStatus(health: HubHealth): string {
  return health.adapters.reduce<string>(
    (worst, adapter) =>
      statusOrder.indexOf(adapter.status as (typeof statusOrder)[number]) > statusOrder.indexOf(worst as (typeof statusOrder)[number])
        ? adapter.status
        : worst,
    "ready"
  );
}

/**
 * Renders the live conversation to-do rows from the Vault's active
 * handoffs. Unlike the fixture sections below, this block reads real
 * health data: objects with a provider source_url get a 查看对话 action
 * (enqueues a carrier focus request the browser extension polls); objects
 * without one (CC/Codex and other non-browser sources) only surface the
 * source session and a wake hint — V1 deliberately has no deep link for
 * them.
 */
function conversationTodoRows(health: HubHealth): string {
  const handoffs = health.recent_files.handoffs;
  if (handoffs.length === 0) {
    return `<p class="attention-sub">${e(c.work.conversations.empty)}</p>`;
  }

  return handoffs
    .map((item) => {
      const label = item.title || item.name;
      const tag = item.key || "handoff";
      if (item.source_url) {
        return `
      <article class="work-attention">
        <div class="work-attention-body">
          <header><strong>${e(label)}</strong><span class="work-tag">${e(tag)}</span></header>
          <p class="attention-sub">${e(item.source_app || "browser-shuttle")}</p>
        </div>
        <button type="button" class="text-link" data-focus-source="${e(item.source_url)}" data-focus-key="${e(item.key || item.name)}">${e(c.work.conversations.focusAction)}</button>
      </article>`;
      }
      return `
      <article class="work-attention">
        <div class="work-attention-body">
          <header><strong>${e(label)}</strong><span class="work-tag">${e(tag)}</span></header>
          <p class="attention-sub">${e(c.work.conversations.wakeHint.replace("{app}", item.source_app || "unknown"))}</p>
        </div>
      </article>`;
    })
    .join("");
}

export function renderWorkOverview(health: HubHealth): string {
  const vaultCount = health.vault_stats.handoffs_active + health.vault_stats.crystals_active;
  const worst = worstAdapterStatus(health);
  const systemLabel =
    worst === "ready"
      ? c.work.supporting.operational
      : worst === "partial"
        ? c.work.supporting.partial
        : c.work.supporting.needsAttention;

  return `
  <div class="work-page"><p class="presentation-note">${e(c.work.fixtureNote)}</p>
    <section class="work-section" aria-label="${e(c.work.conversations.title)}">
      <header><h2>${e(c.work.conversations.title)}</h2><small>${e(c.work.conversations.liveNote)}</small></header>
      ${conversationTodoRows(health)}
    </section>

    <section class="work-section" aria-label="${e(c.work.needsAttention)}">
      <header><h2>${e(c.work.needsAttention)}</h2><span class="work-count">2</span></header>
      ${c.work.attention
        .map(
          (row) => `
      <article class="work-attention">
        <div class="work-attention-body">
          <header><strong>${e(row.title)}</strong><span class="work-tag">${e(row.tag)}</span></header>
          <p class="attention-copy">${e(row.copy)}</p>
          <p class="attention-sub">${e(row.sub)}</p>
          <small>${e(row.meta)}</small>
        </div>
        <a class="text-link" href="${e(row.href)}">${e(c.work[row.link as "reviewLink" | "runtimeLink"])}</a>
      </article>`
        )
        .join("")}
    </section>

    <section class="work-section" aria-label="${e(c.work.inProgress)}">
      <header><h2>${e(c.work.inProgress)}</h2><span class="work-count">3</span></header>
      ${c.work.progress.map((row) => compactRow(row.title, row.sub, row.time, row.href)).join("")}
    </section>

    <section class="work-section" aria-label="${e(c.work.recentlyChanged)}">
      <header><h2>${e(c.work.recentlyChanged)}</h2></header>
      ${c.work.changed.map((row) => compactRow(row.title, row.sub, row.time, row.href)).join("")}
    </section>

    <section class="work-supporting" aria-label="Supporting planes">
      <a href="#vault">
        <span>${e(c.work.supporting.vault)}</span>
        <strong>${vaultCount} ${e(c.work.supporting.artifacts)}</strong>
      </a>
      <a href="#system">
        <span>${e(c.work.supporting.system)}</span>
        <strong class="sys-status"><i class="sys-dot${worst === "ready" ? "" : " sys-dot--warn"}" aria-hidden="true"></i>${e(systemLabel)}</strong>
      </a>
    </section>
  </div>`;
}

function compactRow(title: string, summary: string, time: string, href: string): string {
  return `
    <a class="work-compact" href="${e(href)}">
      <span class="work-compact-body">
        <strong>${e(title)}</strong>
        <span>${e(summary)}</span>
      </span>
      <small>${e(time)} →</small>
    </a>`;
}

export function renderWorkDetail(): string {
  const d = c.work.detail;

  return `
  <div class="work-detail"><p class="presentation-note">${e(c.work.fixtureNote)}</p>
    <div class="work-detail-grid">
      <div class="work-detail-primary">
        <section class="decision-panel" aria-label="${e(d.decisionTitle)}">
          <header>
            <h2>${e(d.decisionTitle)}</h2>
            <span class="work-tag">${e(d.decisionCount)}</span>
          </header>
          <strong>${e(d.decisionBody)}</strong>
          <p>${e(d.decisionNote)}</p>
          <div class="work-actions">
            <button type="button" class="text-link" disabled aria-describedby="adjudication-note">${e(d.startAdjudication)}</button>
            <button type="button" class="text-link text-link--muted" ${unavailable}>${e(d.openReviewResult)}</button>
          </div>
          <small id="adjudication-note">${e(d.adjudicationNote)}</small>
        </section>

        <section class="detail-block" aria-label="${e(d.currentState)}">
          <h2>${e(d.currentState)}</h2>
          <dl>
            ${kv(d.status, d.statusValue)}
            ${kv(d.needsActionFrom, d.you)}
            ${kv(d.lastChange, d.lastChangeValue)}
          </dl>
        </section>

        <section class="detail-block" aria-label="${e(d.findingsTitle)}">
          <header><h2>${e(d.findingsTitle)}</h2><span class="blocking-count">${e(d.decisionCount)}</span></header>
          ${d.findings
            .map(
              (finding) => `
          <article class="finding">
            <h3>${e(finding.title)}</h3>
            <p>${e(finding.text)}</p>
          </article>`
            )
            .join("")}
        </section>

        <section class="detail-block" aria-label="${e(d.progressTitle)}">
          <h2>${e(d.progressTitle)}</h2>
          ${d.progress.map((row) => progressRow(row.time, row.title, row.note)).join("")}
        </section>
      </div>

      <aside class="work-detail-secondary">
        <section class="detail-block" aria-label="${e(d.artifactsTitle)}">
          <h2>${e(d.artifactsTitle)}</h2>
          ${d.artifacts.map((row) => artifact(row.title, row.note)).join("")}
        </section>

        <section class="detail-block" aria-label="${e(d.involvedTitle)}">
          <h2>${e(d.involvedTitle)}</h2>
          <dl class="compact-dl">
            ${d.involved.map((row) => kv(row.label, row.value)).join("")}
          </dl>
        </section>

        <section class="next-panel" aria-label="${e(d.nextTitle)}">
          <h2>${e(d.nextTitle)}</h2>
          <p>${e(d.nextBody)}</p>
        </section>

        <section class="detail-block work-advanced" aria-label="${e(d.advanced)}">
          <h2>${e(d.advanced)}</h2>
          <a class="text-link" href="#harness">${e(d.inspectRuntime)}</a>
          <p>${e(d.advancedNote)}</p>
        </section>
      </aside>
    </div>
  </div>`;
}

function kv(label: string, value: string): string {
  return `<div><dt>${e(label)}</dt><dd>${e(value)}</dd></div>`;
}

function progressRow(time: string, title: string, note: string): string {
  return `
    <article class="work-progress">
      <small>${e(time)}</small>
      <div>
        <h3>${e(title)}</h3>
        <p>${e(note)}</p>
      </div>
    </article>`;
}

function artifact(title: string, note: string): string {
  return `
    <article class="work-artifact">
      <div>
        <h3>${e(title)}</h3>
        <p>${e(note)}</p>
      </div>
      <button type="button" class="text-link text-link--muted" ${unavailable}>${e(c.work.detail.open)}</button>
    </article>`;
}
