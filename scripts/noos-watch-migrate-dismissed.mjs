#!/usr/bin/env node
/**
 * 一次性迁移：把「已作出结论：不投递」的欠账条目从 `CLAIMED` 移到终态 `DISMISSED`。
 *
 * 背景：`claims` 原本只有 `CLAIMED|ROUTED|UNROUTED`，没有一个是「了结」，
 * 于是「我判定不投递」与「我投递失败/被中断」在状态里长得一样，而 `CLAIMED`
 * 每轮都要报成「未完成投递」交人判断 —— 人工分诊成本每轮复现、无上限。
 * 本脚本按 `scripts/noos-watch-state.mjs` 的 D1–D5 判据把前者一次性移出欠账。
 *
 * **安全约定**（与 skill 的硬边界一致）：
 *
 * - **默认 dry-run**：不带 `--apply` 只打印计划，绝不写文件。
 * - 不投递、不重发、不碰水位。`watermark` 与 `stages` 原样保留；`claims`
 *   与 `pending` 都不删除条目（删掉会让欠账水位下的旧评论重读后重发）。
 * - `--apply` 必须持有单实例锁：由本脚本用 `scripts/noos-watch-lock.mjs`
 *   取得，且**取得锁之后重读并重算**，不使用锁外算出的计划。取不到锁即退出。
 * - D4（无匹配接收方）不接受隐式推断：要求条目上已有结构化记录
 *   （`recipient === null` + `recipientNote`）**且**显式传 `--confirm-r4`。
 *
 * 退出码：0 成功（含 dry-run），1 有阻塞（锁被占用 / 状态不可读），2 参数错误。
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { defaultLockPath, isEntryPoint, operate } from "./noos-watch-lock.mjs";
import {
  DISMISSAL_RULES,
  TERMINATABLE_CLAIM_STATES,
  applyDismissals,
  evaluateDismissal,
  evaluateNoRecipientDismissal,
  projectBriefing,
} from "./noos-watch-state.mjs";

const USAGE =
  "Usage: noos-watch-migrate-dismissed.mjs [--state <path>] [--comments <path>] [--lock-file <abs path>] [--confirm-r4] [--apply]";

/** 状态文件默认在主 checkout 下；`noos-watch-lock.mjs` 已用同一方法定位主 checkout。 */
export function defaultStatePath(lockPath) {
  return path.join(path.dirname(lockPath), "watcher-state.json");
}

export function parseArgs(argv) {
  const values = { apply: false, confirmR4: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--apply") {
      values.apply = true;
      continue;
    }
    if (token === "--confirm-r4") {
      values.confirmR4 = true;
      continue;
    }
    if (!["--state", "--comments", "--lock-file"].includes(token)) throw new Error(`Invalid flag: ${token}`);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) throw new Error(`Missing value for ${token}`);
    values[token.slice(2)] = next;
    i += 1;
  }
  if (values["lock-file"] && !path.isAbsolute(values["lock-file"])) throw new Error("--lock-file must be absolute");
  return values;
}

/**
 * `gh api repos/<owner>/<repo>/issues/comments` 的原始 JSON（数组，或分页数组的数组）。
 * 归一成 `[{ id, thread, body }]`，thread 取 `issue_url` 尾段的 issue/PR 号。
 */
export function normalizeComments(raw) {
  const flat = (Array.isArray(raw) ? raw : []).flatMap((page) => (Array.isArray(page) ? page : [page]));
  return flat
    .filter((item) => item && item.id != null && typeof item.body === "string")
    .map((item) => {
      const match = String(item.issue_url ?? "").match(/\/(\d+)$/);
      return { id: item.id, thread: match ? Number(match[1]) : null, body: item.body };
    });
}

/**
 * 枚举候选并按 D1–D5 评估。返回 `{ decisions, indeterminate, stayed }`。
 *
 * - `decisions` —— 建议移动的条目（含 `commentId` / `rule` / `reason` / `evidence`）
 * - `indeterminate` —— 无法判定的条目（缺评论正文、缺结构化原因）；**不移动**
 * - `stayed` —— 明确保留为 `CLAIMED` 的条目（可路由但送不出去、未分类权威信号）
 */
export function planMigration(state, comments, { confirmR4 = false } = {}) {
  const byId = new Map(comments.map((c) => [String(c.id), c]));
  const decisions = [];
  const indeterminate = [];
  const stayed = [];

  for (const [commentId, claim] of Object.entries(state.claims ?? {})) {
    // 欠账状态都收：`UNROUTED` 也进得去（活状态里出现过被记成 UNROUTED 的
    // 委派记录，只从 CLAIMED 收会让它永远移不动、每轮复报）。
    if (!TERMINATABLE_CLAIM_STATES.includes(claim.state)) continue;
    const comment = byId.get(commentId);
    const pendingEntry = (state.pending ?? []).find((item) => String(item.comment) === commentId);
    // 无评论正文时退回条目上记录的首行（pending 条目带 `marker`），使 D1/D2 仍可判。
    const body = comment?.body ?? pendingEntry?.marker ?? null;

    if (body == null) {
      indeterminate.push({ commentId, why: "缺评论正文；传 --comments <gh api 输出> 后重跑" });
      continue;
    }

    const thread = comment?.thread ?? pendingEntry?.issue ?? null;
    const decision =
      evaluateDismissal({ commentId, thread, body }, buildThreadIndex(comments, state)) ??
      evaluateNoRecipientDismissal(pendingEntry ?? null, { confirmedNoRecipient: confirmR4 });

    if (decision) decisions.push({ commentId, ...decision });
    else if (pendingEntry?.recipient === null && pendingEntry?.recipientNote && !confirmR4) {
      indeterminate.push({ commentId, why: "疑似 D4（无匹配接收方），需 --confirm-r4 显式确认" });
    } else stayed.push({ commentId, action: claim.action ?? pendingEntry?.action ?? null });
  }

  return { decisions, indeterminate, stayed };
}

/**
 * D3/D5 要在同线程里找「更晚的取代者」，而候选之外的同线程评论（已 ROUTED、
 * 或本轮没读到的）也可能承担取代角色。把 comments 缺省为「从 pending 的
 * `marker` 复原」的补充集合，使没有 `--comments` 时仍能得到同线程视图。
 */
function buildThreadIndex(comments, state) {
  if (comments.length > 0) return comments;
  return (state.pending ?? [])
    .filter((item) => item.comment != null && typeof item.marker === "string")
    .map((item) => ({ id: item.comment, thread: item.issue ?? null, body: item.marker }));
}

/** 迁移后重算两个**派生**字段，避免状态自相矛盾；其余字段一律不动。 */
export function refreshDerivedFields(state) {
  const projection = projectBriefing(state);
  const next = structuredClone(state);
  for (const item of next.pending ?? []) {
    if (item.type === "channel-blocked") item.pendingUndelivered = projection.undelivered.length;
  }
  if (next.health && typeof next.health === "object") {
    const delayed = projection.undelivered.length;
    const unclassified = projection.unclassified.length;
    next.health.lastError =
      delayed > 0 || unclassified > 0
        ? `欠账：${delayed} 条已认领未投递、${unclassified} 条未分类待人工分类；通道与分类状况见 pending`
        : null;
  }
  return next;
}

export function renderPlan(state, plan) {
  const lines = [];
  lines.push(`待判条目：${plan.decisions.length + plan.indeterminate.length + plan.stayed.length}`);
  lines.push(`建议移入终态 DISMISSED：${plan.decisions.length}`);
  for (const rule of Object.keys(DISMISSAL_RULES)) {
    const ofRule = plan.decisions.filter((d) => d.rule === rule);
    if (ofRule.length === 0) continue;
    lines.push(`  ${rule} ${DISMISSAL_RULES[rule]}：${ofRule.length} 条`);
    for (const decision of ofRule) lines.push(`    - ${decision.commentId} ${decision.reason}`);
  }
  lines.push(`保留 CLAIMED（真未完成 / 未分类）：${plan.stayed.length}`);
  for (const item of plan.stayed) lines.push(`    - ${item.commentId} ${item.action ?? ""}`.trimEnd());
  if (plan.indeterminate.length > 0) {
    lines.push(`无法判定、不移动：${plan.indeterminate.length}`);
    for (const item of plan.indeterminate) lines.push(`    - ${item.commentId} ${item.why}`);
  }
  lines.push(`水位不变：${state.watermark}`);
  return lines;
}

function readState(statePath) {
  if (!fs.existsSync(statePath)) throw new Error(`State file not found: ${statePath}（不得静默重置）`);
  const parsed = JSON.parse(fs.readFileSync(statePath, "utf8"));
  if (!parsed || typeof parsed !== "object" || typeof parsed.claims !== "object" || parsed.claims === null) {
    throw new Error(`State file has no claims map: ${statePath}`);
  }
  return parsed;
}

function loadComments(commentsPath) {
  if (!commentsPath) return [];
  return normalizeComments(JSON.parse(fs.readFileSync(commentsPath, "utf8")));
}

function main(argv) {
  const args = parseArgs(argv);
  const lockPath = args["lock-file"] ?? defaultLockPath();
  const statePath = args.state ?? defaultStatePath(lockPath);

  const state = readState(statePath);
  const comments = loadComments(args.comments);
  if (comments.length === 0) {
    process.stderr.write(
      "注意：未提供 --comments，只能从条目上记录的首行判定；claims 里没存 marker 的条目会列为「无法判定」。\n" +
        "      建议先 `gh api \"repos/futouyiba/noos-shuttle/issues/comments?per_page=100&page=N\"` 落盘再传。\n"
    );
  }

  if (!args.apply) {
    const plan = planMigration(state, comments, { confirmR4: args.confirmR4 });
    process.stdout.write(`${renderPlan(state, plan).join("\n")}\n\nDRY-RUN：未写入任何文件。加 --apply 且在持锁状态下才落盘。\n`);
    return 0;
  }

  const acquired = operate("acquire", lockPath, { sessionRef: "noos-watch-migrate-dismissed" });
  if (!acquired.ok) {
    process.stderr.write(`${JSON.stringify(acquired, null, 2)}\n`);
    process.stderr.write("锁被占用或锁状态不可用：拒绝写入。请先确认没有运行中的 watcher。\n");
    return 1;
  }

  try {
    // 取得锁之后重读重算：锁外算出的计划可能已过期。
    const locked = readState(statePath);
    const plan = planMigration(locked, comments, { confirmR4: args.confirmR4 });
    const migrated = refreshDerivedFields(
      applyDismissals(locked, plan.decisions, new Date().toISOString())
    );
    const temp = `${statePath}.migrate-tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(migrated, null, 2)}\n`);
    fs.renameSync(temp, statePath);
    process.stdout.write(`${renderPlan(locked, plan).join("\n")}\n\n`);
    process.stdout.write(`已写入：${statePath}\n`);
    process.stdout.write(`终态：${projectBriefing(migrated).dismissed.count} 条；未完成投递：${projectBriefing(migrated).undelivered.length} 条。\n`);
    return 0;
  } finally {
    const released = operate("release", lockPath, { token: acquired.holderToken });
    if (!released.ok) {
      process.stderr.write(`释放锁失败：${JSON.stringify(released)}\n`);
      process.exitCode = 1;
    }
  }
}

if (isEntryPoint(process.argv[1], import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n${USAGE}\n`);
    process.exitCode = 2;
  }
}
