#!/usr/bin/env node
/**
 * noos-watch 的状态机与解析层（纯函数，无 I/O、无网络、不写任何状态）。
 *
 * 存在的理由：`CLAIMED` 原本是唯一一个「已认领、未投递」的活状态，于是
 * 「我判定不投递」与「我投递失败/被中断」在状态文件里长得一模一样，而
 * `CLAIMED` 按 skill 步骤 3 每轮都要报成「未完成投递」交人判断 —— 人工
 * 分诊成本随轮次无上限复现。本模块补一个可从 `CLAIMED` 到达的终态
 * `DISMISSED`，并把「到达终态」的判据写成可执行谓词，使两者可区分。
 *
 * 三条不变量（改动前请先读懂）：
 *
 * 1. **终态不投递、不复报**：`ROUTED` 与 `DISMISSED` 都不进简报的
 *    「未完成投递」项。`DISMISSED` 只出现在审计计数里。
 * 2. **未知 ≠ 已判定不路由**：「不认识但携带权威信号」的评论必须继续
 *    进 pending 并逐条上报。本模块的 D1–D5 判据全部是**闭集匹配**，
 *    命中不了就落回未分类，绝不因为「看起来不像要路由的」而消失。
 * 3. **只读**：本模块不读不写 `.tmp/watcher-state.json`。状态写回由
 *    skill 在持锁状态下做；迁移由 `scripts/noos-watch-migrate-dismissed.mjs`
 *    做（默认 dry-run）。
 *
 * 本模块不构成任何授权：它只区分「结论」与「未完成」，不产生结论。
 */

/** claims 的合法状态。`DISMISSED` 是本版新增的终态。 */
export const CLAIM_STATES = ["CLAIMED", "ROUTED", "UNROUTED", "DISMISSED"];

/** 终态：不会再被投递、不会再进「未完成投递」。 */
export const TERMINAL_CLAIM_STATES = ["ROUTED", "DISMISSED"];

/**
 * 终态判据清单。每条都要在 skill 正文里有对应文字（判据与实现不得漂移）。
 * 规则 id 写进 `claims[<id>].dismissRule`，便于审计「这条为什么被判掉」。
 */
export const DISMISSAL_RULES = {
  D1: "delegation-record",
  D2: "known-marker-without-wakeup",
  D3: "superseded-by-later-marker",
  D4: "no-recipient-recorded",
  D5: "moot-already-integrated",
};

/**
 * 规范附录 B 的输出标记（B.3）。**闭集**：不在此集合内的首行标记
 * 一律走「未分类上报」，不得被 D2 判掉。
 */
export const SPEC_OUTPUT_MARKERS = ["REVIEW:", "DESIGN:", "IMPLEMENTED:", "INTEGRATED:"];

/**
 * 规范枚举内的 verdict。取值必须**逐字相等**才算命中——`APPROVE WITH
 * FINDINGS` 不是 `APPROVE`，它不在枚举内，属规范侧词汇缺口，必须继续
 * 进 pending 等人工分类（本任务不许把它自动判掉）。
 */
export const SPEC_VERDICTS = {
  "REVIEW:": ["APPROVE", "REQUEST_CHANGES"],
  "DESIGN:": ["APPROVE", "REQUEST_CHANGES", "REJECTED"],
};

/** 路由表中已定义唤醒动作的标记（skill 步骤 3）。 */
export const ROUTABLE_MARKERS = {
  "REVIEW:": ["APPROVE", "REQUEST_CHANGES"],
  "DESIGN:": ["APPROVE", "REQUEST_CHANGES", "REJECTED"],
  "INTEGRATED:": null, // 取值是「摘要 @ merge-sha」，无枚举约束
};

/**
 * 已知、但本 skill **未定义唤醒动作**的标记。D2 只在这个闭集上开火：
 * 一个正牌 B.3 标记不该被自己的上报规则捞起来。
 *
 * `IMPLEMENTED: PR#M` 是实现在任务 issue 上的完成记录；唤醒 integrator
 * 的证据来自 `REVIEW: APPROVE`，不是这条。故记为「已知、不路由」。
 */
export const KNOWN_MARKERS_WITHOUT_WAKEUP = ["IMPLEMENTED:"];

/** 在 D1 开火之前必须先排除的：B.3 委派记录的角色前缀。 */
export const ROLE_PREFIXES = ["orch", "impl", "rev", "des", "intg"];

/** 收敛性 verdict：出现它，意味着同线程更早的非收敛 verdict 已作废。 */
const CONVERGING_VERDICT = "APPROVE";
const NON_CONVERGING_VERDICTS = ["REQUEST_CHANGES", "REJECTED"];

const ROLE_PREFIX_RE = /^(orch|impl|rev|des|intg)\s*[:：]\s*(.*)$/i;
const PROVENANCE_RE = /（[^）]*委派\s*[:：][^）]*）/;

/**
 * 全角归一（NFKC）：折叠全角拉丁字母、数字与全角标点（`：`→`:`、`＃`→`#`）。
 * 保留大小写，供 git ref（大小写敏感）取用。
 */
function normalize(text) {
  return String(text).normalize("NFKC");
}

/**
 * 归一 + 大写。规范要求「大小写无关、全角归一」；一律大写后才能对枚举
 * 做**逐字**比对——逐字是关键，`APPROVE WITH FINDINGS` 因此不会等于 `APPROVE`。
 */
function fold(text) {
  return normalize(text).toUpperCase();
}

/** 取首个非空行（B.3 的首行标记；跳过前导空行是纯归一，不是放宽）。 */
export function firstLine(body) {
  const lines = String(body ?? "").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return "";
}

/**
 * 解析一条评论的首行标记。
 *
 * 返回 `{ raw, role, head, value, verdict, sha, isDelegationRecord, hasProvenance }`：
 * - `role` 非空 ⇒ 这是 B.3 委派记录（唤醒行），不是 verdict 输出标记
 * - `head` 非空 ⇒ 首行是某规范输出标记，`value` 是其取值
 * - 两者都空 ⇒ 首行既不是委派记录也不是规范标记（未分类候选）
 */
export function parseMarker(body) {
  const raw = firstLine(body);
  const normalized = normalize(raw);
  const folded = fold(raw);
  const text = String(body ?? "");

  const roleMatch = folded.match(ROLE_PREFIX_RE);
  if (roleMatch) {
    return {
      raw,
      role: roleMatch[1].toLowerCase(),
      head: null,
      value: roleMatch[2].trim(),
      verdict: null,
      sha: null,
      isDelegationRecord: true,
      hasProvenance: PROVENANCE_RE.test(text),
    };
  }

  for (const head of SPEC_OUTPUT_MARKERS) {
    if (folded.startsWith(head)) {
      const value = folded.slice(head.length).trim();
      // `head` 全为 ASCII，其前的字符也与 head 逐字相等，故折叠串与归一串在
      // 该偏移处对齐；取值从折叠串取（比对枚举），sha 从归一串取（保留大小写）。
      const afterHead = normalized.slice(head.length).trim();
      return {
        raw,
        role: null,
        head,
        value,
        verdict: verdictOf(head, value),
        sha: shaOf(afterHead),
        isDelegationRecord: false,
        hasProvenance: PROVENANCE_RE.test(text),
      };
    }
  }

  return {
    raw,
    role: null,
    head: null,
    value: null,
    verdict: null,
    sha: null,
    isDelegationRecord: false,
    hasProvenance: PROVENANCE_RE.test(text),
  };
}

/** `APPROVE @ b37b408` → `APPROVE`；`APPROVE WITH FINDINGS` → 原样（不在枚举内）。 */
function verdictOf(head, value) {
  const beforeSha = value.split("@")[0].trim().replace(/\s+/g, " ");
  if (beforeSha.length === 0) return null;
  return (SPEC_VERDICTS[head] ?? []).includes(beforeSha) ? beforeSha : `${beforeSha} (枚举外)`;
}

/** `APPROVE @ b37b408` → `b37b408`；无 `@` 时返回 null。 */
function shaOf(value) {
  const parts = value.split("@");
  if (parts.length < 2) return null;
  const sha = parts[1].trim().split(/\s+/)[0];
  return sha.length > 0 ? sha : null;
}

/** 该标记是否在路由表里，且取值合法。 */
export function isRoutable(marker) {
  if (!marker.head) return false;
  const allowed = ROUTABLE_MARKERS[marker.head];
  if (allowed === undefined) return false;
  if (allowed === null) return true;
  return marker.verdict !== null && allowed.includes(marker.verdict);
}

/** 该取值是否落在规范枚举内。 */
export function isSpecVerdict(marker) {
  if (!marker.head) return false;
  // INTEGRATED: 的取值是自由摘要，规范未定义枚举，不参与枚举校验。
  if (SPEC_VERDICTS[marker.head] === undefined) return marker.head === "INTEGRATED:";
  return marker.verdict !== null && SPEC_VERDICTS[marker.head].includes(marker.verdict);
}

/**
 * 一条评论的分档。**顺序即优先级**：委派记录先于「已知标记」，未分类最后。
 *
 * 调用方只在 `unclassified` 一档上触发「未分类必上报」。`known-no-wakeup`
 * 与 `delegation-record` 是**已判定不路由**，与 `unclassified` 严格分开。
 */
export function classifyComment(body) {
  const marker = parseMarker(body);
  if (marker.isDelegationRecord) return { kind: "delegation-record", marker };
  if (!marker.head) return { kind: "unclassified", marker, criterion: "首行非规范标记" };
  if (KNOWN_MARKERS_WITHOUT_WAKEUP.includes(marker.head)) {
    return { kind: "known-no-wakeup", marker };
  }
  if (isRoutable(marker)) return { kind: "routable", marker };
  if (!isSpecVerdict(marker)) {
    return { kind: "unclassified", marker, criterion: `取值不在规范枚举内（${marker.verdict}）` };
  }
  return { kind: "unclassified", marker, criterion: "规范标记但路由表无对应动作" };
}

/**
 * 评估单条候选是否应判 `DISMISSED`。返回 `{ rule, reason, evidence }` 或 `null`。
 *
 * @param candidate `{ commentId, thread, body }`；`thread` 是 issue/PR 号。
 * @param threads   同批次 / 同线程的全部评论 `[{ id, thread, body }]`，
 *                  D3、D5 的取代关系在其中查找。缺失时只有 D3、D5 退化为不触发
 *                  （D1、D2 只看本条，不受影响）。
 * @param options   `{ confirmedNoRecipient: boolean }` —— D4 需人类显式确认，见下。
 *
 * 判据顺序 D1 → D2 → D3 → D5。D4 不在自动链上：它要求条目上已记录
 * 结构化原因（`recipient === null` 且 `recipientNote` 非空）**且**调用方
 * 显式传入确认，因为「无匹配接收方」是结论还是暂时性查找失败需要人判断。
 */
export function evaluateDismissal(candidate, threads = [], options = {}) {
  const body = candidate.body ?? "";
  const marker = parseMarker(body);
  const siblings = threads.filter((c) => c.thread === candidate.thread && String(c.id) !== String(candidate.commentId));

  // D1 —— B.3 委派记录：首行是角色前缀的唤醒行，本就不该路由。
  if (marker.isDelegationRecord) {
    return {
      rule: "D1",
      reason: `首行是 B.3 委派记录（${marker.role}: …），非 verdict 输出标记，不路由`,
      evidence: { role: marker.role, raw: marker.raw },
    };
  }

  // D2 —— 已知标记但本 skill 无对应唤醒动作（闭集，目前仅 IMPLEMENTED:）。
  if (marker.head && KNOWN_MARKERS_WITHOUT_WAKEUP.includes(marker.head)) {
    return {
      rule: "D2",
      reason: `${marker.head} 是规范已知输出标记，本 skill 未定义唤醒动作（已知、不路由）`,
      evidence: { head: marker.head, value: marker.value },
    };
  }

  // D3 —— 被同线程更晚的同族收敛 verdict 取代。
  if (
    marker.head &&
    marker.verdict &&
    NON_CONVERGING_VERDICTS.includes(marker.verdict)
  ) {
    const superseding = siblings.find(
      (c) =>
        Number(c.id) > Number(candidate.commentId) &&
        parseMarker(c.body).head === marker.head &&
        parseMarker(c.body).verdict === CONVERGING_VERDICT
    );
    if (superseding) {
      return {
        rule: "D3",
        reason: `${marker.head} ${marker.verdict} @ ${marker.sha ?? "（无 head）"} 已被同线程更晚的 ${CONVERGING_VERDICT} 取代（评论 ${superseding.id}）；投递会作废该 ${CONVERGING_VERDICT}`,
        evidence: { supersededBy: String(superseding.id), supersedingSha: parseMarker(superseding.body).sha },
      };
    }
  }

  // D5 —— 合并交接已无对象：同线程已有更晚的 INTEGRATED: 记录。
  if (marker.head && marker.verdict === CONVERGING_VERDICT) {
    const integrated = siblings.find(
      (c) => Number(c.id) > Number(candidate.commentId) && parseMarker(c.body).head === "INTEGRATED:"
    );
    if (integrated) {
      return {
        rule: "D5",
        reason: `该 ${marker.head} ${CONVERGING_VERDICT} 的合并交接已无对象：同线程更晚的 INTEGRATED: 记录（评论 ${integrated.id}）表明合并已完成`,
        evidence: { integratedBy: String(integrated.id), approvedSha: marker.sha },
      };
    }
  }

  return null;
}

/**
 * D4 单独评估：**只**在条目已记录结构化原因、且调用方显式确认时才成立。
 *
 * 「无匹配接收方」既可能是结论（该工作流根本没有独立实现会话可唤醒），
 * 也可能是暂时性查找失败。区分需要人判断，所以这里不接受隐式推断：
 * 必须条目上有 `recipient === null` + `recipientNote`，且传 confirmed=true。
 */
export function evaluateNoRecipientDismissal(entry, { confirmedNoRecipient = false } = {}) {
  if (!confirmedNoRecipient) return null;
  const hasRecorded =
    entry && entry.recipient === null && typeof entry.recipientNote === "string" && entry.recipientNote.trim().length > 0;
  if (!hasRecorded) return null;
  return {
    rule: "D4",
    reason: `无匹配接收方且已记录原因：${entry.recipientNote.trim()}`,
    evidence: { recipientNote: entry.recipientNote.trim() },
  };
}

/**
 * 把终态写回 claims 与 pending。**纯函数**：返回新对象，不改入参。
 *
 * - 只接受从 `CLAIMED` 到 `DISMISSED` 的转移；已是终态的不动。
 * - `claims` 不删除任何条目（既有约定：删条目会让欠账水位下的旧评论重读后重发）。
 * - 对应的 pending 条目改为 `status: "DISMISSED"` 并保留在数组中（审计 +
 *   水位钉住的理由仍成立），不删除。
 */
export function applyDismissals(state, decisions, now = new Date().toISOString()) {
  const next = structuredClone(state);
  const claims = next.claims ?? (next.claims = {});
  const pending = next.pending ?? (next.pending = []);

  for (const decision of decisions) {
    const id = String(decision.commentId);
    const claim = claims[id];
    if (claim && claim.state !== "CLAIMED") continue; // 终态不可覆盖
    claims[id] = {
      ...(claim ?? {}),
      state: "DISMISSED",
      dismissRule: decision.rule,
      dismissedAt: now,
      dismissReason: decision.reason,
    };
    if (decision.evidence) claims[id].dismissEvidence = decision.evidence;

    for (const item of pending) {
      if (String(item.comment) === id) {
        item.status = "DISMISSED";
        item.dismissRule = decision.rule;
        item.dismissedAt = now;
        item.dismissReason = decision.reason;
        if (decision.evidence) item.dismissEvidence = decision.evidence;
      }
    }
  }
  return next;
}

/**
 * 简报投影。**核心验收点在这里**：`undelivered` 只含 `CLAIMED`，
 * `DISMISSED` 只进 `dismissed`（审计），永不进 `undelivered`。
 *
 * 三态严格区分（skill 步骤 8）：
 * - `undelivered` —— 认领了但没投成：真未完成，交人判断
 * - `unclassified` —— 未分类权威信号：必须逐条上报
 * - `channelBlocked` —— 通道级事实：与单条评论无关，始终上报
 */
export function projectBriefing(state) {
  const claims = state.claims ?? {};
  const pending = state.pending ?? [];

  const undelivered = [];
  const dismissedEntries = [];
  for (const [commentId, claim] of Object.entries(claims)) {
    if (claim.state === "CLAIMED") undelivered.push({ commentId, ...claim });
    else if (claim.state === "DISMISSED") dismissedEntries.push({ commentId, ...claim });
  }
  undelivered.sort((a, b) => Number(a.commentId) - Number(b.commentId));

  const isDismissed = (commentId) =>
    commentId != null && claims[String(commentId)]?.state === "DISMISSED";

  // 未分类只收「真未分类」：条目上记的 type 与从 marker 重算的结果取并集，
  // 两个来源都不漏。可路由但送不出去的条目属「未完成」，不属「未分类」
  // ——两者都进简报，但混在一起会让人分不清该投递还是该分类。
  const unclassified = pending.filter((item) => {
    if (item.comment == null || item.type === "channel-blocked") return false;
    if (isDismissed(item.comment) || item.status === "DISMISSED") return false;
    const byRecordedType = item.type === "unclassified-authority";
    const byMarker = typeof item.marker === "string" && classifyComment(item.marker).kind === "unclassified";
    return byRecordedType || byMarker;
  });
  const channelBlocked = pending.find((item) => item.type === "channel-blocked") ?? null;

  const byRule = {};
  for (const entry of dismissedEntries) {
    const rule = entry.dismissRule ?? "unknown";
    byRule[rule] = (byRule[rule] ?? 0) + 1;
  }

  return {
    undelivered,
    unclassified,
    channelBlocked,
    dismissed: {
      count: dismissedEntries.length,
      byRule,
      entries: dismissedEntries.sort((a, b) => Number(a.commentId) - Number(b.commentId)),
    },
  };
}

/**
 * 简报的「未完成投递」段落（纯渲染，便于取证与 dry-run 输出）。
 * 断言「终态不再复报」取证的就是这个函数的输出。
 */
export function renderUndelivered(projection) {
  if (projection.undelivered.length === 0) return ["未完成投递：无"];
  return [
    `未完成投递：${projection.undelivered.length} 条`,
    ...projection.undelivered.map((item) => `  - ${item.commentId} ${item.note ?? item.action ?? ""}`.trimEnd()),
  ];
}

/** 简报的「未分类权威信号」段落。 */
export function renderUnclassified(projection) {
  if (projection.unclassified.length === 0) return ["未分类权威信号：无"];
  return [
    `未分类权威信号：${projection.unclassified.length} 条（必须逐条人工分类）`,
    ...projection.unclassified.map((item) => `  - ${item.comment} ${item.marker ?? ""} :: ${item.reason ?? ""}`.trimEnd()),
  ];
}

/** 终态审计段落。**不是**「未完成投递」。 */
export function renderDismissed(projection) {
  const { count, byRule } = projection.dismissed;
  const breakdown = Object.entries(byRule)
    .map(([rule, n]) => `${rule}=${n}`)
    .join(" ");
  return [`已判终态（DISMISSED，不计入未完成投递）：${count} 条${breakdown ? ` [${breakdown}]` : ""}`];
}
