import type {
  ConsoleEvent,
  FixtureChildState,
  FixtureOperationState,
  FixtureTone,
  HarnessConsoleSnapshot
} from "../harness/types";
import { harnessScenarioIds, harnessScenarioLabels } from "../harness/fixtures";
import { escapeHtml } from "../ui/html";

/**
 * Harness Dogfood Console v0 — read-only diagnostic projection renderer.
 *
 * The page separates canonical truth (reducer binding), runtime observation
 * (lease / authority / carrier observation), and the current submission's
 * lifecycle facts instead of collapsing them into one health state. Any
 * "attention" signal shown here is derived on the spot from underlying
 * facts (e.g. stale observation age), never a persisted domain enum.
 */

export function formatAge(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 10) {
    return `${seconds.toFixed(1)}s`;
  }
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${minutes}m ${String(rest).padStart(2, "0")}s`;
}

/**
 * Neutral projection-build freshness text. The runtime defines no push/
 * heartbeat cadence or TTL contract yet, so the UI must not invent
 * aging/stale thresholds — it only states how long ago the projection was
 * assembled, and says nothing about harness health or per-fact freshness
 * (per-source ages are rendered where the facts live).
 */
export function projectionBuiltText(projectionBuiltAt: number, now = Date.now()): string {
  const age = Math.max(0, now - projectionBuiltAt);
  return `projection · built ${formatAge(age)} ago`;
}

/**
 * Live age cell: rendered once, then advanced every tick by the ticker in
 * main.ts (which owns [data-hc-age] elements). Diagnostic ages must track
 * real elapsed time while the page stays open.
 */
function ageSpan(epochMs: number): string {
  const age = formatAge(Math.max(0, Date.now() - epochMs));
  return `<span data-hc-age="${epochMs}">${escapeHtml(age)}</span>`;
}

function formatClock(timestamp: number): string {
  return new Date(timestamp).toTimeString().slice(0, 8);
}

function pillClass(tone: FixtureTone): string {
  if (tone === "ready") return "pill pill--ready";
  if (tone === "warn") return "pill pill--partial";
  if (tone === "error") return "pill pill--error";
  return "pill";
}

function pill(value: string, tone: FixtureTone = "neutral"): string {
  return `<span class="${pillClass(tone)}">${escapeHtml(value)}</span>`;
}

function sourceTag(source: ConsoleEvent["source"]): string {
  return `<span class="check-tag hc-event-source">${escapeHtml(source)}</span>`;
}

/** Tone for known contract enum values; presentation only, no invented states. */
const valueTones: Record<string, FixtureTone> = {
  ACTIVE: "ready",
  READY: "ready",
  COMPLETED: "ready",
  PROMOTED: "ready",
  OBSERVED_ACCEPTED: "ready",
  PROVEN_ACCEPTED: "ready",
  PREPARED: "warn",
  ATTACHING: "warn",
  STABILIZING: "warn",
  SPAWNING: "warn",
  BOOTSTRAPPING: "warn",
  RETURNING: "warn",
  RESULT_READY: "warn",
  UNCERTAIN: "warn",
  SPAWN_UNCERTAIN: "warn",
  NEEDS_BOOTSTRAP: "warn",
  DISPATCHING: "warn",
  STILL_AMBIGUOUS: "warn",
  BROKEN: "error",
  SUSPENDED: "error",
  "dispatched": "ready",
  "uncertain": "warn"
};

function toneFor(value: string): FixtureTone {
  return valueTones[value] ?? "neutral";
}

function factRow(label: string, valueHtml: string): string {
  return `<div class="hc-fact"><dt>${escapeHtml(label)}</dt><dd>${valueHtml}</dd></div>`;
}

function refValue(ref: string): string {
  return `<code>${escapeHtml(ref)}</code>`;
}

function childStateTone(state: FixtureChildState): FixtureTone {
  return valueTones[state] ?? "neutral";
}

function operationStateTone(state: FixtureOperationState): FixtureTone {
  return valueTones[state] ?? "neutral";
}

export function renderHarnessConsole(snapshot: HarnessConsoleSnapshot): string {
  return `
    <section class="hc-toolbar">
      <div class="hc-tabs" aria-label="fixture scenario">
        ${harnessScenarioIds
          .map((id) => {
            const active = id === snapshot.scenario;
            return `<button type="button" class="vb-tab ${active ? "vb-tab--active" : ""}" data-hc-scenario="${id}" ${active ? 'aria-pressed="true"' : 'aria-pressed="false"'}>${escapeHtml(harnessScenarioLabels[id])}</button>`;
          })
          .join("")}
      </div>
      <div class="hc-toolbar-right">
        <span class="check-tag check-tag--partial hc-fixture-tag" title="投影应由扩展 background coordinator 构建并经 17642 bridge 推送；Hub 仅渲染。当前为 fixture。">FIXTURE · 未接 bridge</span>
        <span class="hc-freshness" data-hc-freshness title="投影构建时间 — 不代表每条事实同时被观察，也不表达 Harness 健康；runtime 尚未定义 cadence/TTL，故不做阈值判断">${escapeHtml(projectionBuiltText(snapshot.projectionBuiltAt))}</span>
        <button type="button" class="hc-reobserve" data-hc-reobserve title="重新生成 fixture 投影（仅 dev 观察，不是 Harness 动作）">重建投影</button>
      </div>
    </section>

    ${renderWorkItemStrip(snapshot)}

    <div class="hc-layout">
      <div class="hc-primary">
        ${renderPrimaryThread(snapshot)}
        ${renderCurrentOperation(snapshot)}
      </div>
      <div class="hc-secondary">
        ${renderChildThreads(snapshot)}
        ${renderRecentEvents(snapshot)}
      </div>
    </div>

    ${renderGapsPanel()}
  `;
}

function renderWorkItemStrip(snapshot: HarnessConsoleSnapshot): string {
  const workItem = snapshot.workItem;
  return `
    <section class="hc-scope" aria-label="WorkItem scope">
      <div class="hc-scope-main">
        <p class="eyebrow">WorkItem scope</p>
        <h2>${escapeHtml(workItem.title)}</h2>
      </div>
      <div class="hc-scope-facts">
        <span><strong>WorkItem</strong> ${refValue(workItem.workItemId)}</span>
        <span><strong>status</strong> ${pill(workItem.status, toneFor(workItem.status))}</span>
        <span><strong>revision</strong> ${escapeHtml(String(workItem.revision))}</span>
        <span><strong>cold start</strong> ${pill(workItem.coldStart, toneFor(workItem.coldStart))}</span>
        <span><strong>updated</strong> ${ageSpan(workItem.updatedAt)} 前</span>
      </div>
    </section>
  `;
}

function renderPrimaryThread(snapshot: HarnessConsoleSnapshot): string {
  const thread = snapshot.primaryThread;
  const binding = thread.binding;
  const runtime = thread.runtime;
  const lease = runtime.lease;
  const authority = runtime.authority;
  const observation = runtime.carrierObservation;

  return `
    <article class="hc-thread">
      <header class="hc-thread-head">
        <div>
          <p class="eyebrow">Primary Thread</p>
          <h2>${refValue(thread.logicalThreadId)}</h2>
          <p class="hc-thread-role">Role · ${escapeHtml(thread.role)}</p>
        </div>
      </header>

      <section class="hc-zone hc-zone--canonical" aria-label="canonical binding">
        <header>
          <strong>CANONICAL</strong>
          <span>持久事实 — reducer 拥有的 binding</span>
        </header>
        <dl class="hc-facts">
          ${factRow("Active binding", `${pill("ACTIVE", "ready")} ${refValue(binding.carrierRef)}`)}
          ${factRow("Provider conversation", refValue(binding.providerConversationRef))}
          ${factRow("Binding generation", escapeHtml(String(binding.generation)))}
          ${factRow("Committed", `${ageSpan(binding.mutationAt)} 前`)}
        </dl>
      </section>

      <section class="hc-zone hc-zone--runtime" aria-label="runtime observation">
        <header>
          <strong>RUNTIME OBSERVED</strong>
          <span>运行时观察 — 与 canonical 是两层事实，各带自己的时间戳</span>
        </header>
        <dl class="hc-facts">
          ${
            lease
              ? factRow(
                  "Lease / execution owner",
                  `${escapeHtml(lease.claimedBy)} · lease gen ${escapeHtml(String(lease.leaseGeneration))} · carrier ${refValue(lease.carrierRef)} · claimed ${ageSpan(lease.claimedAt)} 前`
                )
              : factRow("Lease / execution owner", "no lease held")
          }
          ${
            authority
              ? factRow(
                  "Claim authority",
                  `gen ${escapeHtml(String(authority.authorityGeneration))} · ${pill(authority.carrierState, toneFor(authority.carrierState))} · logical control ${escapeHtml(authority.logicalControl)} · explicit go ${authority.explicitGo ? "yes" : "no"} · established ${ageSpan(authority.authorityEstablishedAt)} 前`
                )
              : ""
          }
          ${
            observation
              ? factRow(
                  "Carrier observation",
                  `${pill(observation.carrierState, toneFor(observation.carrierState))} observed ${ageSpan(observation.observedAt)} 前${observation.providerFailure ? ` · ${pill("providerFailure", "error")}` : ""}${observation.lastTurnRef ? ` · last turn ${refValue(observation.lastTurnRef)}` : ""} ${sourceTag("carrier-observation")}`
                )
              : ""
          }
        </dl>
      </section>
    </article>
  `;
}

/**
 * Current operation rendered from the real SubmissionOperation lifecycle.
 * Receipt/ack evidence alone caps at UNCERTAIN (settle-evidence contract);
 * only acceptance/reconciliation observation can establish OBSERVED_ACCEPTED
 * or better — the rows below make that progression readable as facts.
 */
function renderCurrentOperation(snapshot: HarnessConsoleSnapshot): string {
  const operation = snapshot.currentOperation;

  if (!operation) {
    const last = snapshot.lastCompletedOperation;
    return `
      <article class="hc-operation hc-operation--idle" aria-label="current operation">
        <header class="hc-operation-head">
          <div>
            <p class="eyebrow">Current Operation</p>
            <h3>当前没有进行中的 submission</h3>
          </div>
        </header>
        ${
          last
            ? `<p class="hc-last-completed">Last completed · ${escapeHtml(last.operationKind)} ${refValue(last.operationId)} · COMPLETED${last.resultingTurnRef ? ` · turn ${escapeHtml(last.resultingTurnRef)}` : ""} · ${ageSpan(last.completedAt)} 前</p>`
            : ""
        }
      </article>
    `;
  }

  return `
    <article class="hc-operation" aria-label="current operation">
      <header class="hc-operation-head">
        <div>
          <p class="eyebrow">Current Operation · Submission</p>
          <h3>${escapeHtml(operation.operationKind)} · ${refValue(operation.operationId)}</h3>
        </div>
        <div class="hc-operation-state">
          ${pill(operation.state, operationStateTone(operation.state))}
        </div>
      </header>

      <p class="hc-lifecycle-note">${escapeHtml(lifecycleCaption(operation.state))}</p>

      <div class="hc-operation-groups">
        <section class="hc-group">
          <header><strong>Submission — 提交事实</strong></header>
          <dl class="hc-facts">
            ${factRow("Target carrier", refValue(operation.targetCarrierRef))}
            ${operation.providerConversationRef ? factRow("Provider conversation", refValue(operation.providerConversationRef)) : ""}
            ${factRow("Payload fingerprint", refValue(operation.payloadFingerprint))}
            ${factRow("Created / observed", `created ${ageSpan(operation.createdAt)} 前 · last observed ${ageSpan(operation.lastObservedAt)} 前`)}
            ${operation.error ? factRow("Error", `<span class="hc-error-text">${escapeHtml(operation.error)}</span>`) : ""}
          </dl>
        </section>

        <section class="hc-group">
          <header><strong>Pre-submit baseline — 派发时前驱观察</strong></header>
          <dl class="hc-facts">
            ${factRow("Conversation turns", `assistant ${escapeHtml(String(operation.preSubmitBaseline.assistantMessageCount))} · user ${escapeHtml(String(operation.preSubmitBaseline.userMessageCount))}`)}
            ${factRow("Head fingerprint", refValue(operation.preSubmitBaseline.headFingerprint))}
            ${factRow("Observed", `${ageSpan(operation.preSubmitBaseline.observedAt)} 前`)}
          </dl>
        </section>

        <section class="hc-group">
          <header><strong>Dispatch — 执行授权与盲发</strong></header>
          <dl class="hc-facts">
            ${
              operation.dispatchClaim
                ? factRow(
                    "Claim",
                    `claimed ${ageSpan(operation.dispatchClaim.claimedAt)} 前 · lease gen ${escapeHtml(String(operation.dispatchClaim.leaseGeneration))} · owner ${refValue(operation.dispatchClaim.leaseOwnerRef)}`
                  )
                : factRow("Claim", `${pill("NOT CLAIMED", "warn")} PREPARED 持久化，尚未取得 dispatch fence`)}
            ${
              operation.dispatchReceipt
                ? factRow(
                    "Receipt",
                    `attempted ${ageSpan(operation.dispatchReceipt.attemptedAt)} 前 · outcome ${pill(operation.dispatchReceipt.outcome, toneFor(operation.dispatchReceipt.outcome))}`
                  )
                : ""
            }
          </dl>
        </section>

        ${
          operation.reconciliation
            ? `<section class="hc-group">
          <header><strong>Reconciliation — 证据裁决</strong></header>
          <dl class="hc-facts">
            ${factRow("Outcome", `${pill(operation.reconciliation.outcome, toneFor(operation.reconciliation.outcome))} observed ${ageSpan(operation.reconciliation.observedAt)} 前`)}
          </dl>
        </section>`
            : ""
        }

        <section class="hc-group">
          <header><strong>Observed effect — 观察到的效果</strong></header>
          <dl class="hc-facts">
            ${
              operation.resultingTurnRef
                ? factRow("Resulting turn", refValue(operation.resultingTurnRef))
                : factRow("Resulting turn", `${pill("NOT OBSERVED", "warn")} 尚未观察到结果 turn`)
            }
          </dl>
        </section>
      </div>
    </article>
  `;
}

function lifecycleCaption(state: FixtureOperationState): string {
  switch (state) {
    case "PREPARED":
      return "PREPARED — 已持久化、拥有执行授权，但尚未 claim dispatch fence。";
    case "DISPATCHING":
      return "DISPATCHING — 已 claim 并盲发；receipt/ack 证据本身最多只能到 UNCERTAIN，等待 acceptance 观察。";
    case "OBSERVED_ACCEPTED":
      return "OBSERVED_ACCEPTED — reconciliation 证据已确认 acceptance，等待完成结算。";
    case "UNCERTAIN":
      return "UNCERTAIN — 现有证据无法证明 acceptance；按 settle cap 停在这里，等待恢复路径。";
    default:
      return "";
  }
}

function renderChildThreads(snapshot: HarnessConsoleSnapshot): string {
  const children = snapshot.childThreads;
  return `
    <article class="hc-children" aria-label="child threads">
      <header class="hc-panel-head">
        <div>
          <p class="eyebrow">Child Threads · ${escapeHtml(String(children.length))}</p>
          <p class="hc-panel-sub">最小摘要 — 使用真实 ChildLifecycleState，不展开详情</p>
        </div>
      </header>
      <ul class="hc-children-list">
        ${children
          .map(
            (child) => `
          <li>
            <div class="hc-child-row">
              <div class="hc-child-main">
                <strong>${refValue(child.childThreadId)}</strong>
                <span>${escapeHtml(child.role)} · ${child.carrierRef ? refValue(child.carrierRef) : "— no carrier"}</span>
              </div>
              ${pill(child.state, childStateTone(child.state))}
            </div>
            <p class="hc-child-fact">${escapeHtml(child.fact)} · updated ${ageSpan(child.updatedAt)} 前</p>
          </li>`
          )
          .join("")}
      </ul>
    </article>
  `;
}

function renderRecentEvents(snapshot: HarnessConsoleSnapshot): string {
  const rows = snapshot.events;
  return `
    <article class="hc-events" aria-label="recent runtime events">
      <header class="hc-panel-head">
        <div>
          <p class="eyebrow">Recent Runtime Events</p>
          <p class="hc-panel-sub">仅收录与 Primary Thread / 当前（或最近）operation 直接相关的证据；child 事件在 Child Threads 看 · 跨来源无全局 seq，按时间排序</p>
        </div>
      </header>
      <div class="hc-event-header" aria-hidden="true">
        <span>time</span><span>source</span><span>event</span><span>subject</span><span>correlation</span>
      </div>
      <ul class="hc-event-list">
        ${rows
          .map(
            (event) => `
          <li class="hc-event-row ${event.severity === "warning" ? "hc-event-row--warning" : ""}" ${event.detail ? `title="${escapeHtml(event.detail)}"` : ""}>
            <span class="hc-time">${escapeHtml(formatClock(event.timestamp))}</span>
            <span class="hc-evt-source">${sourceTag(event.source)}</span>
            <span class="hc-evt">${escapeHtml(event.eventType)}</span>
            <span class="hc-corr">${escapeHtml(event.subjectRef)}</span>
            <span class="hc-corr">${event.correlationRef ? escapeHtml(event.correlationRef) : "—"}</span>
          </li>`
          )
          .join("")}
      </ul>
    </article>
  `;
}

function renderGapsPanel(): string {
  const gaps: Array<[string, string]> = [
    ["投影未接 bridge", "HarnessConsoleSnapshot 应由扩展 background coordinator（持有 work-item / submission ledger / reducer bundle / journal / child ledger）构建，经现有 127.0.0.1:17642 HTTP bridge 推送到 Hub；Hub 仅渲染。尚无对应端点。"],
    ["无全局事件 seq", "ExecutionJournal / reducer audit / 各 ledger 之间没有共享序列；事件合并只能按时间排序，无法用于检测漏事件。"],
    ["lease 无 TTL / heartbeat API", "ActuationLease 只有 claimedAt / claimedBy / generations；“观察过期”只能由投影按观察时间推导。"],
    ["carrier 观察无持久快照 API", "carrierState 全集在 GoalReanchorRuntime（含 SUSPENDED/RECOVERING）；providerFailure 在 SubmissionObservation 上；本页合并两者为投影形态，但没有稳定可读的运行时快照来源（lastTurnRef 无后端字段，最近似概念是 resultingTurnRef）。"],
    ["WorkItem 无 Run / RUNNABLE 概念", "只有 DRAFT | ACTIVE | PROMOTED | ARCHIVED + readiness + coldStart；Run 完全不存在。"],
    ["无全局 State version", "版本分散为 binding.generation / leaseGeneration / authorityGeneration / operationRevision / WorkItem.revision / anchorRevision，各层需分别显示。"],
    ["policy 授权无独立枚举", "真实授权事实 = durable PREPARED + SubmissionAuthority（generation / establishedAt / explicitGo）；没有独立的 AUTHORIZED 状态。"],
    ["eligibility 只能推导", "可执行性 = state=PREPARED ∧ dispatchClaim 状态的组合，无显式 blocked/waiting 枚举 — 页面按事实展示，不新增领域状态。"],
    ["child thread 无活跃 submission 摘要", "需要从 submission ledger 按 logicalThreadId 拼装，没有直接投影。"]
  ];

  return `
    <details class="hc-gaps db-about">
      <summary>Observability gaps — 本页 fixture 与真实 contract 的差距（本轮不解决，仅暴露）</summary>
      <dl class="hc-gaps-list">
        ${gaps
          .map(([title, detail]) => `<div><dt>${escapeHtml(title)}</dt><dd>${escapeHtml(detail)}</dd></div>`)
          .join("")}
      </dl>
    </details>
  `;
}
