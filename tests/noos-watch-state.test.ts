import { describe, expect, it } from "vitest";
import {
  applyDismissals,
  classifyComment,
  evaluateNoRecipientDismissal,
  parseMarker,
  projectBriefing,
  renderDismissed,
  renderUnclassified,
  renderUndelivered,
  type WatcherState
} from "../scripts/noos-watch-state.mjs";
import {
  CLAIMS_ONLY_DELEGATION,
  CLAIMS_ONLY_INTEGRATED,
  DELEGATION_RECORDS,
  EXPECTED_STAYED,
  IMPLEMENTED_MARKERS,
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
    expect(classifyComment("INTEGRATED: PR#82 @ d4dc5e4").kind).toBe("routable");
  });

  it("未知首行仍然落回未分类（「未分类必上报」护栏）", () => {
    expect(classifyComment("## Primary Design Disposition").kind).toBe("unclassified");
    expect(classifyComment("验收复查（integrator，spec §4.2）：PR #82 已合并").kind).toBe("unclassified");
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
