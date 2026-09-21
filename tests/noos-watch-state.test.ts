import { describe, expect, it } from "vitest";
import {
  applyDismissals,
  classifyComment,
  evaluateDismissal,
  evaluateNoRecipientDismissal,
  parseMarker,
  projectBriefing,
  renderDismissed,
  renderUnclassified,
  renderUndelivered,
  TERMINATABLE_CLAIM_STATES,
  type WatcherState
} from "../scripts/noos-watch-state.mjs";
import {
  ALL_COMMENTS,
  CLAIMS_ONLY_DELEGATION,
  CLAIMS_ONLY_INTEGRATED,
  DELEGATION_RECORDS,
  EXPECTED_STAYED,
  IMPLEMENTED_MARKERS,
  ISOLATED_VERDICTS,
  MOOT_APPROVALS,
  NO_RECIPIENT,
  NO_RECIPIENT_NOTE,
  SUPERSEDED,
  TRULY_UNDELIVERED,
  UNCLASSIFIED,
  buildFixturesState,
  evaluateAll
} from "./fixtures/watcher-state-fixture";

const MIGRATED_AT = "2026-09-20T13:00:00.000Z";

/** 迁移后的生产状态形状（夹具 → 判据 → 终态）。 */
function migratedState(): WatcherState {
  const before = buildFixturesState();
  return applyDismissals(before, evaluateAll(before), MIGRATED_AT);
}

describe("解析层：首行标记分档", () => {
  it("区分 B.3 委派记录与 verdict 输出标记", () => {
    expect(parseMarker("rev: review PR#83 @ 331c24a").isDelegationRecord).toBe(true);
    expect(parseMarker("REVIEW: APPROVE @ b37b408").isDelegationRecord).toBe(false);
    expect(parseMarker("REVIEW: APPROVE @ b37b408").head).toBe("REVIEW:");
    expect(parseMarker("REVIEW: APPROVE @ b37b408").verdict).toBe("APPROVE");
  });

  it("git ref 保留大小写（大小写敏感，不做大写归一）", () => {
    expect(parseMarker("REVIEW: APPROVE @ b37b408").sha).toBe("b37b408");
    expect(parseMarker("REVIEW: APPROVE @ 91DDdc0Ba2533d97e872542781664834211677e1").sha).toBe(
      "91DDdc0Ba2533d97e872542781664834211677e1"
    );
  });

  it("全角与大小写归一（NFKC + 大写）", () => {
    expect(parseMarker("ｒｅｖｉｅｗ： approve ＠ b37b408").head).toBe("REVIEW:");
    expect(parseMarker("review：APPROVE @ b37b408").head).toBe("REVIEW:");
    expect(parseMarker("REVIEW：APPROVE @ b37b408").verdict).toBe("APPROVE");
  });

  it("跳过前导空行（归一，不是放宽）", () => {
    expect(parseMarker("\n\nREVIEW: APPROVE @ b37b408").head).toBe("REVIEW:");
  });

  it("`APPROVE WITH FINDINGS` 不是枚举里的 `APPROVE`", () => {
    const marker = parseMarker("REVIEW: APPROVE WITH FINDINGS @ 1a7e95c");
    expect(marker.head).toBe("REVIEW:");
    expect(marker.verdict).not.toBe("APPROVE");
    expect(classifyComment("REVIEW: APPROVE WITH FINDINGS @ 1a7e95c").kind).toBe("unclassified");
  });

  it("`IMPLEMENTED:` 是已知标记、无唤醒动作，不是未分类", () => {
    expect(classifyComment("IMPLEMENTED: PR#82 （impl: 直评）").kind).toBe("known-no-wakeup");
  });

  it("`rev:` 委派记录不是未分类", () => {
    expect(classifyComment("rev: review PR#83 @ 331c24a（impl: 直评, 委派: 人）").kind).toBe("delegation-record");
  });

  it("`INTEGRATED:` 仍可路由（有对应动作：记录并通知 orchestrator）", () => {
    expect(classifyComment("INTEGRATED: 纯文档，无需部署；合并后 main 验证 @ 3ce4079").kind).toBe("routable");
  });

  it("exact ref 取最后一段，摘要里的 `@` 不会取错", () => {
    // 生产形态：`INTEGRATED: <自由摘要> @ <merge-sha>`，ref 在最后。
    const production =
      "INTEGRATED: 纯文档，无需部署；合并后 main 验证 typecheck 干净、CI 口径（Node 24）40 files / 508 passed @ 3ce407905dc276d6e46d8c9fd0e8c8110d847d69";
    expect(parseMarker(production).sha).toBe("3ce407905dc276d6e46d8c9fd0e8c8110d847d69");
    // 摘要里出现 `@`（提及）：仍取最后一段。
    expect(parseMarker("INTEGRATED: 摘要含 @someone 提及 @ 8d7765a4da34").sha).toBe("8d7765a4da34");
    // 不是 sha 就取不到，而不是填一段垃圾进审计字段。
    expect(parseMarker("INTEGRATED: 纯文档 @ 见上").sha).toBeNull();
    expect(parseMarker("INTEGRATED: 纯文档，无 ref").sha).toBeNull();
  });

  it("未知首行仍然落回未分类（「未分类必上报」护栏）", () => {
    expect(classifyComment("## Primary Design Disposition").kind).toBe("unclassified");
    expect(classifyComment("验收复查（integrator，spec §4.2）：PR #82 已合并").kind).toBe("unclassified");
  });
});

describe("夹具保真：照抄生产形态，不自造形状", () => {
  const integrated = ALL_COMMENTS.filter((c) => parseMarker(c.body).head === "INTEGRATED:");

  it("夹具里的 INTEGRATED 文本与生产同形（无 PR 引用、恰好一个 @、ref 在末尾）", () => {
    expect(integrated.length).toBeGreaterThan(0);
    for (const comment of integrated) {
      const line = comment.body.split("\n")[0];
      // 实测生产 18/18 条 INTEGRATED 首行都不带 PR 引用——夹具不得自造这个形状，
      // 否则「用夹具验收」会把结论证成自己想要的形状。
      expect(line).not.toMatch(/PR\s*#?\s*\d+/i);
      expect((line.match(/@/g) ?? []).length).toBe(1);
      expect(parseMarker(comment.body).sha).not.toBeNull();
    }
  });

  it("夹具里的 IMPLEMENTED 文本取自生产在用形态", () => {
    for (const comment of IMPLEMENTED_MARKERS) {
      expect(comment.body.split("\n")[0]).toMatch(/^IMPLEMENTED: PR#\d+/);
    }
  });
});

describe("缺陷一复现：迁移前，委派记录每轮都进「未完成投递」", () => {
  const projection = projectBriefing(buildFixturesState());
  const undeliveredIds = projection.undelivered.map((item) => item.commentId);

  it("11 条 B.3 委派记录 + 1 条 claims-only 委派记录全部在未完成投递里", () => {
    for (const record of [...DELEGATION_RECORDS, CLAIMS_ONLY_DELEGATION]) {
      expect(undeliveredIds).toContain(String(record.id));
    }
  });

  it("2 条 IMPLEMENTED: 也在未完成投递里", () => {
    for (const marker of IMPLEMENTED_MARKERS) expect(undeliveredIds).toContain(String(marker.id));
  });

  it("终态计数为 0（词表里根本没有终态可用）", () => {
    expect(projection.dismissed.count).toBe(0);
  });
});

describe("核心验收：终态不再复报", () => {
  const after = migratedState();
  const projection = projectBriefing(after);
  const undeliveredIds = projection.undelivered.map((item) => item.commentId);
  const dismissedIds = projection.dismissed.entries.map((item) => item.commentId);
  const unclassifiedIds = projection.unclassified.map((item) => String(item.comment));

  it("D1：12 条 B.3 委派记录判终态，且不再进未完成投递、不进未分类", () => {
    for (const record of [...DELEGATION_RECORDS, CLAIMS_ONLY_DELEGATION]) {
      expect(undeliveredIds).not.toContain(String(record.id));
      expect(unclassifiedIds).not.toContain(String(record.id));
      expect(dismissedIds).toContain(String(record.id));
      expect(after.claims[String(record.id)].dismissRule).toBe("D1");
    }
  });

  it("D2：2 条 IMPLEMENTED: 判终态，不计入未分类", () => {
    for (const marker of IMPLEMENTED_MARKERS) {
      expect(undeliveredIds).not.toContain(String(marker.id));
      expect(unclassifiedIds).not.toContain(String(marker.id));
      expect(after.claims[String(marker.id)].dismissRule).toBe("D2");
    }
  });

  it("D3：被同批 APPROVE 取代的 REQUEST_CHANGES 判终态，并记下取代者", () => {
    for (const superseded of SUPERSEDED) {
      expect(undeliveredIds).not.toContain(String(superseded.id));
      expect(after.claims[String(superseded.id)].dismissRule).toBe("D3");
      expect(after.claims[String(superseded.id)].dismissEvidence).toMatchObject({ supersededBy: expect.any(String) });
    }
  });

  it("D5：PR 已 INTEGRATED 的合并交接判终态", () => {
    for (const moot of MOOT_APPROVALS) {
      expect(undeliveredIds).not.toContain(String(moot.id));
      expect(after.claims[String(moot.id)].dismissRule).toBe("D5");
    }
  });

  it("终态条目带 dismissedAt 与 dismissReason（可审计）", () => {
    expect(projection.dismissed.count).toBe(evaluateAll(buildFixturesState()).length);
    for (const entry of projection.dismissed.entries) {
      expect(entry.dismissedAt).toBe(MIGRATED_AT);
      expect((entry.dismissReason ?? "").length).toBeGreaterThan(0);
      expect(typeof entry.dismissRule).toBe("string");
    }
    expect(projection.dismissed.byRule).toEqual({ D1: 12, D2: 2, D3: 2, D5: 4 });
  });

  it("终态只进审计段，不进未完成投递段", () => {
    const rendered = renderUndelivered(projection).join("\n");
    for (const id of dismissedIds) expect(rendered).not.toContain(id);
    expect(renderDismissed(projection)[0]).toContain("不计入未完成投递");
    expect(renderDismissed(projection)[0]).toContain("D1=12");
  });
});

describe("核心验收：真未完成与真未分类仍然出现", () => {
  const projection = projectBriefing(migratedState());
  const undeliveredIds = projection.undelivered.map((item) => item.commentId);
  const unclassifiedIds = projection.unclassified.map((item) => String(item.comment));

  it("送不出去的 INTEGRATED 记录仍留在未完成投递（通道问题不是结论）", () => {
    for (const comment of EXPECTED_STAYED) expect(undeliveredIds).toContain(String(comment.id));
  });

  it("未完成投递恰好 = 真未完成 ∪ 真未分类，无一条终态混入", () => {
    expect([...undeliveredIds].sort()).toEqual(EXPECTED_STAYED.map((c) => String(c.id)).sort());
  });

  it("枚举外取值（APPROVE WITH FINDINGS ×4）仍进未分类且被上报", () => {
    const enumGap = UNCLASSIFIED.filter((c) => c.body.startsWith("REVIEW: APPROVE WITH FINDINGS"));
    expect(enumGap.length).toBe(4);
    for (const comment of enumGap) {
      expect(unclassifiedIds).toContain(String(comment.id));
      expect(undeliveredIds).toContain(String(comment.id));
    }
  });

  it("自由文本权威信号与 designer 原生裁定仍进未分类且被上报", () => {
    for (const comment of UNCLASSIFIED) {
      expect(unclassifiedIds).toContain(String(comment.id));
      expect(undeliveredIds).toContain(String(comment.id));
    }
  });

  it("未分类段逐条渲染", () => {
    const rendered = renderUnclassified(projection).join("\n");
    expect(rendered).toContain("必须逐条人工分类");
    expect(rendered).toContain(String(UNCLASSIFIED[4].id));
  });

  it("未分类只收真未分类：可路由但送不出去的 INTEGRATED 不混进来", () => {
    expect([...unclassifiedIds].sort()).toEqual(UNCLASSIFIED.map((c) => String(c.id)).sort());
    for (const comment of [...TRULY_UNDELIVERED, ...CLAIMS_ONLY_INTEGRATED]) {
      expect(unclassifiedIds).not.toContain(String(comment.id));
      expect(undeliveredIds).toContain(String(comment.id));
    }
  });

  it("通道级事实（channel-blocked）始终上报，不因终态被吞", () => {
    expect(projection.channelBlocked).not.toBeNull();
    expect(projection.channelBlocked?.type).toBe("channel-blocked");
    expect(projection.channelBlocked?.comment).toBeNull();
  });
});

describe("D4：无匹配接收方须显式确认，不隐式推断", () => {
  const entry = { type: "unrouted", comment: NO_RECIPIENT.id, recipient: null, recipientNote: NO_RECIPIENT_NOTE };

  it("未确认时不判终态", () => {
    expect(evaluateNoRecipientDismissal(entry, { confirmedNoRecipient: false })).toBeNull();
  });

  it("已确认但条目没记录结构化原因时仍不判终态", () => {
    expect(evaluateNoRecipientDismissal({ ...entry, recipientNote: "" }, { confirmedNoRecipient: true })).toBeNull();
    expect(evaluateNoRecipientDismissal({ comment: 1, reason: "无匹配会话" }, { confirmedNoRecipient: true })).toBeNull();
  });

  it("D4 不在自动判据链上（无确认时该条目保留 CLAIMED）", () => {
    const after = migratedState();
    expect(after.claims[String(NO_RECIPIENT.id)].state).toBe("CLAIMED");
  });

  it("已确认且已记录原因时判终态，原因进 dismissReason", () => {
    const decision = evaluateNoRecipientDismissal(entry, { confirmedNoRecipient: true });
    expect(decision?.rule).toBe("D4");
    expect(decision?.reason).toContain(NO_RECIPIENT_NOTE);
  });
});

describe("负例对照：孤立的 verdict 不得被判掉（reviewer F4）", () => {
  const after = migratedState();
  const projection = projectBriefing(after);
  const undeliveredIds = projection.undelivered.map((item) => item.commentId);
  const dismissedIds = projection.dismissed.entries.map((item) => item.commentId);

  it("同线程无更晚 APPROVE / INTEGRATED 的 verdict 仍留 CLAIMED", () => {
    for (const comment of ISOLATED_VERDICTS) {
      const id = String(comment.id);
      expect(after.claims[id].state).toBe("CLAIMED");
      expect(undeliveredIds).toContain(id);
      expect(dismissedIds).not.toContain(id);
    }
  });

  it("D5 要求更晚的 INTEGRATED：更早的不开火", () => {
    const earlier = { id: 1, thread: 99, body: "INTEGRATED: 纯文档 @ aaa1111" };
    const approve = { id: 2, thread: 99, body: "REVIEW: APPROVE @ bbb2222\n（rev: 直评, 委派: orch）" };
    // INTEGRATED 在 APPROVE 之前 ⇒ 该次合并还没发生，交接不无对象
    expect(evaluateDismissal({ commentId: 2, thread: 99, body: approve.body }, [earlier, approve])).toBeNull();
  });

  it("D5：INTEGRATED 更晚才开火", () => {
    const approve = { id: 1, thread: 99, body: "REVIEW: APPROVE @ bbb2222\n（rev: 直评, 委派: orch）" };
    const later = { id: 2, thread: 99, body: "INTEGRATED: 纯文档 @ aaa1111" };
    const decision = evaluateDismissal({ commentId: 1, thread: 99, body: approve.body }, [approve, later]);
    expect(decision?.rule).toBe("D5");
    expect(decision?.evidence).toMatchObject({ integratedBy: "2" });
  });

  it("D3 要求更晚的 APPROVE：更早的不开火", () => {
    const approve = { id: 1, thread: 98, body: "REVIEW: APPROVE @ ccc3333\n（rev: 直评, 委派: orch）" };
    const changes = { id: 2, thread: 98, body: "REVIEW: REQUEST_CHANGES @ ddd4444\n（rev: 直评, 委派: orch）" };
    expect(evaluateDismissal({ commentId: 2, thread: 98, body: changes.body }, [approve, changes])).toBeNull();
  });

  it("D3：APPROVE 更晚才开火", () => {
    const changes = { id: 1, thread: 97, body: "REVIEW: REQUEST_CHANGES @ ddd4444\n（rev: 直评, 委派: orch）" };
    const approve = { id: 2, thread: 97, body: "REVIEW: APPROVE @ ccc3333\n（rev: 直评, 委派: orch）" };
    expect(evaluateDismissal({ commentId: 1, thread: 97, body: changes.body }, [changes, approve])?.rule).toBe("D3");
  });

  it("跨线程不算数：别的线程的更晚标记不得开火", () => {
    const approve = { id: 1, thread: 96, body: "REVIEW: APPROVE @ bbb2222" };
    const otherThread = { id: 2, thread: 95, body: "INTEGRATED: 纯文档 @ aaa1111" };
    expect(evaluateDismissal({ commentId: 1, thread: 96, body: approve.body }, [approve, otherThread])).toBeNull();
  });
});

/** 最小状态：只放投影关心的两个集合。 */
function minimalState(claims: Record<string, { state: string }>, pending: Record<string, unknown>[]): WatcherState {
  return { schemaVersion: 2, watermark: "2026-09-20T00:00:00Z", claims, pending } as unknown as WatcherState;
}

describe("投影 fail-open：认不出来必须倒向上报（reviewer F2）", () => {
  it("按 skill 明文落 pending（无 marker）时仍进未分类，不静默漏", () => {
    const state = minimalState({ "1": { state: "CLAIMED" } }, [{ type: "unrouted", comment: 1, action: "拟投暗号" }]);
    expect(projectBriefing(state).unclassified.map((item) => String(item.comment))).toContain("1");
  });

  it("type 为 unclassified-authority 时即使没有 marker 也上报", () => {
    const state = minimalState({ "1": { state: "CLAIMED" } }, [
      { type: "unclassified-authority", comment: 1, reason: "枚举外取值" }
    ]);
    expect(projectBriefing(state).unclassified).toHaveLength(1);
  });

  it("有 marker 且可路由的不混进未分类（真未完成归 undelivered）", () => {
    const state = minimalState({ "1": { state: "CLAIMED" } }, [
      { type: "unrouted", comment: 1, marker: "INTEGRATED: 纯文档 @ aaa1111" }
    ]);
    const projection = projectBriefing(state);
    expect(projection.unclassified).toEqual([]);
    expect(projection.undelivered.map((item) => item.commentId)).toEqual(["1"]);
  });

  it("有 marker 且已判定不路由的也不进未分类", () => {
    const state = minimalState({ "1": { state: "CLAIMED" } }, [
      { type: "unrouted", comment: 1, marker: "rev: review PR#1 @ aaa1111" }
    ]);
    expect(projectBriefing(state).unclassified).toEqual([]);
  });

  it("有 marker 且未分类的进未分类", () => {
    const state = minimalState({ "1": { state: "CLAIMED" } }, [
      { type: "unrouted", comment: 1, marker: "REVIEW: APPROVE WITH FINDINGS @ aaa1111" }
    ]);
    expect(projectBriefing(state).unclassified.map((item) => String(item.comment))).toEqual(["1"]);
  });

  it("已判终态的条目即使没有 marker 也不上报", () => {
    const state = minimalState({ "1": { state: "DISMISSED" } }, [{ type: "unrouted", comment: 1 }]);
    const projection = projectBriefing(state);
    expect(projection.unclassified).toEqual([]);
    expect(projection.undelivered).toEqual([]);
  });
});

describe("欠账投影收 UNROUTED（reviewer F1）", () => {
  it("state 为 UNROUTED 的 claim 出现在未完成投递里，不静默丢", () => {
    const state = minimalState({ "1": { state: "UNROUTED" } }, []);
    expect(projectBriefing(state).undelivered.map((item) => item.commentId)).toEqual(["1"]);
  });

  it("两个终态都不进未完成投递；UNROUTED 与 CLAIMED 都进", () => {
    const state = minimalState(
      { "1": { state: "ROUTED" }, "2": { state: "DISMISSED" }, "3": { state: "CLAIMED" }, "4": { state: "UNROUTED" } },
      []
    );
    expect(projectBriefing(state).undelivered.map((item) => item.commentId)).toEqual(["3", "4"]);
  });
});

describe("欠账状态都可判终态（活数据暴露的缺口）", () => {
  it("UNROUTED 也能移入 DISMISSED，且移出后不再欠账", () => {
    const state = minimalState({ "1": { state: "UNROUTED" } }, [{ type: "unrouted", comment: 1, marker: "rev: review PR#93 @ aaa1111" }]);
    const after = applyDismissals(state, [{ commentId: "1", rule: "D1", reason: "B.3 委派记录，不路由", evidence: {} }], MIGRATED_AT);
    expect(after.claims["1"].state).toBe("DISMISSED");
    expect(after.claims["1"].dismissRule).toBe("D1");
    expect(projectBriefing(after).undelivered).toEqual([]);
  });

  it("只从 CLAIMED 收会让这条永远移不动——回归断言", () => {
    // 若哪天有人把 TERMINATABLE_CLAIM_STATES 收回成只含 CLAIMED，这条会红。
    expect(TERMINATABLE_CLAIM_STATES).toContain("CLAIMED");
    expect(TERMINATABLE_CLAIM_STATES).toContain("UNROUTED");
  });

  it("终态仍不可覆盖：ROUTED 与 DISMISSED 都不动", () => {
    const state = minimalState({ "1": { state: "ROUTED" }, "2": { state: "DISMISSED" } }, []);
    const after = applyDismissals(
      state,
      [
        { commentId: "1", rule: "D1", reason: "不该生效", evidence: {} },
        { commentId: "2", rule: "D5", reason: "不该生效", evidence: {} }
      ],
      MIGRATED_AT
    );
    expect(after.claims["1"].state).toBe("ROUTED");
    expect(after.claims["1"].dismissRule).toBeUndefined();
    expect(after.claims["2"].state).toBe("DISMISSED");
    expect(after.claims["2"].dismissRule).toBeUndefined();
  });
});

describe("状态机不变量", () => {
  it("终态不可被再次覆盖", () => {
    const once = applyDismissals(
      buildFixturesState(),
      [{ commentId: "5749080286", rule: "D1", reason: "first", evidence: {} }],
      MIGRATED_AT
    );
    const twice = applyDismissals(once, [{ commentId: "5749080286", rule: "D3", reason: "second", evidence: {} }], "2026-09-20T14:00:00.000Z");
    expect(twice.claims["5749080286"].dismissRule).toBe("D1");
    expect(twice.claims["5749080286"].dismissedAt).toBe(MIGRATED_AT);
  });

  it("不删除任何 claims 条目（欠账水位下不重放）", () => {
    const before = buildFixturesState();
    const after = applyDismissals(before, evaluateAll(before), MIGRATED_AT);
    expect(Object.keys(after.claims).sort()).toEqual(Object.keys(before.claims).sort());
  });

  it("pending 条目保留但改记为 DISMISSED（审计不丢）", () => {
    const before = buildFixturesState();
    const after = applyDismissals(before, evaluateAll(before), MIGRATED_AT);
    expect(after.pending.length).toBe(before.pending.length);
    const record = after.pending.find((item) => String(item.comment) === "5749080286");
    expect(record?.status).toBe("DISMISSED");
    expect(record?.dismissReason).toBeTruthy();
  });

  it("水位、stages 与 health 都不被终态改动（迁移脚本另行重算派生字段）", () => {
    const before = buildFixturesState();
    const after = applyDismissals(before, evaluateAll(before), MIGRATED_AT);
    expect(after.watermark).toBe(before.watermark);
    expect(after.health).toEqual(before.health);
    expect(after.stages).toEqual(before.stages);
  });

  it("入参不被就地修改（纯函数）", () => {
    const before = buildFixturesState();
    const snapshot = JSON.stringify(before);
    applyDismissals(before, evaluateAll(before), MIGRATED_AT);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});
