import { describe, expect, it } from "vitest";
import { crossCheck, normalizeCorpus, parseArgs, render } from "../scripts/noos-watch-corpus-check.mjs";

/**
 * checker 本身也要被测：一个坏掉的对照实现会给出**空洞的一致**
 * （两边都算不出东西 → 「完全一致」），所以这里显式断言各判据的**非零**条数。
 */

/** 合成语料：形状照抄生产（`<标记> @ <ref>` 首行 + provenance 行）。 */
function corpus(): ReturnType<typeof normalizeCorpus> {
  const items = [
    // D1：B.3 委派记录
    { id: 100, thread: 7, body: "rev: review PR#7 @ aaa1111\n（orch: 派单, 委派: rev）" },
    { id: 101, thread: 7, body: "rev: review PR#7 @ aaa1111\n（orch: 派单, 委派: rev）" },
    // D2：已知标记无唤醒动作（含取值变体，D2 只认 head）
    { id: 102, thread: 8, body: "IMPLEMENTED: PR#9" },
    { id: 103, thread: 9, body: "IMPLEMENTED: PR#10（DRAFT）" },
    // D3：被同线程更晚的 APPROVE 取代
    { id: 110, thread: 20, body: "REVIEW: REQUEST_CHANGES @ bbb2222\n（rev: 直评, 委派: orch）" },
    { id: 111, thread: 20, body: "REVIEW: APPROVE @ ccc3333\n（rev: 直评, 委派: orch）" },
    // D5：更晚的 INTEGRATED（生产形态：摘要 @ merge-sha，无 PR 引用）
    { id: 120, thread: 30, body: "REVIEW: APPROVE @ ddd4444\n（rev: 直评, 委派: orch）" },
    { id: 121, thread: 30, body: "INTEGRATED: 纯文档，无需部署；合并后 main 验证 typecheck 干净 @ eee5555\n（intg: 直评, 委派: 人）" },
    // 都不命中：APPROVE 之后没有 INTEGRATED（真未完成）
    { id: 130, thread: 40, body: "REVIEW: APPROVE @ fff6666\n（rev: 直评, 委派: orch）" },
    // 都不命中：枚举外取值（护栏）
    { id: 140, thread: 50, body: "REVIEW: APPROVE WITH FINDINGS @ 999aaaa\n（rev: 直评, 委派: orch）" },
    // 都不命中：自由文本权威信号
    { id: 141, thread: 51, body: "验收复查（integrator，spec §4.2）：PR #51 已合并（abc1234）" }
  ];
  return items.map((item) => ({ ...item, createdAt: null }));
}

describe("cli 参数与输入归一", () => {
  it("要求 --comments，拒绝未知 flag", () => {
    expect(() => parseArgs([])).toThrow(/--comments is required/);
    expect(() => parseArgs(["--wat"])).toThrow(/Invalid flag/);
    expect(parseArgs(["--comments", "x.json", "--json"])).toMatchObject({ comments: "x.json", json: true });
  });

  it("同时吃 gh api 的裸数组与 --slurp 的分页数组", () => {
    const one = { id: 1, body: "a", issue_url: "https://api.github.com/repos/o/r/issues/7" };
    expect(normalizeCorpus([one])).toEqual([{ id: 1, thread: 7, body: "a", createdAt: null }]);
    expect(normalizeCorpus([[one], [one]])).toHaveLength(2);
  });
});

describe("两份实现在合成语料上对照", () => {
  const result = crossCheck(corpus());

  it("完全一致", () => {
    expect(result.mismatches).toEqual([]);
    expect(result.concordant).toBe(true);
  });

  it("各判据条数非零且与独立实现一致（防空洞的一致）", () => {
    expect(result.rules.D1.count).toBe(2);
    expect(result.rules.D2.count).toBe(2);
    expect(result.rules.D3.count).toBe(1);
    expect(result.rules.D5.count).toBe(1);
    for (const data of Object.values(result.rules)) expect(data.identicalToIndependent).toBe(true);
  });

  it("护栏项两边都不命中", () => {
    const fired = Object.values(result.rules).flatMap((d) => d.ids);
    for (const id of [130, 140, 141]) expect(fired).not.toContain(id);
  });

  it("渲染里带得出结论与分类面", () => {
    const lines = render(result).join("\n");
    expect(lines).toContain("id 集合完全一致");
    expect(lines).toContain("delegation-record");
  });
});

describe("对照实现坏掉时不得报「一致」", () => {
  it("独立实现若整体失效，条数不会两边同时为零", () => {
    // 语料里必须有东西可判，否则「一致」是空洞的。
    const result = crossCheck(corpus());
    const total = Object.values(result.rules).reduce((sum, d) => sum + d.count, 0);
    expect(total).toBeGreaterThan(0);
    expect(result.rules.D1.ids).toEqual([100, 101]);
  });
});
