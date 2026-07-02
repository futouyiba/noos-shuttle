<!-- NOOS:THREAD:BEGIN -->
---
type: noos_thread
version: 0.1
handoff_revision: v1
source_app: claude-code
source_url: ""
target_agent: codex
status: active
created_at: 2026-07-01
title: NOOS Hub UX Refactor — 7→4 Navigation, Dashboard Homepage, Stacked Adapters
tags: [noos-hub, ux, dashboard, navigation, refactor, tauri, frontend]
preferred_path: .noos/handoffs/active/2026-07-01-hub-ux-refactor.md
---

# NOOS Hub UX Refactor — Dashboard, Navigation, and Readability Overhaul

## Current Status Addendum — 2026-07-02

This handoff is retained in `active/` for continuity, but its original merge
instructions are no longer current. The referenced UX refactor commits are now
on `main`, followed by additional Hub polish commits through
`9fc0a32 Exclude temporary Hub targets from release source package`.

Do not treat the separate `noos-shuttle-hub-ux-refactor` worktree or the
"Merge to main" item below as pending work unless a new handoff says so. The
remaining useful context in this file is historical design rationale and known
follow-up areas.

## Intent

Hand off the NOOS Hub UX refactoring work to the main agent so it can verify, merge,
polish, and eventually ship the desktop Hub with the improved interface.

## Context Summary

A systematic UX audit of NOOS Hub identified these core problems:

1. **7 navigation items** overwhelmed users with concepts they didn't understand yet.
2. **Information duplication** — the Overview page included adapter cards, and the
   Adapters page repeated them. Guide, Overview, and NOOS-intro all showed "next action"
   in different forms.
3. **The NOOS intro page** mixed marketing copy (Hero + orbit diagram + Story Grid)
   with operational status (snapshot), making neither purpose clear.
4. **The "Output" page** was an empty shell — real output lived in a bottom Log drawer
   that was global and unconnected to the page.
5. **Adapter cards** in a 3-column grid required scrolling past 7 tall cards to see
   all status; each card repeated boilerplate descriptions.

The solution: reduce navigation to 4 task-oriented items, create a true dashboard
homepage, and redesign adapters as scannable stacked rows.

## What Changed

All changes live in an independent Git worktree:

```
Path:   /Volumes/Mac DS - Data/SharedProjects/noos-shuttle-hub-ux-refactor
Branch: hub-ux-refactor (2 commits ahead of main)
Base:   524fb0d Improve NOOS Hub readability flow
```

### Commit 1: b78d396 — Core UX Refactor

**Navigation: 7 → 4 items**

| Before | After | Reason |
|--------|-------|--------|
| 工作台 (NOOS) | **首页** | New dashboard |
| 状态 (总览)   | *(merged)* | Into dashboard status cards |
| 修复 (Guide)  | *(merged)* | Into dashboard recommended action |
| 连接器        | **连接器** | Redesigned as stacked rows |
| Vault         | **Vault** | Unchanged (already well-designed) |
| 配置          | **设置** | Unchanged |
| 输出          | *(removed)* | Bottom Log drawer already serves this |

**New file: `apps/noos-hub/src/pages/dashboard.ts` (182 lines)**

The dashboard structure:

```
┌─ Hero ──────────────────────────────────────┐
│ Title: "一切就绪" or "N 项待处理"             │
│ Dynamic summary line from adapter stats      │
│ Stats: [就绪: N] [本机对象: N] [待导入: N]    │
│ Action: [运行 Doctor]                        │
├─ Status cards (4-column grid) ──────────────┤
│ 捕获 ✓  │  传输 ✓  │  消费 ⚠  │  工作区 ✓   │
│ Each card: pill + category + adapter list    │
│ with inline action buttons                   │
├─ Recommended action (conditional) ───────────┤
│ "!" or "→" icon + adapter name + summary     │
│ + primary action button                      │
├─ Recent files ──────────────────────────────┤
│ Handoff · N  │  Crystal · N                 │
│ File name + date + [Open] button             │
├─ Glossary (collapsible <details>) ───────────┤
│ 4 term cards: Handoff / Crystal /            │
│ Vault / 连接器 with plain-Chinese definitions│
└──────────────────────────────────────────────┘
```

Key design decisions in the dashboard:

- **Status cards use worst-status aggregation** — if any adapter in a category is
  "error", the card header shows red. This gives an at-a-glance health signal.
- **Recommended action picks the most critical adapter** — errors first, then missing,
  then needs_action, then partial. The code is in `chooseNextAction()` in `status.ts`.
- **Recent files are limited to 4 per group** — the full list is on the Vault page.
  File actions use `data-vault-group` / `data-vault-index` / `data-vault-file-action`
  attributes that `vault-file-actions.ts` resolves to `data-run` commands.
- **The glossary is collapsed by default** — to avoid overwhelming repeat users.

**Redesigned: `apps/noos-hub/src/pages/adapters.ts` (87 lines, was 66)**

Old: 7 cards in a 3-column grid, each 252px tall with checks list + action buttons.

New: Stacked horizontal rows grouped by kind (capture / transport / consumer / workspace):

```
捕获  · 就绪 · 未安装
┌────────────────────────────────────────────────────┐
│ [就绪] Browser Shuttle    ChatGPT 网页端生成…        │
│                          主要文件 · 配置  [启动浏览器] │
├────────────────────────────────────────────────────┤
│ 传输  · 就绪 · 就绪 · 未安装                          │
│ [就绪] NOOS Vault  本机存储中心  [打开]               │
│ [就绪] Git Sync    同步到 Git    [同步]               │
│ [未安装] Local Inbox  收件箱    [创建]                │
└────────────────────────────────────────────────────┘
```

Each row is ~70px vs the old 252px card — all 7 adapters now fit on one screen.

**Updated: `apps/noos-hub/src/main.ts` (569 lines, was 616)**

- `SectionId` type reduced from 7 union members to 4: `"home" | "vault" | "adapters" | "config"`
- Removed imports: `renderNoosIntro`, `renderOverview`, `renderGuide`
- Added import: `renderDashboard`
- `renderCurrentSection()` switch reduced from 7 cases to 4
- Removed `syncLogPage()` — log output now lives only in the bottom drawer
- Default section changed from `"noos"` to `"home"`

**Updated: `apps/noos-hub/src/pages/components.ts` (13 lines, was 55)**

Stripped to only `configRow()` — metric, storyPanel, modelRoadmap, and pipelineStep
were only used by the deleted pages.

**CSS: `apps/noos-hub/src/styles.css` (1349 lines, was 1480)**

Added ~435 lines of new styles (`.db-hero`, `.db-card`, `.db-recommend`, `.db-recent`,
`.db-about`, `.adapter-row`, `.check-tag`, etc.) and removed ~600 lines of orphaned
styles from the deleted pages.

Build output: CSS gzip 4.99 → 3.81 KB. JS unchanged at 11.71 KB.

**Test: `tests/noos-hub-renderers.test.ts`**

Updated the first test case from testing `renderOverview()` to testing `renderDashboard()`,
verifying the new dashboard contains `db-card` classes and no legacy `card-grid`.

### Commit 2: 1a3407e — Orphan cleanup

Deleted 3 orphaned page files:
- `pages/noos-intro.ts` (41 lines)
- `pages/overview.ts` (52 lines)
- `pages/guide.ts` (141 lines)

Removed 804 lines of orphaned CSS (`.intro-hero`, `.system-visual`, `.orbit`,
`.story-grid`, `.story-panel`, `.snapshot-grid`, `.guide-layout`, `.guide-step`,
`.model-roadmap`, `.pipeline`, `.pipe`, `.metric`, `.overview-hero`, `.next-action`,
`.card-grid`, `.card`, `.card-actions`, `.summary`, `.vault-layout`, `.vault-metrics`,
`.log-page-panel`, `.log-page-output`).

`configRow` is the sole remaining export from `components.ts`.

### Files NOT changed

These modules were imported by main.ts but their APIs didn't change:
- `mock.ts`, `types.ts`, `status.ts`, `ui/html.ts`, `update/render.ts`,
  `vault-file-actions.ts`

These page modules are still imported (by tests or as utility) but no longer routed:
- `pages/logs.ts` — renderLogs is tested but the page is not in the nav
- `pages/config.ts`, `pages/vault.ts` — still routed

## Key Decisions

1. **Why 4 nav items instead of 3 or 5?**
   Three felt too sparse (dashboard + vault + settings, where do adapters go?).
   Five would have kept the Guide which overlapped with dashboard's recommended action.
   Four maps cleanly to: see status → manage files → inspect connections → configure.

2. **Why delete the Guide page entirely instead of moving it?**
   The Guide's "next action" logic is now in `chooseNextAction()` → dashboard's
   recommended action. The model roadmap (v0/v1/v2) was informational only — no user
   action was tied to it — and it was moved to the collapsible glossary.

3. **Why keep `logs.ts` if it's not routed?**
   It's imported by `tests/noos-hub-renderers.test.ts`. Could be deleted if the test
   is rewritten, but keeping it costs nothing and the module is small.

4. **Dashboard status cards aggregate by adapter kind, not individual status.**
   A capture card with Browser Shuttle=error and nothing else is more actionable than
   7 individual status dots. Users need to know "capture is broken" before they need
   to know which specific adapter.

## Verification

```sh
# In the worktree:
cd /Volumes/Mac\ DS\ -\ Data/SharedProjects/noos-shuttle-hub-ux-refactor

# TypeScript
apps/noos-hub/node_modules/.bin/tsc --noEmit   # clean

# Vite build
apps/noos-hub/node_modules/.bin/vite build      # CSS: 17.2 KB, JS: 34.9 KB

# Full test suite
npx vitest run                                   # 63/63 passed, 12 files

# Extension build (root)
npx vite build                                   # clean

# Rust backend is unchanged — no compilation needed
```

## What's NOT done (next steps)

1. **Merge to main** — the code is verified but hasn't been tested in a real Tauri
   desktop window. Before merging, run `npm run hub:dev` and click through all 4 pages.

2. **Action feedback** — buttons still only show feedback in the bottom Log drawer.
   A toast/notification system would improve perceived responsiveness. Consider a
   `showToast(message, type)` function that renders a temporary pill in the topbar.

3. **Empty state for dashboard** — when all vault counts are zero, the dashboard
   shows "0 个本机对象" but could show a first-use wizard instead.

4. **Settings page reorganization** — the config page still has 7 flat config rows.
   Could be grouped into Version, Paths, Browser Extension sections.

5. **i18n** — all UI strings are hardcoded Chinese. The original codebase had English
   support but it was selectively applied. Full i18n is future work.

6. **E2E test** — a Playwright test that launches the Tauri app and clicks through the
   4 pages would be ideal, but requires a Tauri test harness.

## Related Files

```
apps/noos-hub/src/
├── main.ts                  — shell, routing, state, actions (569 lines)
├── pages/
│   ├── dashboard.ts         — NEW: homepage dashboard (182 lines)
│   ├── vault.ts             — vault management (unchanged, 194 lines)
│   ├── adapters.ts          — adapter health rows (87 lines)
│   ├── config.ts            — settings page (unchanged, 31 lines)
│   ├── components.ts        — shared configRow only (13 lines)
│   └── logs.ts              — log renderer (unrouted, 22 lines)
├── styles.css               — all styles (1349 lines)
├── types.ts                 — shared TypeScript types
├── status.ts                — adapter status logic + sleep recovery
├── mock.ts                  — browser-preview mock data
├── ui/html.ts               — escapeHtml, formatDisplayPath, formatModifiedAt
├── update/render.ts         — update banner + dialog HTML
└── vault-file-actions.ts    — vault file data-run resolver

tests/
└── noos-hub-renderers.test.ts  — dashboard + vault + logs tests
```
<!-- NOOS:THREAD:END -->
