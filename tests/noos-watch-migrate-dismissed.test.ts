import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  defaultStatePath,
  normalizeComments,
  parseArgs,
  planMigration,
  refreshDerivedFields,
  renderPlan
} from "../scripts/noos-watch-migrate-dismissed.mjs";
import { applyDismissals, projectBriefing } from "../scripts/noos-watch-state.mjs";
import {
  CLAIMS_ONLY_DELEGATION,
  DELEGATION_RECORDS,
  EXPECTED_STAYED,
  IMPLEMENTED_MARKERS,
  MOOT_APPROVALS,
  NO_RECIPIENT,
  SUPERSEDED,
  buildFixturesState,
  evaluateAll,
  toGhApiComments
} from "./fixtures/watcher-state-fixture";

const scriptPath = path.resolve("scripts/noos-watch-migrate-dismissed.mjs");
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "noos-watch-migrate-"));
const MIGRATED_AT = "2026-09-20T13:00:00.000Z";

afterAll(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

/** 每个用例一个独立沙箱：state 文件 + 锁路径（绝不碰主 checkout 的活状态）。 */
function sandbox(name: string) {
  const dir = path.join(workDir, name);
  fs.mkdirSync(dir, { recursive: true });
  const statePath = path.join(dir, "watcher-state.json");
  const commentsPath = path.join(dir, "comments.json");
  fs.writeFileSync(statePath, `${JSON.stringify(buildFixturesState(), null, 2)}\n`);
  fs.writeFileSync(commentsPath, `${JSON.stringify(toGhApiComments(), null, 2)}\n`);
  return { dir, statePath, commentsPath, lockPath: path.join(dir, "noos-watch.lock") };
}

function runCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("node", [scriptPath, ...args], { cwd: process.cwd(), encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("参数与输入解析", () => {
  it("默认 dry-run，两个开关都默认关", () => {
    expect(parseArgs([])).toEqual({ apply: false, confirmR4: false });
    expect(parseArgs(["--apply", "--confirm-r4"])).toMatchObject({ apply: true, confirmR4: true });
  });

  it("拒绝未知 flag 与缺值", () => {
    expect(() => parseArgs(["--wat"])).toThrow(/Invalid flag/);
    expect(() => parseArgs(["--state"])).toThrow(/Missing value/);
  });

  it("--lock-file 必须绝对路径", () => {
    expect(() => parseArgs(["--lock-file", "relative.lock"])).toThrow(/absolute/);
  });

  it("状态文件默认与锁同目录", () => {
    expect(defaultStatePath("/tmp/x/noos-watch.lock")).toBe("/tmp/x/watcher-state.json");
  });

  it("归一 gh api 的分页返回形状，并从 issue_url 取线程号", () => {
    const normalized = normalizeComments([
      [{ id: 1, body: "a", issue_url: "https://api.github.com/repos/o/r/issues/83" }],
      [{ id: 2, body: "b", issue_url: "https://api.github.com/repos/o/r/issues/70" }]
    ]);
    expect(normalized).toEqual([
      { id: 1, thread: 83, body: "a" },
      { id: 2, thread: 70, body: "b" }
    ]);
  });
});

describe("计划：只移动已作出结论的条目", () => {
  const state = buildFixturesState();
  const comments = normalizeComments(toGhApiComments());
  const plan = planMigration(state, comments);

  it("D1/D2/D3/D5 各自的条数", () => {
    const byRule = plan.decisions.reduce<Record<string, number>>((acc, d) => ({ ...acc, [d.rule]: (acc[d.rule] ?? 0) + 1 }), {});
    expect(byRule).toEqual({ D1: 12, D2: 2, D3: 2, D5: 4 });
  });

  it("12 条委派记录与 2 条 IMPLEMENTED: 都在计划里", () => {
    const ids = plan.decisions.map((d) => d.commentId);
    for (const record of [...DELEGATION_RECORDS, CLAIMS_ONLY_DELEGATION, ...IMPLEMENTED_MARKERS]) {
      expect(ids).toContain(String(record.id));
    }
  });

  it("被取代的 REQUEST_CHANGES 与已合并的合并交接都在计划里", () => {
    const ids = plan.decisions.map((d) => d.commentId);
    for (const comment of [...SUPERSEDED, ...MOOT_APPROVALS]) expect(ids).toContain(String(comment.id));
  });

  it("真未完成与真未分类一条都不在计划里，且全部留在 held 集合里", () => {
    const ids = plan.decisions.map((d) => d.commentId);
    for (const comment of EXPECTED_STAYED) expect(ids).not.toContain(String(comment.id));
    // NO_RECIPIENT 属 D4，未确认时进 indeterminate（「需 --confirm-r4」），不是 stayed。
    const held = [...plan.stayed.map((s) => s.commentId), ...plan.indeterminate.map((i) => i.commentId)].sort();
    expect(held).toEqual(EXPECTED_STAYED.map((c) => String(c.id)).sort());
  });

  it("D4 不在计划里，且被列为「需 --confirm-r4」的待确认项", () => {
    expect(plan.decisions.map((d) => d.commentId)).not.toContain(String(NO_RECIPIENT.id));
    expect(plan.indeterminate.map((i) => i.commentId)).toContain(String(NO_RECIPIENT.id));
  });

  it("--confirm-r4 后 D4 进计划，原因是条目上记录的原话", () => {
    const confirmed = planMigration(state, comments, { confirmR4: true });
    const decision = confirmed.decisions.find((d) => d.commentId === String(NO_RECIPIENT.id));
    expect(decision?.rule).toBe("D4");
    expect(decision?.reason).toContain("不存在独立实现会话可唤醒");
    expect(confirmed.indeterminate.map((i) => i.commentId)).not.toContain(String(NO_RECIPIENT.id));
  });

  it("UNROUTED 的欠账条目也进计划（活状态里真的出现过这条形态）", () => {
    // 活状态实例：5750908030 是 orchestrator 派的复审委派记录，action 字面写着
    // 「记录不路由：B.3 委派记录」，却被记成 state=UNROUTED。计划只从 CLAIMED 收
    // 的话它永远移不动，而它又会进欠账投影 ⇒ 每轮复报。
    const state = buildFixturesState();
    state.claims["5750908030"] = { state: "UNROUTED", action: "记录不路由：B.3 委派记录", claimedAt: "2026-09-20T16:03:51Z" };
    const comments = [
      ...normalizeComments(toGhApiComments()),
      { id: 5750908030, thread: 93, body: "rev: review PR#93 @ 4c598a5\n（orch: 派单, 委派: rev）", createdAt: null }
    ];
    const plan = planMigration(state, comments);
    expect(plan.decisions.find((d) => d.commentId === "5750908030")?.rule).toBe("D1");
    expect(plan.stayed.map((s) => s.commentId)).not.toContain("5750908030");
  });

  it("计划里每条 decision 都带非空 reason（可审计）", () => {
    for (const decision of plan.decisions) expect(decision.reason.length).toBeGreaterThan(0);
  });
});

describe("计划：缺评论正文时不猜", () => {
  it("无 --comments 时退回 pending 上记录的 marker，D1/D2 仍可判", () => {
    const plan = planMigration(buildFixturesState(), []);
    const byRule = plan.decisions.reduce<Record<string, number>>((acc, d) => ({ ...acc, [d.rule]: (acc[d.rule] ?? 0) + 1 }), {});
    expect(byRule).toMatchObject({ D1: 12, D2: 2 });
  });

  it("既无评论正文、又无 pending 记录的 claims 条目列为「无法判定」，不移动", () => {
    const state = buildFixturesState();
    // 一条只存在于 claims、pending 里没有对应记录的欠账条目。
    state.claims["5749999999"] = { state: "CLAIMED", action: "来源不明", claimedAt: "2026-09-20T12:24:11.993Z" };
    const plan = planMigration(state, []);
    expect(plan.decisions.map((d) => d.commentId)).not.toContain("5749999999");
    const item = plan.indeterminate.find((i) => i.commentId === "5749999999");
    expect(item?.why).toContain("--comments");
  });
});

describe("派生字段重算（避免状态自相矛盾）", () => {
  it("channel-blocked.pendingUndelivered 与 health.lastError 跟着终态走", () => {
    const state = buildFixturesState();
    const before = projectBriefing(state);
    const refreshed = refreshDerivedFields(applyDismissals(state, evaluateAll(state), MIGRATED_AT));
    const migrated = projectBriefing(refreshed);

    expect(before.undelivered.length).toBeGreaterThan(migrated.undelivered.length);
    expect(refreshed.pending.find((p) => p.type === "channel-blocked")?.pendingUndelivered).toBe(
      migrated.undelivered.length
    );
    expect(refreshed.health?.lastError).toContain(`${migrated.undelivered.length} 条已认领未投递`);
    expect(refreshed.health?.lastError).toContain(`${migrated.unclassified.length} 条未分类待人工分类`);
  });

  it("欠账清空时 lastError 置空，而不是留一句过期的告警", () => {
    const empty = { schemaVersion: 2, watermark: "2026-09-20T11:27:48Z", claims: {}, pending: [], health: { lastError: "旧告警" } };
    expect(refreshDerivedFields(empty).health?.lastError).toBeNull();
  });
});

describe("CLI 行为", () => {
  it("dry-run 只打印计划，绝不写文件", () => {
    const box = sandbox("dry-run");
    const before = fs.readFileSync(box.statePath, "utf8");
    const result = runCli(["--state", box.statePath, "--comments", box.commentsPath, "--lock-file", box.lockPath]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("DRY-RUN：未写入任何文件");
    expect(result.stdout).toContain("D1 delegation-record：12 条");
    expect(result.stdout).toContain("水位不变：");
    expect(fs.readFileSync(box.statePath, "utf8")).toBe(before);
    expect(fs.existsSync(box.lockPath)).toBe(false);
  });

  it("--apply 持锁落盘：终态生效、水位与条目数不变、派生字段重算", () => {
    const box = sandbox("apply");
    const before = JSON.parse(fs.readFileSync(box.statePath, "utf8"));
    const result = runCli(["--state", box.statePath, "--comments", box.commentsPath, "--lock-file", box.lockPath, "--apply"]);
    expect(result.status).toBe(0);

    const after = JSON.parse(fs.readFileSync(box.statePath, "utf8"));
    expect(after.watermark).toBe(before.watermark);
    expect(Object.keys(after.claims).sort()).toEqual(Object.keys(before.claims).sort());
    expect(after.pending.length).toBe(before.pending.length);
    expect(after.claims[String(DELEGATION_RECORDS[0].id)].state).toBe("DISMISSED");

    // 终态之后再投影：委派记录不再出现在未完成投递里。
    const projection = projectBriefing(after);
    const undeliveredIds = projection.undelivered.map((item) => item.commentId);
    for (const record of [...DELEGATION_RECORDS, CLAIMS_ONLY_DELEGATION, ...IMPLEMENTED_MARKERS]) {
      expect(undeliveredIds).not.toContain(String(record.id));
    }
    for (const comment of EXPECTED_STAYED) expect(undeliveredIds).toContain(String(comment.id));

    // 派生字段跟着走，不停留旧值。
    expect(after.pending.find((p: { type?: string }) => p.type === "channel-blocked").pendingUndelivered).toBe(
      projection.undelivered.length
    );
    expect(after.health.lastError).toContain(`${projection.undelivered.length} 条已认领未投递`);

    // 水位语义不变：仍有未投递项钉住水位。
    expect(after.watermark).toBe("2026-09-20T11:27:48Z");
    expect(projection.undelivered.length).toBeGreaterThan(0);

    // 锁用完即释，不留残锁。
    expect(fs.existsSync(box.lockPath)).toBe(false);
  });

  it("锁被占用时拒绝写入（fail closed）", () => {
    const box = sandbox("locked");
    const before = fs.readFileSync(box.statePath, "utf8");
    // 模拟另一个 holder：写入合法锁记录（holderToken + startedAt）。
    fs.writeFileSync(
      box.lockPath,
      `${JSON.stringify({ holderToken: "someone-else", startedAt: new Date().toISOString() })}\n`
    );
    const result = runCli(["--state", box.statePath, "--comments", box.commentsPath, "--lock-file", box.lockPath, "--apply"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("拒绝写入");
    expect(fs.readFileSync(box.statePath, "utf8")).toBe(before);
    // 不覆盖、不删除别人的锁。
    expect(JSON.parse(fs.readFileSync(box.lockPath, "utf8")).holderToken).toBe("someone-else");
  });

  it("状态文件缺失时报错退出，不静默重置", () => {
    const box = sandbox("missing");
    const result = runCli([
      "--state",
      path.join(box.dir, "nope.json"),
      "--comments",
      box.commentsPath,
      "--lock-file",
      box.lockPath
    ]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("不得静默重置");
  });

  it("状态文件不可解析时报错退出", () => {
    const box = sandbox("broken");
    fs.writeFileSync(box.statePath, "{broken");
    const result = runCli(["--state", box.statePath, "--comments", box.commentsPath, "--lock-file", box.lockPath]);
    expect(result.status).toBe(2);
  });
});

describe("计划渲染（人工确认时看到的东西）", () => {
  it("逐条列出判据、保留项、待确认项，并声明水位不变", () => {
    const state = buildFixturesState();
    const plan = planMigration(state, normalizeComments(toGhApiComments()));
    const rendered = renderPlan(state, plan).join("\n");
    expect(rendered).toContain("D1 delegation-record：12 条");
    expect(rendered).toContain("D2 known-marker-without-wakeup：2 条");
    expect(rendered).toContain("D3 superseded-by-later-marker：2 条");
    expect(rendered).toContain("D5 moot-already-integrated：4 条");
    expect(rendered).toContain(`水位不变：${state.watermark}`);
    expect(rendered).toContain(String(NO_RECIPIENT.id));
  });
});
