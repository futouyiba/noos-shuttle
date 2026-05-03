import { invoke } from "@tauri-apps/api/core";
import "./styles.css";

type AdapterStatus = "ready" | "partial" | "missing" | "needs_action" | "error";
type AdapterKind = "capture" | "transport" | "consumer" | "workspace";

interface AdapterCheck {
  label: string;
  status: AdapterStatus;
  detail?: string;
}

interface AdapterAction {
  id: string;
  label: string;
  requires_user_action?: boolean;
}

interface AdapterHealth {
  id: string;
  name: string;
  kind: AdapterKind;
  status: AdapterStatus;
  summary: string;
  checks: AdapterCheck[];
  actions: AdapterAction[];
}

interface HubHealth {
  repo_root: string;
  noos_home: string;
  adapters: AdapterHealth[];
}

const statusLabels: Record<AdapterStatus, string> = {
  ready: "就绪",
  partial: "部分完成",
  missing: "未安装",
  needs_action: "需要操作",
  error: "错误"
};

const kindLabels: Record<AdapterKind, string> = {
  capture: "捕获",
  transport: "传输",
  consumer: "消费",
  workspace: "工作区"
};

const kindOrder: AdapterKind[] = ["capture", "transport", "workspace", "consumer"];

let currentHealth: HubHealth | null = null;
let activeSection = "overview";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Missing #app");
}
const appElement = app;

renderShell();
loadHealth();

function renderShell(): void {
  appElement.innerHTML = `
    <aside class="sidebar">
      <div class="brand">
        <div class="mark">NS</div>
        <div>
          <strong>NOOS Hub</strong>
          <span>Context Control Plane</span>
        </div>
      </div>
      <nav>
        ${navButton("overview", "总览")}
        ${navButton("adapters", "Adapters")}
        ${navButton("handoffs", "Handoffs")}
        ${navButton("config", "配置")}
        ${navButton("logs", "输出")}
      </nav>
      <div class="sidebar-note">
        <span></span>
        本机中枢只写入 NOOS 配置和已确认的 adapter 文件。
      </div>
    </aside>
    <main class="workspace">
      <header class="topbar">
        <div>
          <p class="eyebrow">NOOS Hub Desktop</p>
          <h1>AI 工具链上下文中枢</h1>
        </div>
        <div class="topbar-actions">
          <button type="button" data-action="refresh">刷新</button>
          <button type="button" data-action="doctor">运行 Doctor</button>
        </div>
      </header>
      <section id="content" class="content">
        <div class="loading">读取本机 NOOS 状态...</div>
      </section>
      <section class="log" id="log" hidden>
        <header>
          <strong>运行输出</strong>
          <button type="button" data-action="clear-log">清空</button>
        </header>
        <pre></pre>
      </section>
    </main>
  `;

  appElement.querySelectorAll<HTMLButtonElement>("[data-section]").forEach((button) => {
    button.addEventListener("click", () => {
      activeSection = button.dataset.section ?? "overview";
      renderCurrentSection();
    });
  });
  appElement.querySelector('[data-action="refresh"]')?.addEventListener("click", () => loadHealth());
  appElement.querySelector('[data-action="doctor"]')?.addEventListener("click", () => runAction("doctor"));
  appElement.querySelector('[data-action="clear-log"]')?.addEventListener("click", () => setLog(""));
}

function navButton(section: string, label: string): string {
  return `<button type="button" data-section="${section}" class="${activeSection === section ? "active" : ""}">${label}</button>`;
}

async function loadHealth(): Promise<void> {
  const content = appElement.querySelector<HTMLDivElement>("#content");
  if (!content) return;
  content.innerHTML = `<div class="loading">读取本机 NOOS 状态...</div>`;

  try {
    currentHealth = await getHubHealth();
    renderCurrentSection();
  } catch (error) {
    content.innerHTML = `<div class="error">读取失败：${escapeHtml(String(error))}</div>`;
  }
}

async function getHubHealth(): Promise<HubHealth> {
  try {
    return await invoke<HubHealth>("get_hub_health");
  } catch (error) {
    if (isTauriRuntime()) {
      throw error;
    }
    return mockHealth();
  }
}

function renderCurrentSection(): void {
  const content = appElement.querySelector<HTMLDivElement>("#content");
  if (!content || !currentHealth) return;
  appElement.querySelectorAll<HTMLButtonElement>("[data-section]").forEach((button) => {
    button.classList.toggle("active", button.dataset.section === activeSection);
  });

  if (activeSection === "adapters") {
    content.innerHTML = renderAdapters(currentHealth);
  } else if (activeSection === "handoffs") {
    content.innerHTML = renderHandoffs(currentHealth);
  } else if (activeSection === "config") {
    content.innerHTML = renderConfig(currentHealth);
  } else if (activeSection === "logs") {
    content.innerHTML = renderLogsIntro();
  } else {
    content.innerHTML = renderOverview(currentHealth);
  }

  content.querySelectorAll<HTMLButtonElement>("[data-run]").forEach((button) => {
    button.addEventListener("click", () => runAction(button.dataset.run ?? ""));
  });
}

function renderOverview(health: HubHealth): string {
  const ready = health.adapters.filter((adapter) => adapter.status === "ready").length;
  const needsAction = health.adapters.length - ready;
  const nextAction = chooseNextAction(health.adapters);

  return `
    <section class="summary-grid">
      ${metric("就绪", String(ready), "Ready adapters")}
      ${metric("待处理", String(needsAction), "Needs attention")}
      ${metric("NOOS Home", health.noos_home, "User hub")}
    </section>
    <section class="next-action ${nextAction ? "" : "next-action--ready"}">
      <div>
        <p>${nextAction ? "建议下一步" : "系统状态"}</p>
        <h2>${nextAction ? escapeHtml(nextAction.name) : "核心 adapter 已就绪"}</h2>
        <span>${nextAction ? escapeHtml(nextAction.summary) : "可以开始捕获和消费 NOOS handoff。"}</span>
      </div>
      ${
        nextAction?.actions[0]
          ? `<button type="button" data-run="${escapeHtml(nextAction.actions[0].id)}">${escapeHtml(
              nextAction.actions[0].label
            )}</button>`
          : `<button type="button" data-run="doctor">再次检查</button>`
      }
    </section>
    <section class="pipeline">
      ${pipelineStep("Capture", "ChatGPT / Claude / Gemini", adapterStatus(health, "capture"))}
      ${pipelineStep("Transport", "Clipboard / Inbox / GitHub", adapterStatus(health, "transport"))}
      ${pipelineStep("Resolve", "NOOS Resolver", "ready")}
      ${pipelineStep("Consume", "Codex / Claude Code", adapterStatus(health, "consumer"))}
    </section>
    ${renderAdapters(health)}
  `;
}

function renderAdapters(health: HubHealth): string {
  return `
    <section class="section-head">
      <div>
        <p class="eyebrow">Adapters</p>
        <h2>安装状态</h2>
      </div>
      <span>${escapeHtml(health.repo_root)}</span>
    </section>
    ${kindOrder
      .map((kind) => {
        const adapters = health.adapters.filter((adapter) => adapter.kind === kind);
        if (!adapters.length) return "";
        return `
          <section class="adapter-group">
            <h3>${kindLabels[kind]}</h3>
            <div class="card-grid">${adapters.map(renderAdapter).join("")}</div>
          </section>
        `;
      })
      .join("")}
  `;
}

function renderAdapter(adapter: AdapterHealth): string {
  return `
    <article class="card card--${adapter.status}">
      <header>
        <div>
          <p>${kindLabels[adapter.kind]}</p>
          <h2>${escapeHtml(adapter.name)}</h2>
        </div>
        <span class="pill pill--${adapter.status}">${statusLabels[adapter.status]}</span>
      </header>
      <p class="summary">${escapeHtml(adapter.summary)}</p>
      <ul>
        ${adapter.checks.map(renderCheck).join("")}
      </ul>
      <div class="card-actions">
        ${adapter.actions
          .map((action) => {
            const label = action.requires_user_action ? `${action.label} · 需确认` : action.label;
            return `<button type="button" data-run="${escapeHtml(action.id)}">${escapeHtml(label)}</button>`;
          })
          .join("")}
      </div>
    </article>
  `;
}

function renderCheck(check: AdapterCheck): string {
  return `
    <li>
      <span class="dot dot--${check.status}"></span>
      <div>
        <strong>${escapeHtml(check.label)}</strong>
        ${check.detail ? `<small>${escapeHtml(check.detail)}</small>` : ""}
      </div>
    </li>
  `;
}

function renderHandoffs(health: HubHealth): string {
  return `
    <section class="section-head">
      <div>
        <p class="eyebrow">Handoffs</p>
        <h2>交接稿入口</h2>
      </div>
      <button type="button" data-run="doctor">检查 Resolver</button>
    </section>
    <div class="handoff-layout">
      <article class="panel">
        <h3>Active</h3>
        <p>默认位置：<code>.noos/handoffs/active</code></p>
        <div class="empty-state">当前 UI 先展示入口状态；下一步会接入 resolver JSON，列出真实 handoff。</div>
      </article>
      <article class="panel">
        <h3>Local Inbox</h3>
        <p>用户级收件箱：<code>${escapeHtml(health.noos_home)}/inbox</code></p>
        <button type="button" data-run="create-inbox">创建 Inbox</button>
      </article>
      <article class="panel">
        <h3>GitHub Handoff Path</h3>
        <p>远程交付由 <code>.noos/project.json</code> 管理 repo/path，不在 NOOS config 中保存 token。</p>
        <button type="button" data-run="doctor">检查 GitHub</button>
      </article>
    </div>
  `;
}

function renderConfig(health: HubHealth): string {
  return `
    <section class="section-head">
      <div>
        <p class="eyebrow">Config</p>
        <h2>配置层</h2>
      </div>
    </section>
    <div class="config-list">
      ${configRow("User Hub", `${health.noos_home}/config.json`, "用户级 inbox、默认 agent、GitHub auth provider。")}
      ${configRow("Project", `${health.repo_root}/.noos/project.json`, "项目 handoff 路径和 GitHub repo handle。")}
      ${configRow("Local", `${health.repo_root}/.noos/local.json`, "本机私有配置，已被 git ignore。")}
    </div>
  `;
}

function renderLogsIntro(): string {
  return `
    <section class="section-head">
      <div>
        <p class="eyebrow">Logs</p>
        <h2>运行输出</h2>
      </div>
      <button type="button" data-run="doctor">运行 Doctor</button>
    </section>
    <article class="panel">
      <p>点击安装或检查动作后，输出会出现在底部抽屉。高风险写入会在动作按钮上标记为需确认。</p>
    </article>
  `;
}

function metric(label: string, value: string, caption: string): string {
  return `
    <article class="metric">
      <span>${escapeHtml(value)}</span>
      <strong>${escapeHtml(label)}</strong>
      <small>${escapeHtml(caption)}</small>
    </article>
  `;
}

function pipelineStep(title: string, detail: string, status: AdapterStatus): string {
  return `
    <article class="pipe pipe--${status}">
      <span></span>
      <strong>${escapeHtml(title)}</strong>
      <small>${escapeHtml(detail)}</small>
    </article>
  `;
}

function configRow(name: string, path: string, detail: string): string {
  return `
    <article class="config-row">
      <div>
        <strong>${escapeHtml(name)}</strong>
        <span>${escapeHtml(detail)}</span>
      </div>
      <code>${escapeHtml(path)}</code>
    </article>
  `;
}

function adapterStatus(health: HubHealth, kind: AdapterKind): AdapterStatus {
  const adapters = health.adapters.filter((adapter) => adapter.kind === kind);
  if (!adapters.length) return "missing";
  if (adapters.every((adapter) => adapter.status === "ready")) return "ready";
  if (adapters.some((adapter) => adapter.status === "error")) return "error";
  if (adapters.some((adapter) => adapter.status === "needs_action")) return "needs_action";
  return "partial";
}

function chooseNextAction(adapters: AdapterHealth[]): AdapterHealth | undefined {
  return adapters.find((adapter) => adapter.status === "missing" || adapter.status === "needs_action") ??
    adapters.find((adapter) => adapter.status === "partial");
}

async function runAction(action: string): Promise<void> {
  if (!action) return;
  setLog(`运行：${action}\n`);
  try {
    const output = await invoke<string>("run_hub_action", { action });
    setLog(output || "完成。");
    await loadHealth();
  } catch (error) {
    if (!isTauriRuntime()) {
      setLog(`浏览器预览模式不会执行本机动作：${action}`);
      return;
    }
    setLog(`失败：${String(error)}`);
  }
}

function setLog(value: string): void {
  const panel = appElement.querySelector<HTMLElement>("#log");
  const pre = panel?.querySelector("pre");
  if (!panel || !pre) return;
  pre.textContent = value;
  panel.hidden = value.length === 0;
}

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

function mockHealth(): HubHealth {
  return {
    repo_root: "/Users/you/Projects/noos-shuttle",
    noos_home: "/Users/you/.noos",
    adapters: [
      mockAdapter("browser-extension", "Browser Shuttle", "capture", "needs_action", "ChatGPT 网页端生成、捕获和交付 handoff 的扩展。"),
      mockAdapter("local-inbox", "Local Inbox", "transport", "missing", "本地 handoff 收件箱，用于 download 和跨工具交换。"),
      mockAdapter("github", "GitHub", "transport", "ready", "通过 gh 登录状态和 repo handle 支持远程 handoff 交付。"),
      mockAdapter("workspace", "Workspace Kit", "workspace", "ready", "项目级 .noos 工作区和 agent 入口文件。"),
      mockAdapter("codex", "Codex", "consumer", "partial", "Codex 消费 NOOS handoff 的用户级 skill。"),
      mockAdapter("claude-code", "Claude Code", "consumer", "missing", "Claude Code 消费 NOOS handoff 的用户级和项目级 skill。")
    ]
  };
}

function mockAdapter(
  id: string,
  name: string,
  kind: AdapterKind,
  status: AdapterStatus,
  summary: string
): AdapterHealth {
  return {
    id,
    name,
    kind,
    status,
    summary,
    checks: [
      { label: "主要文件", status, detail: status === "ready" ? "detected" : "needs setup" },
      { label: "配置", status: status === "missing" ? "missing" : "ready", detail: "NOOS config" }
    ],
    actions: [{ id: id === "browser-extension" ? "browser-dev-profile" : "doctor", label: "处理", requires_user_action: status === "needs_action" }]
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };
    return entities[character];
  });
}
