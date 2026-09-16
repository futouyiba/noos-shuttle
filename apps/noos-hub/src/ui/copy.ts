/**
 * Copy source for the Work-centered v0 surfaces (shell brand, Work Overview,
 * Work Detail, System). zh-CN matches the Hub document locale and is the
 * active default; en preserves the reviewed Figma copy. Fixture narrative
 * text lives here too, so one locale constant flips the whole surface.
 *
 * Shape parity between locales is enforced by typing zh-CN as `typeof en`.
 */

export type HubLocale = "zh-CN" | "en";

export const hubLocale: HubLocale = "zh-CN";

const en = {
  shell: {
    brandSubtitle: "Work continuity",
    versionNote: "v0.2 exploration"
  },
  sections: {
    work: { title: "Work", summary: "Pick up where NOOS needs you, or see what is moving." },
    workDetail: { title: "FCF · DSL R3", summary: "Review returned · 2 blocking issues require adjudication" },
    vault: { title: "Vault", summary: "收进来、放稳、交出去。" },
    harness: { title: "Harness Inspector", summary: "Advanced runtime diagnostic surface · fixture data." },
    system: { title: "System", summary: "Connections, configuration and diagnostics." },
    help: { label: "Help", title: "NOOS Hub Help", summary: "Handoff, Crystal, Vault, connectors and local sync boundaries at a glance." }
  },
  work: {
    fixtureNote: "UI fixture · Illustrative examples, not live work or canonical state · Read-only",
    conversations: {
      title: "Conversation to-dos",
      liveNote: "Live data · most recent active handoffs in the local Vault",
      focusAction: "View conversation →",
      wakeHint: "Source session: {app} · open that CC/Codex session and wake it with its trigger keyword",
      empty: "No active handoff objects right now."
    },
    needsAttention: "Needs your attention",
    inProgress: "In progress",
    recentlyChanged: "Recently changed",
    reviewLink: "Review →",
    runtimeLink: "Runtime →",
    attention: [
      {
        title: "FCF · DSL R3",
        tag: "Adjudicate",
        copy: "Review returned · 2 blocking issues",
        sub: "Needs your adjudication",
        meta: "Reviewer · 8m ago",
        href: "#work-detail",
        link: "reviewLink"
      },
      {
        title: "NOOS Harness Dogfood",
        tag: "Inspect",
        copy: "Operation remains UNCERTAIN",
        sub: "Reconciliation is still ambiguous",
        meta: "3m ago",
        href: "#harness",
        link: "runtimeLink"
      }
    ],
    progress: [
      { title: "FCF 0.3.4-b", sub: "Designer · revising configuration model", time: "12m ago", href: "#work-detail" },
      { title: "Resume Renderer", sub: "Codex · updating summary", time: "27m ago", href: "#work-detail" },
      { title: "NOOS Hub", sub: "Harness · runtime inspection idle", time: "41m ago", href: "#harness" }
    ],
    changed: [
      { title: "Blind Holdout R1", sub: "Governance · promoted", time: "Today 14:32", href: "#work-detail" },
      { title: "Terminology cleanup", sub: "Design · completed", time: "Today 11:08", href: "#work-detail" }
    ],
    supporting: {
      vault: "Vault",
      artifacts: "recent artifacts",
      system: "System",
      operational: "Operational",
      partial: "Partial",
      needsAttention: "Needs attention"
    },
    detail: {
      decisionTitle: "Needs your decision",
      decisionCount: "2 blocking",
      decisionBody: "Reviewer found two contract-level issues that block promotion.",
      decisionNote: "Resolve the findings below, then return the candidate to the design/review loop.",
      startAdjudication: "Start adjudication →",
      openReviewResult: "Open review result",
      fixtureTooltip: "Illustrative fixture; nothing is connected in v0",
      adjudicationNote: "Future UX intent only · v0 performs no backend mutation.",
      currentState: "Current state",
      status: "Status",
      statusValue: "Review returned",
      needsActionFrom: "Needs action from",
      you: "You",
      lastChange: "Last meaningful change",
      lastChangeValue: "Reviewer completed review · 8m ago",
      findingsTitle: "Review findings",
      findings: [
        {
          title: "01 · DecisionBasis identity can drift across recovery",
          text: "Equivalent runtime snapshots must resolve to one stable semantic basis."
        },
        {
          title: "02 · First-apply eligibility is not durable enough",
          text: "Authorized delta needs deterministic eligibility after crash/retry."
        }
      ],
      progressTitle: "Recent progress",
      progress: [
        { time: "8m", title: "Reviewer completed review", note: "2 blocking issues returned" },
        { time: "27m", title: "Designer submitted Candidate v3", note: "semantic identity tightened" },
        { time: "43m", title: "Integration requested narrow revision", note: "scope held to XCONTRACT-03" }
      ],
      artifactsTitle: "Artifacts",
      open: "Open →",
      artifacts: [
        { title: "Design Candidate v3", note: "exact revision · ready for adjudication" },
        { title: "Review Result #9", note: "Reviewer · completed 8m ago" }
      ],
      involvedTitle: "Who is involved",
      now: "Now",
      from: "From",
      next: "Next",
      involved: [
        { label: "Now", value: "You · adjudication" },
        { label: "From", value: "Reviewer" },
        { label: "Next", value: "Designer · narrow revision" }
      ],
      nextTitle: "What happens next",
      nextBody:
        "Accepted findings return to Designer for a narrow revision. Rejected findings remain recorded with rationale.",
      advanced: "Advanced",
      inspectRuntime: "Inspect runtime →",
      advancedNote:
        "Opens the existing Harness Inspector, an independent diagnostic fixture. It is not linked to this example work item."
    }
  },
  system: {
    summaryHealthy: "Everything needed for normal work is available.",
    summaryUnhealthy: "{n} connections need attention",
    summarySub: "System details stay out of the way unless they affect work.",
    operational: "Operational",
    partial: "Partial",
    needsAttention: "Needs attention",
    connections: "Connections",
    configuration: "Configuration",
    diagnostics: "Diagnostics",
    advanced: "Advanced",
    noosHome: ["NOOS Home", "Local root"],
    vaultStore: ["Vault", "Artifact storage"],
    runtimeState: ["Runtime", "Runtime state"],
    doctor: ["Doctor", "Check installation, bridges and connections when something looks wrong."],
    runDoctor: "Run Doctor →",
    refresh: ["Refresh state", "Re-read local NOOS state."],
    refreshLink: "Refresh →",
    sleepRecovery: ["Sleep recovery", "Sleep/resume recovery status"],
    localEndpoint: ["Local endpoint", ""],
    runtimeDiagnostics: ["Runtime diagnostics", "Low-level state and logs"],
    open: "Open →",
    manageAdapters: "Manage connectors",
    manageConfig: "Manage configuration & updates"
  }
};

const zhCN: typeof en = {
  shell: {
    brandSubtitle: "工作连续性",
    versionNote: "v0.2 探索"
  },
  sections: {
    work: { title: "Work", summary: "在需要你的地方接续，或看看什么正在推进。" },
    workDetail: { title: "FCF · DSL R3", summary: "评审返回 · 2 个阻塞问题等待裁定" },
    vault: { title: "Vault", summary: "收进来、放稳、交出去。" },
    harness: { title: "Harness Inspector", summary: "高级运行时诊断面 · fixture 数据。" },
    system: { title: "System", summary: "连接、配置与诊断。" },
    help: { label: "帮助", title: "NOOS Hub 帮助", summary: "快速理解 Handoff、Crystal、Vault、连接器和本机同步边界。" }
  },
  work: {
    fixtureNote: "UI fixture · 示例数据，不是正式工作项或 canonical 状态 · 只读",
    conversations: {
      title: "对话待办",
      liveNote: "真实数据 · 本地 Vault 最近活跃的 handoff 对象",
      focusAction: "查看对话 →",
      wakeHint: "来源会话：{app} · 请回到对应 CC/Codex 会话，用触发暗号唤醒",
      empty: "当前没有活跃 handoff 对象。"
    },
    needsAttention: "需要你注意",
    inProgress: "进行中",
    recentlyChanged: "最近变化",
    reviewLink: "查看 →",
    runtimeLink: "运行时 →",
    attention: [
      {
        title: "FCF · DSL R3",
        tag: "待裁定",
        copy: "评审返回 · 2 个阻塞问题",
        sub: "等待你的裁定",
        meta: "Reviewer · 8 分钟前",
        href: "#work-detail",
        link: "reviewLink"
      },
      {
        title: "NOOS Harness Dogfood",
        tag: "查看运行时",
        copy: "Operation 仍为 UNCERTAIN",
        sub: "Reconciliation 仍有歧义",
        meta: "3 分钟前",
        href: "#harness",
        link: "runtimeLink"
      }
    ],
    progress: [
      { title: "FCF 0.3.4-b", sub: "Designer · 修订配置模型", time: "12 分钟前", href: "#work-detail" },
      { title: "Resume Renderer", sub: "Codex · 更新摘要", time: "27 分钟前", href: "#work-detail" },
      { title: "NOOS Hub", sub: "Harness · 运行时检查空闲", time: "41 分钟前", href: "#harness" }
    ],
    changed: [
      { title: "Blind Holdout R1", sub: "治理 · 已晋升", time: "今天 14:32", href: "#work-detail" },
      { title: "Terminology cleanup", sub: "设计 · 已完成", time: "今天 11:08", href: "#work-detail" }
    ],
    supporting: {
      vault: "Vault",
      artifacts: "个近期产物",
      system: "System",
      operational: "运行正常",
      partial: "部分可用",
      needsAttention: "需要处理"
    },
    detail: {
      decisionTitle: "需要你决定",
      decisionCount: "2 个阻塞",
      decisionBody: "Reviewer 发现两个契约级问题，阻塞晋升。",
      decisionNote: "解决下列发现后，把候选送回设计 / 评审循环。",
      startAdjudication: "开始裁定 →",
      openReviewResult: "打开评审结果",
      fixtureTooltip: "示例 fixture；v0 未连接任何真实对象",
      adjudicationNote: "仅为未来 UX 意图 · v0 不执行任何 backend mutation。",
      currentState: "当前状态",
      status: "状态",
      statusValue: "评审已返回",
      needsActionFrom: "需要行动者",
      you: "你",
      lastChange: "最近一次有意义变化",
      lastChangeValue: "Reviewer 完成评审 · 8 分钟前",
      findingsTitle: "评审发现",
      findings: [
        {
          title: "01 · DecisionBasis 身份在恢复后可能漂移",
          text: "等价的运行时快照必须解析到同一个稳定的语义基础。"
        },
        {
          title: "02 · 首次适用资格不够持久",
          text: "已授权的 delta 在崩溃 / 重试后需要确定性的资格判定。"
        }
      ],
      progressTitle: "最近进展",
      progress: [
        { time: "8 分钟前", title: "Reviewer 完成评审", note: "2 个阻塞问题已返回" },
        { time: "27 分钟前", title: "Designer 提交 Candidate v3", note: "语义身份已收紧" },
        { time: "43 分钟前", title: "Integration 要求窄幅修订", note: "范围保持在 XCONTRACT-03" }
      ],
      artifactsTitle: "产物",
      open: "打开 →",
      artifacts: [
        { title: "Design Candidate v3", note: "精确修订 · 可进入裁定" },
        { title: "Review Result #9", note: "Reviewer · 8 分钟前完成" }
      ],
      involvedTitle: "参与者",
      now: "当前",
      from: "来自",
      next: "下一步",
      involved: [
        { label: "当前", value: "你 · 裁定" },
        { label: "来自", value: "Reviewer" },
        { label: "下一步", value: "Designer · 窄幅修订" }
      ],
      nextTitle: "接下来会发生什么",
      nextBody: "被接受的发现会回到 Designer 做窄幅修订；被拒绝的发现连同理由保留记录。",
      advanced: "高级",
      inspectRuntime: "查看运行时 →",
      advancedNote: "打开既有的 Harness Inspector 诊断 fixture；它与本示例工作项没有关联。"
    }
  },
  system: {
    summaryHealthy: "正常工作所需的一切均可用。",
    summaryUnhealthy: "{n} 个连接需要处理",
    summarySub: "系统细节保持安静，只在影响工作时出现。",
    operational: "运行正常",
    partial: "部分可用",
    needsAttention: "需要处理",
    connections: "连接",
    configuration: "配置",
    diagnostics: "诊断",
    advanced: "高级",
    noosHome: ["NOOS Home", "本地根目录"],
    vaultStore: ["Vault", "产物存储"],
    runtimeState: ["Runtime", "运行时状态"],
    doctor: ["Doctor", "当安装、桥接或连接看起来有问题时运行检查。"],
    runDoctor: "运行 Doctor →",
    refresh: ["刷新状态", "重新读取本机 NOOS 状态。"],
    refreshLink: "刷新 →",
    sleepRecovery: ["睡眠恢复", "休眠与唤醒恢复状态"],
    localEndpoint: ["本地端口", ""],
    runtimeDiagnostics: ["运行时诊断", "底层状态与日志"],
    open: "打开 →",
    manageAdapters: "管理连接器",
    manageConfig: "管理配置与更新"
  }
};

const messages: Record<HubLocale, typeof en> = { "zh-CN": zhCN, en };

export const copy = messages[hubLocale];

export const copyLocales = { en, "zh-CN": zhCN } as const;
