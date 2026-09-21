#!/usr/bin/env node
/**
 * 在**真实评论语料**上复算终态判据 D1–D5，并与一份**独立实现**对照。
 *
 * 为什么需要它：夹具是我造的，自造样本会把结论证成自己想要的形状。
 * 本脚本把生产评论直接喂进 `scripts/noos-watch-state.mjs`，再用**不 import
 * 该模块**的第二份实现（下面的 `independent()`，照 skill 步骤 3 的正文重写、
 * 自带解析器）独立算一遍，最后断言两边的 id 集合完全一致。任何一边改错都会红。
 *
 * 它是**只读**的：不写状态文件、不投递、不重发、不碰锁。
 *
 * 用法：
 *
 *   gh api "repos/futouyiba/noos-shuttle/issues/comments?per_page=100&page=1" > comments.json
 *   # 满页时续页并合并（或一次拉全）：gh api .../comments?per_page=100 --paginate --slurp > comments.json
 *   node scripts/noos-watch-corpus-check.mjs --comments comments.json
 *   node scripts/noos-watch-corpus-check.mjs --comments comments.json --json   # 机器可读
 *
 * 退出码：0 两份实现一致；1 不一致（说明有实现偏离 skill 正文）；2 参数/输入错误。
 */
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { classifyComment, evaluateDismissal, parseMarker } from "./noos-watch-state.mjs";

const USAGE = "Usage: noos-watch-corpus-check.mjs --comments <gh api 输出.json> [--json]";

export function parseArgs(argv) {
  const values = { json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--json") {
      values.json = true;
      continue;
    }
    if (token !== "--comments") throw new Error(`Invalid flag: ${token}`);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) throw new Error(`Missing value for ${token}`);
    values.comments = next;
    i += 1;
  }
  if (!values.comments) throw new Error("--comments is required");
  return values;
}

/**
 * `gh api .../issues/comments` 的原始 JSON（数组，或 `--slurp` 的分页数组的数组）
 * 归一成 `[{ id, thread, body, createdAt }]`。
 */
export function normalizeCorpus(raw) {
  const flat = (Array.isArray(raw) ? raw : []).flatMap((page) => (Array.isArray(page) ? page : [page]));
  return flat
    .filter((item) => item && item.id != null && typeof item.body === "string")
    .map((item) => {
      const match = String(item.issue_url ?? "").match(/\/(\d+)$/);
      return { id: item.id, thread: match ? Number(match[1]) : null, body: item.body, createdAt: item.created_at ?? null };
    });
}

/* ------------------------------------------------------------------ *
 * 独立实现：**不 import 本仓库的解析器与判据**，照 skill 步骤 3 正文重写。
 * 刻意用另一套写法（不同正则、不同取值顺序），以便两边同时错成一样。
 * ------------------------------------------------------------------ */

const INDEPENDENT_ROLE_RE = /^(?:ORCH|IMPL|REV|DES|INTG)[ \t]*[:：]/i;
const INDEPENDENT_HEADS = ["REVIEW:", "DESIGN:", "IMPLEMENTED:", "INTEGRATED:"];
const INDEPENDENT_NON_CONVERGING = new Set(["REQUEST_CHANGES", "REJECTED"]);

function independentFirstLine(body) {
  for (const line of String(body).split(/\r?\n/)) {
    if (line.trim() !== "") return line.trim();
  }
  return "";
}

function independentMarker(body) {
  const line = independentFirstLine(body);
  if (INDEPENDENT_ROLE_RE.test(line)) return { head: null, verdict: null, delegation: true };
  const head = INDEPENDENT_HEADS.find((h) => line.toUpperCase().startsWith(h));
  if (!head) return { head: null, verdict: null, delegation: false };
  const rest = line.slice(head.length);
  const at = rest.indexOf("@");
  const verdict = (at === -1 ? rest : rest.slice(0, at)).trim().replace(/\s+/g, " ").toUpperCase();
  return { head, verdict, delegation: false };
}

/** D1–D5 的独立写法。D4 需要条目上的结构化记录，语料上不适用，故不参与对照。 */
function independent(candidate, corpus) {
  const id = Number(candidate.commentId);
  const marker = independentMarker(candidate.body);
  const siblings = corpus.filter((c) => c.thread === candidate.thread && Number(c.id) !== id);

  if (marker.delegation) return { rule: "D1" };
  if (marker.head === "IMPLEMENTED:") return { rule: "D2" };

  if (marker.head && INDEPENDENT_NON_CONVERGING.has(marker.verdict)) {
    const superseding = siblings.some((c) => {
      const m = independentMarker(c.body);
      return Number(c.id) > id && m.head === marker.head && m.verdict === "APPROVE";
    });
    if (superseding) return { rule: "D3" };
  }

  if (marker.head && marker.verdict === "APPROVE") {
    const integrated = siblings.some((c) => Number(c.id) > id && independentMarker(c.body).head === "INTEGRATED:");
    if (integrated) return { rule: "D5" };
  }

  return null;
}

/** 跑两份实现并对照。返回 `{ concordant, rules, kinds, corpus, mismatches }`。 */
export function crossCheck(corpus) {
  const mine = {};
  const theirs = {};
  const mismatches = [];

  for (const comment of corpus) {
    const candidate = { commentId: comment.id, thread: comment.thread, body: comment.body };
    const a = evaluateDismissal(candidate, corpus);
    const b = independent(candidate, corpus);
    const aRule = a ? a.rule : null;
    const bRule = b ? b.rule : null;
    if (aRule) mine[aRule] = [...(mine[aRule] ?? []), comment.id];
    if (bRule) theirs[bRule] = [...(theirs[bRule] ?? []), comment.id];
    if (aRule !== bRule) mismatches.push({ id: comment.id, thread: comment.thread, module: aRule, independent: bRule });
  }

  const rules = {};
  for (const rule of ["D1", "D2", "D3", "D5"]) {
    const a = [...(mine[rule] ?? [])].sort((x, y) => x - y);
    const b = [...(theirs[rule] ?? [])].sort((x, y) => x - y);
    rules[rule] = { count: a.length, ids: a, identicalToIndependent: JSON.stringify(a) === JSON.stringify(b) };
  }

  const kinds = {};
  for (const comment of corpus) {
    const kind = classifyComment(comment.body).kind;
    kinds[kind] = (kinds[kind] ?? 0) + 1;
  }

  return { concordant: mismatches.length === 0, rules, kinds, corpus: corpus.length, mismatches };
}

export function render(result) {
  const lines = [];
  lines.push(`语料：${result.corpus} 条生产评论（D4 需条目上的结构化记录，不参与本对照）`);
  lines.push("");
  lines.push("判据   条数   与独立实现 id 集合一致");
  for (const [rule, data] of Object.entries(result.rules)) {
    lines.push(`${rule.padEnd(6)} ${String(data.count).padStart(4)}   ${data.identicalToIndependent ? "是" : "*** 否 ***"}`);
  }
  lines.push("");
  lines.push(`分类面：${JSON.stringify(result.kinds)}`);
  if (result.mismatches.length > 0) {
    lines.push("");
    lines.push(`*** 两份实现不一致 ${result.mismatches.length} 条 ***`);
    for (const m of result.mismatches) lines.push(`  ${m.id} thread=${m.thread} 模块=${m.module} 独立=${m.independent}`);
  }
  lines.push("");
  lines.push(result.concordant ? "结论：两份实现在全部判据上 id 集合完全一致。" : "结论：存在偏离，须查 skill 正文与实现的漂移。");
  return lines;
}

function main(argv) {
  const args = parseArgs(argv);
  const result = crossCheck(normalizeCorpus(JSON.parse(fs.readFileSync(args.comments, "utf8"))));
  process.stdout.write(args.json ? `${JSON.stringify(result, null, 2)}\n` : `${render(result).join("\n")}\n`);
  return result.concordant ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n${USAGE}\n`);
    process.exitCode = 2;
  }
}
