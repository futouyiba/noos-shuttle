import type { HubHealth } from "../types";
import { escapeHtml as e } from "../ui/html";

/**
 * Work pages v0 — temporary UI presentation fixtures.
 *
 * Everything below is an illustrative presentation projection: names, counts,
 * timestamps and review examples are fixture copy from the reviewed Figma
 * frames, not canonical WorkItem state and not derived from Harness events,
 * leases or submission journals. No control on these pages triggers a backend
 * mutation; "Start adjudication" is UX intent only.
 */

const fixtureNote = `<p class="presentation-note">UI fixture · Illustrative examples, not live work or canonical state · Read-only</p>`;

const unavailable = `disabled title="Illustrative fixture; nothing is connected in v0"`;

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

export function renderWorkOverview(health: HubHealth): string {
  const vaultCount = health.vault_stats.handoffs_active + health.vault_stats.crystals_active;
  const worst = worstAdapterStatus(health);
  const systemOk = worst === "ready";
  const systemLabel = systemOk ? "Operational" : worst === "partial" ? "Partial" : "Needs attention";

  return `
  <div class="work-page">${fixtureNote}
    <section class="work-section" aria-label="Needs your attention">
      <header><h2>Needs your attention</h2><span class="work-count">2</span></header>
      <article class="work-attention">
        <div class="work-attention-body">
          <header><strong>FCF · DSL R3</strong><span class="work-tag">Adjudicate</span></header>
          <p class="attention-copy">Review returned · 2 blocking issues</p>
          <p class="attention-sub">Needs your adjudication</p>
          <small>Reviewer · 8m ago</small>
        </div>
        <a class="text-link" href="#work-detail">Review →</a>
      </article>
      <article class="work-attention">
        <div class="work-attention-body">
          <header><strong>NOOS Harness Dogfood</strong><span class="work-tag">Inspect</span></header>
          <p class="attention-copy">Operation remains UNCERTAIN</p>
          <p class="attention-sub">Reconciliation is still ambiguous</p>
          <small>3m ago</small>
        </div>
        <a class="text-link" href="#harness">Runtime →</a>
      </article>
    </section>

    <section class="work-section" aria-label="In progress">
      <header><h2>In progress</h2><span class="work-count">3</span></header>
      ${compactRow("FCF 0.3.4-b", "Designer · revising configuration model", "12m ago", "#work-detail")}
      ${compactRow("Resume Renderer", "Codex · updating summary", "27m ago", "#work-detail")}
      ${compactRow("NOOS Hub", "Harness · runtime inspection idle", "41m ago", "#harness")}
    </section>

    <section class="work-section" aria-label="Recently changed">
      <header><h2>Recently changed</h2></header>
      ${compactRow("Blind Holdout R1", "Governance · promoted", "Today 14:32", "#work-detail")}
      ${compactRow("Terminology cleanup", "Design · completed", "Today 11:08", "#work-detail")}
    </section>

    <section class="work-supporting" aria-label="Supporting planes">
      <a href="#vault">
        <span>Vault</span>
        <strong>${vaultCount} recent artifact${vaultCount === 1 ? "" : "s"}</strong>
      </a>
      <a href="#system">
        <span>System</span>
        <strong class="sys-status"><i class="sys-dot${systemOk ? "" : " sys-dot--warn"}" aria-hidden="true"></i>${systemLabel}</strong>
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
  return `
  <div class="work-detail">${fixtureNote}
    <div class="work-detail-grid">
      <div class="work-detail-primary">
        <section class="decision-panel" aria-label="Needs your decision">
          <header>
            <h2>Needs your decision</h2>
            <span class="work-tag">2 blocking</span>
          </header>
          <strong>Reviewer found two contract-level issues that block promotion.</strong>
          <p>Resolve the findings below, then return the candidate to the design/review loop.</p>
          <div class="work-actions">
            <button type="button" class="text-link" disabled aria-describedby="adjudication-note">Start adjudication →</button>
            <button type="button" class="text-link text-link--muted" ${unavailable}>Open review result</button>
          </div>
          <small id="adjudication-note">Future UX intent only · v0 performs no backend mutation.</small>
        </section>

        <section class="detail-block" aria-label="Current state">
          <h2>Current state</h2>
          <dl>
            ${kv("Status", "Review returned")}
            ${kv("Needs action from", "You")}
            ${kv("Last meaningful change", "Reviewer completed review · 8m ago")}
          </dl>
        </section>

        <section class="detail-block" aria-label="Review findings">
          <header><h2>Review findings</h2><span class="blocking-count">2 blocking</span></header>
          <article class="finding">
            <h3>01 · DecisionBasis identity can drift across recovery</h3>
            <p>Equivalent runtime snapshots must resolve to one stable semantic basis.</p>
          </article>
          <article class="finding">
            <h3>02 · First-apply eligibility is not durable enough</h3>
            <p>Authorized delta needs deterministic eligibility after crash/retry.</p>
          </article>
        </section>

        <section class="detail-block" aria-label="Recent progress">
          <h2>Recent progress</h2>
          ${progressRow("8m", "Reviewer completed review", "2 blocking issues returned")}
          ${progressRow("27m", "Designer submitted Candidate v3", "semantic identity tightened")}
          ${progressRow("43m", "Integration requested narrow revision", "scope held to XCONTRACT-03")}
        </section>
      </div>

      <aside class="work-detail-secondary">
        <section class="detail-block" aria-label="Artifacts">
          <h2>Artifacts</h2>
          ${artifact("Design Candidate v3", "exact revision · ready for adjudication")}
          ${artifact("Review Result #9", "Reviewer · completed 8m ago")}
        </section>

        <section class="detail-block" aria-label="Who is involved">
          <h2>Who is involved</h2>
          <dl class="compact-dl">
            ${kv("Now", "You · adjudication")}
            ${kv("From", "Reviewer")}
            ${kv("Next", "Designer · narrow revision")}
          </dl>
        </section>

        <section class="next-panel" aria-label="What happens next">
          <h2>What happens next</h2>
          <p>Accepted findings return to Designer for a narrow revision. Rejected findings remain recorded with rationale.</p>
        </section>

        <section class="detail-block work-advanced" aria-label="Advanced">
          <h2>Advanced</h2>
          <a class="text-link" href="#harness">Inspect runtime →</a>
          <p>Opens the existing Harness Inspector, an independent diagnostic fixture. It is not linked to this example work item.</p>
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
      <button type="button" class="text-link text-link--muted" ${unavailable}>Open →</button>
    </article>`;
}
