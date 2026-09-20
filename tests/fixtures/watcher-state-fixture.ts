/**
 * noos-watch 状态机测试夹具，照抄 2026-09-20 生产状态文件
 * （`.tmp/watcher-state.json`）的形状与文本。
 *
 * 生产现状：39 条 pending 中 38 条停在 `CLAIMED`，其中 **11 条是合规 B.3
 * 委派记录**（`action` 字面已写「记录不路由：B.3 委派记录」——watcher 早已
 * 正确判定不路由，却因 `claims` 词表没有终态而每轮重报一次）。
 *
 * 两个测试文件共用本夹具：`noos-watch-state.test.ts` 断言判据与投影，
 * `noos-watch-migrate-dismissed.test.ts` 断言迁移脚本的行为。
 */
import { evaluateDismissal, type DismissalDecision, type ThreadComment, type WatcherState } from "../../scripts/noos-watch-state.mjs";

export interface FixtureComment extends ThreadComment {
  note: string;
}

/** 11 条 B.3 委派记录（D1）：首行是角色前缀的唤醒行，不是 verdict 输出标记。 */
export const DELEGATION_RECORDS: FixtureComment[] = [
  { id: 5749080286, thread: 73, body: "rev: review PR#73 @ 5d18d80f70dc1a236058f08348e5e6fd0fdb4be6\n（orch: 派单, 委派: rev）", note: "B.3 委派记录" },
  { id: 5749080428, thread: 57, body: "rev: review PR#57 @ 4164ec138deeb309968767a6c4f81a49a59045ea\n（orch: 派单, 委派: rev）", note: "B.3 委派记录" },
  { id: 5749080588, thread: 79, body: "rev: review PR#79 @ 1a7e95c1a99ad38675e87535da007cf8aa87466c\n（orch: 派单, 委派: rev）", note: "B.3 委派记录" },
  { id: 5749153661, thread: 83, body: "rev: review PR#83 @ 331c24a（impl: 直评, 委派: 人）", note: "B.3 委派记录" },
  { id: 5749160717, thread: 82, body: "rev: review PR#82（无 provenance 行）", note: "B.3 委派记录" },
  { id: 5749193818, thread: 70, body: "rev: review PR#70 @ 6b5bd1c（委派记录，先于结论标记）", note: "B.3 委派记录" },
  { id: 5749193901, thread: 77, body: "rev: review PR#77 @ 73d74e7（委派记录，先于结论标记）", note: "B.3 委派记录" },
  { id: 5749194039, thread: 83, body: "rev: review PR#83 @ b37b408（委派记录，先于结论标记）", note: "B.3 委派记录" },
  { id: 5749214865, thread: 73, body: "rev: review PR#73 @ 19fd2cb（委派记录，先于结论标记）", note: "B.3 委派记录" },
  { id: 5749215034, thread: 57, body: "rev: review PR#57 @ 173e844（委派记录，先于结论标记）", note: "B.3 委派记录" },
  { id: 5749466487, thread: 81, body: "rev: review PR#81\n（orch: 派单, 委派: rev）", note: "B.3 委派记录" }
];

/** 第二条委派记录：只出现在 `claims` 里（不在 pending），仍需被判终态。 */
export const CLAIMS_ONLY_DELEGATION: FixtureComment = {
  id: 5749520221,
  thread: 86,
  body: "rev: review PR#86 @ 8e333a1\n（impl: 直评, 委派: 人）",
  note: "B.3 委派记录（claims-only）"
};

/** 2 条 `IMPLEMENTED:`（D2）：规范已知标记，本 skill 无对应唤醒动作。 */
export const IMPLEMENTED_MARKERS: FixtureComment[] = [
  { id: 5749163336, thread: 69, body: "IMPLEMENTED: PR#82 （impl: 直评）\n（impl: 直评, 委派: 人）", note: "规范 IMPLEMENTED 标记" },
  { id: 5749208522, thread: 60, body: "IMPLEMENTED: PR#83 （impl: 直评）\n（impl: 直评, 委派: 人）", note: "规范 IMPLEMENTED 标记" }
];

/** 被同线程更晚的 APPROVE 取代的 REQUEST_CHANGES（D3）。 */
export const SUPERSEDED: FixtureComment[] = [
  { id: 5749194531, thread: 83, body: "REVIEW: REQUEST_CHANGES @ 331c24a\n（rev: 直评, 委派: orch）", note: "陈旧信号" },
  { id: 5749163805, thread: 70, body: "REVIEW: REQUEST_CHANGES @ 05a2c38f35cbac3c8e4fd841b90b6c522f78070d\n（rev: 直评, 委派: orch）", note: "陈旧信号" }
];

/** 4 条合并交接，其 PR 同线程已有更晚的 `INTEGRATED:` 记录（D5）。 */
export const MOOT_APPROVALS: FixtureComment[] = [
  { id: 5749161672, thread: 82, body: "REVIEW: APPROVE @ 91dddc0ba2533d97e872542781664834211677e1\n（rev: 直评, 委派: orch）", note: "合并交接已无对象" },
  { id: 5749197813, thread: 70, body: "REVIEW: APPROVE @ 6b5bd1c5a7c499f17e447f0f16bc3dad4eb17072\n（rev: 直评, 委派: orch）", note: "合并交接已无对象" },
  { id: 5749198334, thread: 77, body: "REVIEW: APPROVE @ 73d74e7f25233bd10322c78a94fe922538002ba3\n（rev: 直评, 委派: orch）", note: "合并交接已无对象" },
  { id: 5749207718, thread: 83, body: "REVIEW: APPROVE @ b37b4083767540a7cbf57f297ad94994e8c7d04c\n（rev: 直评, 委派: orch）", note: "合并交接已无对象" }
];

/** 真未完成：`INTEGRATED:` 记录本身可路由、只是送不出去 ⇒ 必须留在「未完成投递」。 */
export const TRULY_UNDELIVERED: FixtureComment[] = [
  { id: 5749501889, thread: 82, body: "INTEGRATED: PR#82 @ d4dc5e4\n（intg: 直评, 委派: 人）", note: "集成记录待通知" },
  { id: 5749502109, thread: 83, body: "INTEGRATED: PR#83 @ 1ee215a\n（intg: 直评, 委派: 人）", note: "集成记录待通知" },
  { id: 5749502316, thread: 70, body: "INTEGRATED: PR#70 @ 1beaff2\n（intg: 直评, 委派: 人）", note: "集成记录待通知" },
  { id: 5749502542, thread: 77, body: "INTEGRATED: PR#77 @ 3ce4079\n（intg: 直评, 委派: 人）", note: "集成记录待通知" },
  { id: 5749502708, thread: 79, body: "INTEGRATED: PR#79 @ 049a794\n（intg: 直评, 委派: 人）", note: "集成记录待通知" }
];

/** claims-only 的集成记录（真未完成，不在 pending 里）。 */
export const CLAIMS_ONLY_INTEGRATED: FixtureComment[] = [
  { id: 5749531134, thread: 73, body: "INTEGRATED: PR#73 @ 9c1a2ab\n（intg: 直评, 委派: 人）", note: "集成记录待通知" },
  { id: 5749531301, thread: 57, body: "INTEGRATED: PR#57 @ 2ab77c1\n（intg: 直评, 委派: 人）", note: "集成记录待通知" },
  { id: 5749531424, thread: 81, body: "INTEGRATED: PR#81 @ 88c1c02\n（intg: 直评, 委派: 人）", note: "集成记录待通知" },
  { id: 5749549901, thread: 86, body: "INTEGRATED: PR#86 @ 6731a60\n（intg: 直评, 委派: 人）", note: "集成记录待通知" }
];

/**
 * 真未分类：**必须**继续进 pending 并逐条上报。第一组是规范词汇缺口
 * （`APPROVE WITH FINDINGS` 不是枚举里的 `APPROVE`），第二组是自由文本
 * 权威信号，第三组是 designer 经 connector 的原生裁定。
 */
export const UNCLASSIFIED: FixtureComment[] = [
  { id: 5749111606, thread: 79, body: "REVIEW: APPROVE WITH FINDINGS @ 1a7e95c1a99ad38675e87535da007cf8aa87466c\n（rev: 直评, 委派: orch）", note: "枚举外取值" },
  { id: 5749121751, thread: 57, body: "REVIEW: APPROVE WITH FINDINGS @ 4164ec138deeb309968767a6c4f81a49a59045ea\n（rev: 直评, 委派: orch）", note: "枚举外取值" },
  { id: 5749221289, thread: 57, body: "REVIEW: APPROVE WITH FINDINGS @ 173e844413fc718158a0ba64470d8ad50bf78074\n（rev: 直评, 委派: orch）", note: "枚举外取值" },
  { id: 5749222277, thread: 73, body: "REVIEW: APPROVE WITH FINDINGS @ 19fd2cb68d42df9f68e22c0920581fe29b9a8d4c\n（rev: 直评, 委派: orch）", note: "枚举外取值" },
  { id: 5749506840, thread: 69, body: "验收复查（integrator，spec §4.2）：PR #82 已合并（d4dc5e4）", note: "自由文本权威信号" },
  { id: 5749507104, thread: 60, body: "验收复查（integrator，spec §4.2）：PR #83 已合并（1ee215a）", note: "自由文本权威信号" },
  { id: 5749522753, thread: 84, body: "复核 #84：覆盖缺口记录（chatgpt-dom.ts:26 精确选择器无承载）", note: "reviewer 自由文本记录" },
  { id: 5749597396, thread: 85, body: "## Primary Design Disposition\n<!-- noos-governor event=design_disposition -->\n**Decision:** `ACCEPT`", note: "designer 经 connector 的裁定" }
];

/** D4 候选：无匹配接收方，但条目上记录了结构化原因。 */
export const NO_RECIPIENT: FixtureComment = {
  id: 5749121573,
  thread: 73,
  body: "REVIEW: REQUEST_CHANGES @ 5d18d80f70dc1a236058f08348e5e6fd0fdb4be6\n（rev: 直评, 委派: orch）",
  note: "无匹配的实现会话"
};
export const NO_RECIPIENT_NOTE = "该工作流由 Orchestrator 会话直评驱动，不存在独立实现会话可唤醒";

export const ALL_COMMENTS: FixtureComment[] = [
  ...DELEGATION_RECORDS,
  CLAIMS_ONLY_DELEGATION,
  ...IMPLEMENTED_MARKERS,
  ...SUPERSEDED,
  ...MOOT_APPROVALS,
  ...TRULY_UNDELIVERED,
  ...CLAIMS_ONLY_INTEGRATED,
  ...UNCLASSIFIED,
  NO_RECIPIENT
];

/** 本该保留为 `CLAIMED` 的条目：真未完成 + 真未分类。 */
export const EXPECTED_STAYED: FixtureComment[] = [
  ...TRULY_UNDELIVERED,
  ...CLAIMS_ONLY_INTEGRATED,
  ...UNCLASSIFIED,
  NO_RECIPIENT
];

export const threadComments: ThreadComment[] = ALL_COMMENTS.map(({ id, thread, body }) => ({ id, thread, body }));

/**
 * 迁移前的生产状态形状：所有非终态条目一律 `CLAIMED`；pending 条目带
 * `marker`（首行）与 `reason`，claims 条目带 `action` 与 `note`。
 */
export function buildFixturesState(): WatcherState {
  const claims: WatcherState["claims"] = {};
  const pending: WatcherState["pending"] = [];

  for (const comment of ALL_COMMENTS) {
    claims[String(comment.id)] = {
      state: "CLAIMED",
      action: comment.note,
      claimedAt: "2026-09-20T12:24:11.993Z",
      note: comment.note
    };
    pending.push({
      type: comment.id === NO_RECIPIENT.id ? "unrouted" : comment.note === "枚举外取值" ? "unclassified-authority" : "unrouted",
      comment: comment.id,
      status: "CLAIMED",
      issue: comment.thread,
      marker: comment.body.split("\n")[0],
      reason: comment.note,
      action: comment.note,
      ...(comment.id === NO_RECIPIENT.id ? { recipient: null, recipientNote: NO_RECIPIENT_NOTE } : {})
    });
  }

  pending.push({
    type: "channel-blocked",
    comment: null,
    action: "GLOBAL: both delivery channels remain unavailable in unattended scheduled runs.",
    pendingUndelivered: 37,
    status: "CLAIMED"
  });

  return {
    schemaVersion: 2,
    watermark: "2026-09-20T11:27:48Z",
    claims,
    pending,
    stages: [],
    health: {
      lastStartedAt: "2026-09-20T12:23:26.000Z",
      lastSuccessfulAdvanceAt: "2026-09-20T11:28:50.168Z",
      lastCompletedPollAt: "2026-09-20T12:24:42.685Z",
      activeRun: null,
      consecutiveInterruptions: 0,
      lastError: "欠账：19 条已认领未投递（投递通道在 unattended 下不可用）"
    }
  };
}

/** 对每条 `CLAIMED` 候选跑一遍自动判据（D1/D2/D3/D5）。 */
export function evaluateAll(state: WatcherState): (DismissalDecision & { commentId: string })[] {
  const decisions: (DismissalDecision & { commentId: string })[] = [];
  for (const [commentId, claim] of Object.entries(state.claims)) {
    if (claim.state !== "CLAIMED") continue;
    const comment = threadComments.find((c) => String(c.id) === commentId);
    if (!comment) continue;
    const decision = evaluateDismissal({ commentId, thread: comment.thread, body: comment.body }, threadComments);
    if (decision) decisions.push({ commentId, ...decision });
  }
  return decisions;
}

/** `gh api repos/<o>/<r>/issues/comments` 的返回形状，供迁移脚本 `--comments` 使用。 */
export function toGhApiComments(): unknown[] {
  return ALL_COMMENTS.map((comment) => ({
    id: comment.id,
    body: comment.body,
    issue_url: `https://api.github.com/repos/futouyiba/noos-shuttle/issues/${comment.thread}`
  }));
}
