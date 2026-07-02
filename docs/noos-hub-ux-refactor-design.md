# NOOS Hub UX 重构设计文档

> 版本: v0.1
> 日期: 2026-07-01
> 分支: hub-ux-refactor
> 作者: Claude Code + Codex 联合

---

## 1. 问题诊断

### 1.1 首次审计结论

对 NOOS Hub v0.1.4 的界面进行了系统性的「人因工程审计」。核心结论：

**界面站在「系统有什么模块」的角度组织信息，而不是站在「人来这里要完成什么任务」的角度。**

具体症状：

| 症状 | 根因 |
|------|------|
| 7 个导航项混用中英文 | 按系统模块命名，不是按用户任务命名 |
| 总览页包含 adapter 卡片，Adapters 页也包含相同卡片 | 信息架构去重失败 |
| NOOS 首页混搭营销 Hero + 运维 Snapshot | 一个页面承担了两种矛盾的目的 |
| 「输出」页是空壳，实际输出在底部抽屉 | 两个日志出口，用户不知道该看哪个 |
| 新用户打开 Hub 后不知道第一步该做什么 | 没有任务导向的引导 |

### 1.2 用户任务分析

NOOS Hub 的用户实际上只有三种使用场景：

1. **新用户（首次打开）**：这是什么？安装好了吗？我应该先做什么？
2. **日常用户（每天打开）**：状态正常吗？最近的 handoff 在哪？
3. **排障用户（出问题时打开）**：哪里坏了？怎么修？

当前 7 页导航对这三种场景都没有优化。

---

## 2. 设计原则

### 2.1 任务导航，不是概念导航

```
Before:  NOOS | 总览 | Guide | Adapters | Vault | 配置 | 输出
          ↑      ↑       ↑        ↑         ↑       ↑      ↑
        概念   概念    概念     概念      概念    概念   概念

After:   首页  |  Vault  |  连接器  |  设置
          ↑        ↑         ↑         ↑
      看看状态   管理文件   排查问题   改配置
```

导航项的标签就是用户来这个页面要干的事，不是系统里叫什么的模块名。

### 2.2 状态上浮，细节下沉

首页只显示最关键的信息：
- 几个连接器就绪/待处理（一眼）
- 当前最该做的操作（一个按钮）
- 最近的文件（快速找到）

详细信息和历史数据下沉到 Vault 和连接器页面。术语解释折叠在底部（老用户不会每次看到）。

### 2.3 动作优先，解释后置

每个区域先放可操作的按钮，解释文字作为辅助信息。对比：

```
❌ 旧版 Vault 面板:           ✅ 新版 Vault 面板:
"NOOS Vault                   "收进来"
 本机存储中心，包含 Wiki、      2 个待导入
 Handoff 和 Crystal。Git       先把 Browser Mirror 的回退文件导入本机 Vault…
 同步是单独动作…               [导入 Mirror] [打开目录]
 [打开 Vault]"
```

旧版把概念解释放前面，按钮放最后；新版把按钮和状态数字放前面，解释放在按钮下方。

### 2.4 术语首次出现必配解释

NOOS 只有 4 个用户需要理解的核心概念：

| 术语 | 一句话解释 | 类比 |
|------|-----------|------|
| Handoff | AI 对话整理出的任务交接单 | 给下游程序员的 ticket |
| Crystal | 对话中提炼的可复用结论 | 团队 Wiki 里的最佳实践 |
| Vault | 本机存储 Handoff/Crystal 的地方 | Finder 里的一个文件夹 |
| 连接器 | Hub 连接的外部工具 | 蓝牙配对的设备 |

首页底部有可折叠的术语卡片，新用户点开就能理解，老用户不需要看到。

---

## 3. 页面设计

### 3.1 首页仪表盘

**设计目标**：30 秒内回答三个问题——状态好吗？该做什么？文件在哪？

```
┌─ Hero ──────────────────────────────────────┐
│ "一切就绪" / "2 项待处理"                     │  ← 一眼判断系统健康度
│ 动态摘要: "5 个连接器就绪，3 个本机对象…"      │  ← 一句话了解全局
│ [就绪:5] [本机对象:3] [待导入:2]              │  ← 关键数字可视化
│ [运行 Doctor]                                │  ← 万能修复入口
├─ 状态卡片 (4 列) ────────────────────────────┤
│ 捕获 ✓  │  传输 ✓  │  消费 ⚠  │  工作区 ✓    │  ← 分类健康度
│ 每张卡片列出具体连接器 + 内联操作按钮           │
├─ 建议操作 (条件显示) ─────────────────────────┤
│ ! 浏览器插件未安装                            │  ← 最该做的事，大字
│ ChatGPT 网页插件… [启动 NOOS 浏览器]          │
├─ 最近文件 ───────────────────────────────────┤
│ Handoff · 3  │  Crystal · 2                 │  ← 快速访问
├─ NOOS 是什么？(可折叠) ───────────────────────┤
│ 4 张术语卡片                                  │  ← 新手引导，不占空间
└──────────────────────────────────────────────┘
```

**关键设计决策**：

1. **状态卡片使用最差状态聚合**：如果一个分类里有连接器是 error，整个卡片的 header 显示红色。用户不需要深入看每个连接器就能判断"捕获链路有问题"。
2. **建议操作优先级**：error > missing > needs_action > partial。代码在 `status.ts` 的 `chooseNextAction()`。
3. **最近文件限制 4 条**：完整列表在 Vault 页。首页的目的是快速定位「最近那份 handoff」，不是浏览全部。
4. **术语区默认折叠**：`<details>` 元素，老用户不受干扰。

### 3.2 Vault 页

**设计目标**：管理本机文件。保留原设计，因为已经是信息架构最好的页面。

保留的亮点：
- 推荐操作（动态：首次使用 → 建议导入 Mirror → 建议打开 Vault）
- 三张 flow 卡片（收进来 / 放稳 / 交出去）
- 首次使用空状态引导
- 最近文件双栏（Handoff + Crystal）

「收进来 → 放稳 → 交出去」的三步流程清晰地传达了 Vault 的作用，不需要额外的概念解释段落。

### 3.3 连接器页

**设计目标**：一眼看到所有连接器的健康状态，快速定位问题。

**旧版问题**：7 张卡片在 3 列网格里，每张 252px 高，用户需要滚动 2-3 屏才能看完。每张卡片重复"NOOS 本机存储中心…"之类的描述文字。

**新版方案**：纵向行

```
捕获  · 就绪 · 未安装
┌─────────────────────────────────────────────────────┐
│ [就绪] Browser Shuttle   ChatGPT 网页端生成、捕获…    │
│                          主要文件 · 配置  [启动浏览器] │
├─────────────────────────────────────────────────────┤
│ 传输  · 就绪 · 就绪 · 未安装                           │
│ [就绪] NOOS Vault    本机存储中心  [打开]              │
│ [就绪] Git Sync      同步到 Git    [同步]              │
│ [未安装] Local Inbox 收件箱       [创建]               │
└─────────────────────────────────────────────────────┘
```

每行约 70px 高（旧版 252px），所有 7 个连接器一屏可见。检查项改为内联标签（check-tag），操作按钮放在行末。删除了重复的概念描述文字。

### 3.4 设置页

**设计目标**：查看和修改配置。当前版本保持原样，后续可优化为Version / Paths / Browser Extension 三个分区。

---

## 4. 交互改进

### 4.1 操作反馈闭环

**问题**：点击按钮 → 没有任何视觉变化 → 用户不知道是否在工作 → 只能等底部 log 出文字（但 log 在长页面时不可见）。

**方案**：三层反馈

```
点击按钮
  │
  ├─ 即时: 按钮变灰 + 文字变 "⏳ …" + disabled
  │
  ├─ 完成: 底部绿色 toast "✅ 完成" (3 秒消失)
  │         + Log 面板自动滚入视图
  │
  └─ 失败: 底部红色 toast "❌ 操作失败"
            + Log 面板显示错误详情
```

**实现**：
- `runAction()` 接收 `sourceButton` 参数，设置 `disabled` + 改文字
- `showToast(message, kind)` 渲染固定定位的 toast，3000ms 自动消失
- `setLog()` 检测到新内容后 `scrollIntoView({ behavior: "smooth" })`

**为什么不用弹窗**：toast 不打断用户操作，不需要点击关闭。操作成功是预期结果，用短暂的视觉确认就够了。

### 4.2 重试机制

**问题**：`loadHealth()` 失败后只显示 `<div class="error">读取失败</div>`，死胡同。

**方案**：错误卡片内嵌 `[重试]` 按钮，调用 `loadHealth({ force: true })`。

**为什么不用全局重试**：错误是页面级的（只有 content 区挂了，sidebar 和 topbar 正常），全局刷新会丢掉导航状态。页面级重试保持上下文。

### 4.3 强制刷新

**问题**：`loadHealth({ force: true })` 的 `force` 参数被 `void options` 丢弃。5 秒缓存 TTL 意味着点击"刷新"可能实际上没刷新。

**方案**：
- `force: true` 跳过 `healthLoadInFlight` 防重 guard
- 加载文案从"读取…"变为"正在刷新…"
- Rust 后端的 `invalidate_hub_health_cache()` 在每次 hub action 后自动调用，所以前端 force refresh 后拿到的是新数据

---

## 5. 代码架构决策

### 5.1 为什么保留模板字符串而不是引入框架

NOOS Hub 是一个桌面控制面板，页面数量少（4 页），交互简单（点击按钮 → 执行命令 → 显示日志）。引入 React/Vue/Svelte 会带来：

- 构建体积至少 +30KB gzip
- 额外的依赖管理和版本升级负担
- 对 Tauri 生态的兼容性风险

模板字符串 + 纯函数渲染在这个规模下是合理的。当前 JS gzip 仅 12KB。

### 5.2 为什么拆分页面模块但不拆分组件

当前结构：

```
pages/
├── dashboard.ts    (182 行) ← 包含内部渲染函数
├── vault.ts        (194 行) ← 同上
├── adapters.ts     (87 行)
├── config.ts       (31 行)
├── components.ts   (13 行) ← 只有一个 configRow
└── logs.ts         (22 行) ← 不再路由，仅测试用
```

每个页面文件包含自己的内部渲染函数（如 `renderStatusCard`、`renderRecentFile`）。这是故意为之：

- 这些函数只被一个页面使用，提取出去增加间接层
- 跨页面复用的组件（`configRow`）放在 `components.ts`
- `status.ts` 只放纯数据逻辑，不放渲染

### 5.3 为什么 status.ts 不放渲染

`status.ts` 导出的是纯函数（`adapterStatusSummary`、`chooseNextAction`、`sleepRecoveryDisplay`），返回数据结构。渲染逻辑（HTML 模板字符串）放在 `pages/`。这样：

- 测试可以只测数据逻辑，不需要模拟 DOM
- 渲染函数可以独立修改 HTML 结构
- 状态逻辑可以在 Rust 后端复用（如果将来把 adapter health 计算移到 Rust）

---

## 6. 已知限制与后续方向

### 6.1 未实现

1. **页面切换动画**：当前是直接 `innerHTML` 替换。加入淡入淡出需要保持两份 DOM 或使用 CSS transition。当前取舍：先保证数据准确和操作反馈，动画是锦上添花。
2. **键盘快捷键**：`Cmd+1~4` 切换页面、`Cmd+R` 刷新。低优先级。
3. **i18n 完整覆盖**：当前 UI 字符串硬编码中文。原来的代码有英文 support 但不完整。全量 i18n 需要一个 key-based 方案。
4. **Toast 队列**：如果短时间内多次操作，后一个 toast 会覆盖前一个。当前用 `clearTimeout` 简单处理，生产环境可能需要队列。

### 6.2 后续优化方向

1. **设置页重组**：7 行扁平配置 → Version / Paths / Extension 三个区
2. **Dashboard 首次使用向导**：如果所有 Vault count 为 0，显示引导面板
3. **E2E 测试**：Playwright + Tauri test harness，验证完整用户流程
4. **操作历史**：Log 面板改为追加模式，保留最近 N 次操作记录

---

## 7. 验证结果

```
TypeScript:  clean (tsc --noEmit)
Vite build:  clean (CSS 17.2 KB, JS 35.9 KB gzip 12.1 KB)
Tests:       64/64 passed (12 files)
Extensions:  clean (root vite build, content.js + service-worker.js)
Rust:        unchanged (no backend changes needed)
```

---

## 附录 A：文件变动清单

```
新增:
  apps/noos-hub/src/pages/dashboard.ts  (182 行)

修改:
  apps/noos-hub/src/main.ts             (569 → 575 行)
  apps/noos-hub/src/pages/adapters.ts   (66 → 87 行)
  apps/noos-hub/src/pages/components.ts (55 → 13 行)
  apps/noos-hub/src/styles.css          (1480 → 1339 行)
  tests/noos-hub-renderers.test.ts      (更新 2 个测试, 新增 1 个)

删除:
  apps/noos-hub/src/pages/noos-intro.ts (41 行)
  apps/noos-hub/src/pages/overview.ts   (52 行)
  apps/noos-hub/src/pages/guide.ts      (141 行)
```

## 附录 B：删除的 CSS 类别（~600 行）

```
.summary-grid, .overview-hero, .overview-hero--ready, .overview-context,
.pipeline, .pipe, .pipe--ready, .pipe--missing, .pipe--error,
.intro-hero, .intro-copy, .intro-actions,
.system-visual, .core-node, .orbit, .orbit--chat, .orbit--handoff, .orbit--agent,
.story-grid, .story-panel, .story-panel--capture, .story-panel--transport, .story-panel--consume,
.snapshot-grid, .snapshot-note,
.guide-layout, .guide-main, .guide-steps, .guide-step, .guide-step--ready, .guide-step--partial, .guide-step--missing, .guide-step--error, .guide-step--needs_action,
.model-panel, .model-mode, .model-roadmap, .roadmap-item,
.metric, .next-action, .next-action--ready,
.card-grid, .card, .card header, .card h2, .card-actions, .summary,
.vault-metrics, .vault-layout,
.log-page-panel, .log-page-output
```
