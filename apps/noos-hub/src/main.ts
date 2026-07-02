import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import noosLogoUrl from "./assets/noos-logo.png";
import { mockHealth, mockSleepRecoveryStatus } from "./mock";
import { renderAdapters } from "./pages/adapters";
import { renderConfig, type ConfigData } from "./pages/config";
import { renderDashboard } from "./pages/dashboard";
import { renderHelp } from "./pages/help";
import { renderVault } from "./pages/vault";
import { createVaultBrowserState, renderVaultBrowser, type VaultBrowserState } from "./pages/vault-browser";
import { sleepRecoveryDisplay } from "./status";
import "./styles.css";
import type { HubHealth, SleepRecoveryStatus, UpdateCheckMode, UpdateStatus } from "./types";
import { renderUpdateBannerHtml, renderUpdateDialogHtml } from "./update/render";
import { escapeHtml } from "./ui/html";
import { setVaultFileActionDataRuns } from "./vault-file-actions";

type SectionId = "home" | "vault" | "adapters" | "config" | "help";

const silentUpdateCheckDelayMs = 2500;
interface SectionMeta {
  id: SectionId;
  label: string;
  eyebrow: string;
  title: string;
  summary: string;
}

const sectionMeta: Record<SectionId, SectionMeta> = {
  home: {
    id: "home",
    label: "首页",
    eyebrow: "NOOS Hub",
    title: "本机上下文中枢",
    summary: "连接器状态、建议操作和最近文件一览。"
  },
  vault: {
    id: "vault",
    label: "Vault",
    eyebrow: "NOOS Vault",
    title: "本机产物与交接",
    summary: "管理 Handoff、Crystal、Browser Mirror 和 Agent Projection。"
  },
  adapters: {
    id: "adapters",
    label: "连接器",
    eyebrow: "Adapters",
    title: "连接器安装状态",
    summary: "检查浏览器、Git、工作区和下游 agent 的可用性。"
  },
  config: {
    id: "config",
    label: "设置",
    eyebrow: "Settings",
    title: "本机配置与更新",
    summary: "查看路径、更新入口和内置 Shuttle 扩展。"
  },
  help: {
    id: "help",
    label: "帮助",
    eyebrow: "Help",
    title: "NOOS Hub 帮助",
    summary: "快速理解 Handoff、Crystal、Vault、连接器和本机同步边界。"
  }
};

const navItems: SectionMeta[] = [
  sectionMeta.home,
  sectionMeta.vault,
  sectionMeta.adapters,
  sectionMeta.config
];

const sectionItems = Object.values(sectionMeta);

let currentHealth: HubHealth | null = null;
let currentRecoveryStatus: SleepRecoveryStatus | null = null;
let currentLog = "";
let activeSection: SectionId = parseSectionId(window.location.hash.slice(1), "home");
let healthLoadInFlight = false;
let actionInFlight = false;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
let vaultBrowserState: VaultBrowserState = createVaultBrowserState();
let currentConfig: ConfigData | null = null;
let updateStatus: UpdateStatus = "idle";
let updateDialogVisible = false;
let updateBannerVisible = false;
let updateCheckInFlight = false;
let updateMessage = "";
let updateDownloadedBytes = 0;
let updateTotalBytes: number | undefined;
let availableUpdate: Update | null = null;
let dismissedUpdateVersion: string | null = null;

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Missing #app");
}
const appElement = app;

renderShell();
window.addEventListener("popstate", restoreSectionFromLocation);
window.addEventListener("hashchange", restoreSectionFromLocation);
void installSleepRecoveryListeners();
void installUpdateMenuListeners();
void loadHealth();
void loadSleepRecoveryStatus();
scheduleSilentUpdateCheck();

function renderShell(): void {
  const shellItem = sectionMeta[activeSection] ?? sectionMeta.home;

  appElement.innerHTML = `
    <aside class="sidebar">
      <div class="brand">
        <img class="mark" src="${noosLogoUrl}" alt="" aria-hidden="true" />
        <div>
          <strong>NOOS Hub</strong>
          <span>Context Control Plane · FuTou 2026</span>
        </div>
      </div>
      <nav>
        ${navItems.map((item) => navButton(item.id, item.label)).join("")}
      </nav>
      <div class="sidebar-note">
        <span></span>
        本机中枢只写入 NOOS 配置和已确认的连接器文件。FuTou 2026。
      </div>
    </aside>
    <main class="workspace">
      <header class="topbar">
        <div>
          <p class="eyebrow" id="section-eyebrow">${shellItem.eyebrow}</p>
          <h1 id="section-title">${shellItem.title}</h1>
          <p class="topbar-summary" id="section-summary">${shellItem.summary}</p>
        </div>
        <div class="topbar-actions">
          <span class="recovery-pill" data-recovery-state="running">睡眠恢复：检查中</span>
          ${navButton("help", "帮助", "topbar-help")}
          <button type="button" data-action="refresh">刷新</button>
          <button type="button" data-action="doctor">运行 Doctor</button>
        </div>
      </header>
      <section class="update-banner" id="update-banner" hidden></section>
      <section id="content" class="content">
        <div class="loading">读取本机 NOOS 状态…</div>
      </section>
      <section id="update-dialog-root"></section>
      <section id="toast" class="toast" hidden></section>
      <section class="log" id="log" hidden>
        <header>
          <strong>运行输出</strong>
          <button type="button" data-action="clear-log">清空</button>
        </header>
        <pre></pre>
      </section>
    </main>
  `;

  bindSectionButtons(appElement);
  appElement.querySelector('[data-action="refresh"]')?.addEventListener("click", () => {
    void loadHealth({ force: true });
  });
  appElement.querySelector('[data-action="doctor"]')?.addEventListener("click", (event) => {
    void runAction("doctor", event.currentTarget as HTMLButtonElement);
  });
  appElement.querySelector('[data-action="clear-log"]')?.addEventListener("click", () => setLog(""));
}

function navButton(section: SectionId, label: string, className = ""): string {
  const active = activeSection === section;
  const classes = [className, active ? "active" : ""].filter(Boolean).join(" ");
  return `<button type="button" data-section="${section}" class="${classes}" ${active ? 'aria-current="page"' : ""}>${label}</button>`;
}

function bindSectionButtons(root: ParentNode): void {
  root.querySelectorAll<HTMLButtonElement>("[data-section]").forEach((button) => {
    button.addEventListener("click", () => {
      setActiveSection(parseSectionId(button.dataset.section, activeSection));
    });
  });
}

function parseSectionId(value: string | undefined, fallback: SectionId = "home"): SectionId {
  return sectionItems.some((item) => item.id === value) ? (value as SectionId) : fallback;
}

function setActiveSection(section: SectionId, options: { updateHistory?: boolean } = {}): void {
  if (activeSection === section) {
    return;
  }

  activeSection = section;
  if (options.updateHistory !== false) {
    window.history.pushState(null, "", `#${section}`);
  }
  renderCurrentSection();
}

function restoreSectionFromLocation(): void {
  const nextSection = parseSectionId(window.location.hash.slice(1), "home");
  if (nextSection !== activeSection) {
    setActiveSection(nextSection, { updateHistory: false });
  }
}

async function loadHealth(options: { force?: boolean } = {}): Promise<void> {
  if (healthLoadInFlight && !options.force) {
    return;
  }
  healthLoadInFlight = true;
  const content = appElement.querySelector<HTMLDivElement>("#content");
  if (!content) {
    healthLoadInFlight = false;
    return;
  }

  if (!options.force && currentHealth) {
    content.innerHTML = `<div class="loading">读取本机 NOOS 状态…</div>`;
  } else {
    content.innerHTML = `<div class="loading">${options.force ? "正在刷新…" : "读取本机 NOOS 状态…"}</div>`;
  }

  try {
    currentHealth = await getHubHealth();
    renderCurrentSection();
  } catch (error) {
    content.innerHTML = `<div class="error">读取失败：${escapeHtml(String(error))}<button type="button" data-action="retry-load">重试</button></div>`;
    bindRetryButton(content);
  } finally {
    healthLoadInFlight = false;
  }
}

function bindRetryButton(root: ParentNode): void {
  root.querySelector<HTMLButtonElement>('[data-action="retry-load"]')?.addEventListener("click", () => {
    void loadHealth({ force: true });
  });
}

async function loadVaultBrowse(): Promise<void> {
  try {
    const payload = await invoke<{
      ok: boolean;
      folder: string;
      folders: VaultBrowserState["folders"];
      objects: VaultBrowserState["objects"];
    }>("browse_vault", {
      folder: vaultBrowserState.folder,
      query: vaultBrowserState.query || null
    });

    vaultBrowserState.folders = payload.folders || [];
    vaultBrowserState.objects = payload.objects || [];
    vaultBrowserState.expandedKey = null;
    vaultBrowserState.expandedContent = null;
  } catch {
    if (!isTauriRuntime()) {
      vaultBrowserState = mockVaultBrowse(vaultBrowserState.folder, vaultBrowserState.query);
    }
  }

  renderVaultBrowserSection();
}

async function expandVaultObject(key: string): Promise<void> {
  if (vaultBrowserState.expandedKey === key) {
    vaultBrowserState.expandedKey = null;
    vaultBrowserState.expandedContent = null;
    renderVaultBrowserSection();
    return;
  }

  vaultBrowserState.expandedKey = key;
  vaultBrowserState.expandedContent = null;
  renderVaultBrowserSection();

  try {
    const payload = await invoke<{
      ok: boolean;
      object: { content: string };
    }>("get_vault_object", { key });

    vaultBrowserState.expandedContent = payload.object?.content ?? "";
  } catch {
    vaultBrowserState.expandedContent = "(无法加载文件内容)";
  }

  if (vaultBrowserState.expandedKey === key) {
    renderVaultBrowserSection();
  }
}

function renderVaultBrowserSection(): void {
  const container = document.querySelector<HTMLElement>("#vault-browser");
  if (!container || !currentHealth) return;

  container.innerHTML = renderVaultBrowser(vaultBrowserState, currentHealth.noos_home);
  bindVaultBrowserEvents(container);
  setVaultFileActionDataRuns(container, [
    { id: "handoffs", files: vaultBrowserState.objects.filter((o) => o.object_type === "handoff") },
    { id: "crystals", files: vaultBrowserState.objects.filter((o) => o.object_type === "crystal") },
    { id: "results", files: vaultBrowserState.objects.filter((o) => o.object_type === "result") }
  ]);
  container.querySelectorAll<HTMLButtonElement>("[data-run]").forEach((button) => {
    button.addEventListener("click", (event) => {
      void runAction(button.dataset.run ?? "", event.currentTarget as HTMLButtonElement);
    });
  });
}

function bindVaultBrowserEvents(root: ParentNode): void {
  root.querySelectorAll<HTMLButtonElement>("[data-vault-folder]").forEach((button) => {
    button.addEventListener("click", () => {
      vaultBrowserState.folder = button.dataset.vaultFolder ?? "latest";
      vaultBrowserState.query = "";
      void loadVaultBrowse();
    });
  });

  const searchInput = root.querySelector<HTMLInputElement>("[data-vault-search]");
  if (searchInput) {
    let searchTimer: ReturnType<typeof setTimeout>;
    searchInput.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        vaultBrowserState.query = searchInput.value.trim();
        void loadVaultBrowse();
      }, 300);
    });
  }

  root.querySelectorAll<HTMLElement>("[data-vault-expand]").forEach((el) => {
    el.addEventListener("click", () => {
      const key = el.dataset.vaultExpand;
      if (key) void expandVaultObject(key);
    });
  });
}

function mockVaultBrowse(folder: string, query: string): VaultBrowserState {
  const allObjects: VaultBrowserState["objects"] = [
    { object_type: "handoff", lookup_key: "noos-hub-vault", key: "noos-hub-vault", title: "NOOS Hub Vault 改版", name: "2026-05-20-noos-hub-vault.md", path: "/Users/you/.noos/vault/handoffs/active/2026-05-20-noos-hub-vault.md", modified_epoch: 1779290000, folder: "handoffs/active" },
    { object_type: "crystal", lookup_key: "handoff-vs-crystal", key: "handoff-vs-crystal", title: "Handoff 与 Crystal 分工", name: "2026-05-20-handoff-vs-crystal.md", path: "/Users/you/.noos/vault/crystals/active/2026-05-20-handoff-vs-crystal.md", modified_epoch: 1779290000, folder: "crystals/active" },
    { object_type: "handoff", lookup_key: "feishu-md-export", key: "feishu-md-export", title: "飞书 MD 导出到 LLM Wiki", name: "2026-06-15-feishu-md-export.md", path: "/Users/you/.noos/vault/handoffs/active/2026-06-15-feishu-md-export.md", modified_epoch: 1780000000, folder: "handoffs/active" },
    { object_type: "crystal", lookup_key: "tauri-updater-signing", key: "tauri-updater-signing", title: "Tauri Updater 签名流程", name: "2026-06-10-tauri-updater-signing.md", path: "/Users/you/.noos/vault/crystals/active/2026-06-10-tauri-updater-signing.md", modified_epoch: 1779900000, folder: "crystals/active" },
    { object_type: "handoff", lookup_key: "sleep-recovery", key: "sleep-recovery", title: "休眠恢复 handoff", name: "2026-06-01-sleep-recovery.md", path: "/Users/you/.noos/vault/handoffs/done/2026-06-01-sleep-recovery.md", modified_epoch: 1779000000, folder: "handoffs/done" },
    { object_type: "result", lookup_key: "doctor-run-0628", key: "doctor-run-0628", title: "Doctor 检查结果 2026-06-28", name: "2026-06-28-doctor-result.md", path: "/Users/you/.noos/vault/results/inbox/2026-06-28-doctor-result.md", modified_epoch: 1780500000, folder: "results/inbox" }
  ];

  let objects = allObjects;
  if (folder !== "latest") {
    if (folder === "handoffs") {
      objects = objects.filter((o) => o.object_type === "handoff");
    } else if (folder === "crystals") {
      objects = objects.filter((o) => o.object_type === "crystal");
    } else if (folder === "results") {
      objects = objects.filter((o) => o.object_type === "result");
    } else {
      objects = objects.filter((o) => o.folder === folder);
    }
  }

  const q = query.toLowerCase().trim();
  if (q) {
    objects = objects.filter((o) =>
      o.title?.toLowerCase().includes(q) ||
      o.key?.toLowerCase().includes(q) ||
      o.name?.toLowerCase().includes(q) ||
      o.path?.toLowerCase().includes(q)
    );
  }

  return {
    folder,
    query,
    objects,
    folders: [
      { id: "latest", label: "最新", kind: "system" },
      { id: "handoffs", label: "Handoff", kind: "group" },
      { id: "handoffs/active", label: "活跃", kind: "folder" },
      { id: "handoffs/done", label: "已完成", kind: "folder" },
      { id: "crystals", label: "Crystal", kind: "group" },
      { id: "crystals/active", label: "活跃", kind: "folder" },
      { id: "results", label: "Result", kind: "group" },
      { id: "results/inbox", label: "收件箱", kind: "folder" }
    ],
    expandedKey: vaultBrowserState.expandedKey,
    expandedContent: vaultBrowserState.expandedContent
  };
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

async function loadSleepRecoveryStatus(): Promise<void> {
  try {
    currentRecoveryStatus = await invoke<SleepRecoveryStatus>("get_sleep_recovery_status");
  } catch {
    currentRecoveryStatus = mockSleepRecoveryStatus();
  }
  renderSleepRecoveryStatus();
}

async function installSleepRecoveryListeners(): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }

  await listen("tauri://suspended", () => {
    void markSleepSuspended();
  });

  await listen("tauri://resumed", () => {
    void recoverFromSleep("frontend tauri resumed event");
  });
}

async function installUpdateMenuListeners(): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }

  await listen("noos://check-update", () => {
    void checkForHubUpdate({ mode: "manual" });
  });
}

function scheduleSilentUpdateCheck(): void {
  if (!isTauriRuntime()) {
    return;
  }

  window.setTimeout(() => {
    void checkForHubUpdate({ mode: "silent" });
  }, silentUpdateCheckDelayMs);
}

async function recoverFromSleep(reason: string): Promise<void> {
  currentRecoveryStatus = {
    ...(currentRecoveryStatus ?? mockSleepRecoveryStatus()),
    state: "recovering",
    message: "正在从唤醒状态恢复本机写入服务。"
  };
  renderSleepRecoveryStatus();

  try {
    currentRecoveryStatus = await invoke<SleepRecoveryStatus>("recover_from_sleep", {
      reason,
      gapSecs: null
    });
    renderSleepRecoveryStatus();
    await loadHealth({ force: true });
  } catch (error) {
    currentRecoveryStatus = {
      state: "degraded",
      last_reason: reason,
      attempts: 0,
      local_write_healthy: false,
      relaunch_recommended: true,
      message: String(error)
    };
    renderSleepRecoveryStatus();
  }
}

async function markSleepSuspended(): Promise<void> {
  try {
    currentRecoveryStatus = await invoke<SleepRecoveryStatus>("mark_sleep_suspended");
  } catch {
    currentRecoveryStatus = {
      ...(currentRecoveryStatus ?? mockSleepRecoveryStatus()),
      state: "suspended",
      message: "系统已休眠；Hub 会在唤醒后恢复。"
    };
  }
  renderSleepRecoveryStatus();
}

function renderSleepRecoveryStatus(): void {
  const pill = appElement.querySelector<HTMLElement>(".recovery-pill");
  if (!pill || !currentRecoveryStatus) {
    return;
  }

  const display = sleepRecoveryDisplay(currentRecoveryStatus, isTauriRuntime());
  pill.dataset.recoveryState = display.dataState;
  pill.textContent = display.text;
  pill.title = display.title;
}

function renderCurrentSection(): void {
  const content = appElement.querySelector<HTMLDivElement>("#content");
  if (!content || !currentHealth) return;

  renderShellContext();
  appElement.querySelectorAll<HTMLButtonElement>("[data-section]").forEach((button) => {
    button.classList.toggle("active", button.dataset.section === activeSection);
    if (button.dataset.section === activeSection) {
      button.setAttribute("aria-current", "page");
    } else {
      button.removeAttribute("aria-current");
    }
  });

  switch (activeSection) {
    case "vault":
      content.innerHTML = renderVault(currentHealth);
      void loadVaultBrowse();
      break;
    case "adapters":
      content.innerHTML = renderAdapters(currentHealth);
      break;
    case "config":
      content.innerHTML = renderConfig(currentHealth, currentConfig);
      void loadConfig();
      break;
    case "help":
      content.innerHTML = renderHelp(currentHealth);
      break;
    case "home":
    default:
      content.innerHTML = renderDashboard(currentHealth);
      break;
  }

  setVaultFileActionDataRuns(content, [
    { id: "handoffs", files: currentHealth.recent_files.handoffs },
    { id: "crystals", files: currentHealth.recent_files.crystals }
  ]);
  bindSectionButtons(content);

  content.querySelectorAll<HTMLButtonElement>("[data-run]").forEach((button) => {
    button.addEventListener("click", (event) => {
      void runAction(button.dataset.run ?? "", event.currentTarget as HTMLButtonElement);
    });
  });
  content.querySelector('[data-action="check-update"]')?.addEventListener("click", () => {
    void checkForHubUpdate({ mode: "manual" });
  });

  if (activeSection === "config") {
    bindConfigEditEvents(content);
  }
}

function renderShellContext(): void {
  const item = sectionMeta[activeSection] ?? sectionMeta.home;
  const eyebrow = appElement.querySelector<HTMLElement>("#section-eyebrow");
  const title = appElement.querySelector<HTMLElement>("#section-title");
  const summary = appElement.querySelector<HTMLElement>("#section-summary");

  if (eyebrow) {
    eyebrow.textContent = item.eyebrow;
  }
  if (title) {
    title.textContent = item.title;
  }
  if (summary) {
    summary.textContent = item.summary;
  }
}

async function runAction(action: string, sourceButton?: HTMLButtonElement): Promise<void> {
  if (!action || actionInFlight) return;

  actionInFlight = true;
  const originalLabel = sourceButton?.textContent ?? "";
  if (sourceButton) {
    sourceButton.disabled = true;
    sourceButton.textContent = "⏳ …";
  }

  setLog(`运行：${action}\n`);

  try {
    const output = await invoke<string>("run_hub_action", { action });
    setLog(output || "完成。");
    showToast("✅ 完成", "success");
    await loadHealth({ force: true });
  } catch (error) {
    if (!isTauriRuntime()) {
      setLog(`浏览器预览模式不会执行本机动作：${action}`);
      showToast("浏览器预览模式不执行本机动作", "info");
    } else {
      setLog(`失败：${String(error)}`);
      showToast("❌ 操作失败", "error");
    }
  } finally {
    actionInFlight = false;
    if (sourceButton) {
      sourceButton.disabled = false;
      sourceButton.textContent = originalLabel;
    }
  }
}

async function checkForHubUpdate({ mode }: { mode: UpdateCheckMode }): Promise<void> {
  if (!isTauriRuntime()) {
    setLog("浏览器预览模式不会检查 GitHub Release 更新。");
    return;
  }
  if (updateCheckInFlight) {
    if (mode === "manual") {
      updateDialogVisible = true;
      renderUpdateSurfaces();
    }
    return;
  }

  updateCheckInFlight = true;
  updateStatus = "checking";
  updateMessage = "正在检查 GitHub Releases 上的签名更新。";
  updateDownloadedBytes = 0;
  updateTotalBytes = undefined;
  if (mode === "manual") {
    updateDialogVisible = true;
    updateBannerVisible = false;
    renderUpdateSurfaces();
  }

  try {
    const update = await check();
    if (!update) {
      availableUpdate = null;
      updateStatus = "up-to-date";
      updateMessage = "NOOS Hub 已是最新。";
      updateBannerVisible = false;
      if (mode === "manual") {
        renderUpdateSurfaces();
      }
      return;
    }
    availableUpdate = update;
    updateStatus = "available";
    updateMessage = `发现版本 ${update.version}。`;
    if (mode === "silent") {
      updateBannerVisible = dismissedUpdateVersion !== update.version;
      updateDialogVisible = false;
    } else {
      updateBannerVisible = false;
      updateDialogVisible = true;
    }
    renderUpdateSurfaces();
  } catch (error) {
    updateStatus = "error";
    updateMessage = `无法检查更新：${String(error)}`;
    updateBannerVisible = false;
    if (mode === "manual") {
      updateDialogVisible = true;
      renderUpdateSurfaces();
    }
  } finally {
    updateCheckInFlight = false;
  }
}

async function installHubUpdate(): Promise<void> {
  if (!isTauriRuntime()) {
    setLog("浏览器预览模式不会安装更新。");
    return;
  }

  try {
    const update = availableUpdate ?? (await check());
    if (!update) {
      availableUpdate = null;
      updateStatus = "up-to-date";
      updateMessage = "NOOS Hub 已是最新。";
      updateDialogVisible = true;
      updateBannerVisible = false;
      renderUpdateSurfaces();
      return;
    }

    let downloaded = 0;
    availableUpdate = update;
    updateStatus = "downloading";
    updateMessage = `正在下载 NOOS Hub ${update.version}。`;
    updateDialogVisible = true;
    updateBannerVisible = false;
    renderUpdateSurfaces();

    await update.downloadAndInstall((event: DownloadEvent) => {
      if (event.event === "Started") {
        downloaded = 0;
        updateDownloadedBytes = 0;
        updateTotalBytes = event.data.contentLength;
        updateMessage = `正在下载 NOOS Hub ${update.version}。`;
      } else if (event.event === "Progress") {
        downloaded += event.data.chunkLength;
        updateDownloadedBytes = downloaded;
      } else if (event.event === "Finished") {
        updateStatus = "restarting";
        updateMessage = `NOOS Hub ${update.version} 已安装，正在重启。`;
      }
      renderUpdateSurfaces();
    });
    await relaunch();
  } catch (error) {
    updateStatus = "error";
    updateMessage = `无法安装更新：${String(error)}`;
    updateDialogVisible = true;
    updateBannerVisible = false;
    renderUpdateSurfaces();
  }
}

function renderUpdateSurfaces(): void {
  renderUpdateBanner();
  renderUpdateDialog();
}

function renderUpdateBanner(): void {
  const banner = appElement.querySelector<HTMLElement>("#update-banner");
  if (!banner) return;

  const visible = updateBannerVisible && !!availableUpdate && updateStatus === "available";
  banner.hidden = !visible;
  if (!visible || !availableUpdate) {
    banner.innerHTML = "";
    return;
  }

  banner.innerHTML = renderUpdateBannerHtml(availableUpdate);
  banner.querySelector('[data-update-action="show"]')?.addEventListener("click", () => {
    updateDialogVisible = true;
    updateBannerVisible = false;
    renderUpdateSurfaces();
  });
  banner.querySelector('[data-update-action="dismiss"]')?.addEventListener("click", () => {
    dismissedUpdateVersion = availableUpdate?.version ?? null;
    updateBannerVisible = false;
    renderUpdateSurfaces();
  });
}

function renderUpdateDialog(): void {
  const root = appElement.querySelector<HTMLElement>("#update-dialog-root");
  if (!root) return;

  if (!updateDialogVisible) {
    root.innerHTML = "";
    return;
  }

  root.innerHTML = renderUpdateDialogHtml({
    status: updateStatus,
    message: updateMessage,
    availableUpdate,
    downloadedBytes: updateDownloadedBytes,
    totalBytes: updateTotalBytes
  });

  root.querySelector('[data-update-action="close"]')?.addEventListener("click", closeUpdateDialog);
  root.querySelector('[data-update-action="later"]')?.addEventListener("click", closeUpdateDialog);
  root.querySelector('[data-update-action="retry"]')?.addEventListener("click", () => {
    void checkForHubUpdate({ mode: "manual" });
  });
  root.querySelector('[data-update-action="install"]')?.addEventListener("click", () => {
    void installHubUpdate();
  });
}

function closeUpdateDialog(): void {
  updateDialogVisible = false;
  renderUpdateSurfaces();
}

function showToast(message: string, kind: "success" | "error" | "info" = "info"): void {
  const toast = appElement.querySelector<HTMLElement>("#toast");
  if (!toast) return;

  if (toastTimer) {
    clearTimeout(toastTimer);
  }

  toast.className = `toast toast--${kind}`;
  toast.textContent = message;
  toast.hidden = false;

  toastTimer = setTimeout(() => {
    toast.hidden = true;
    toastTimer = null;
  }, 3000);
}

function setLog(value: string): void {
  currentLog = value;
  const panel = appElement.querySelector<HTMLElement>("#log");
  const pre = panel?.querySelector("pre");
  if (!panel || !pre) return;
  pre.textContent = value;
  panel.hidden = value.length === 0;
  if (!panel.hidden) {
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

async function loadConfig(): Promise<void> {
  try {
    currentConfig = await invoke<ConfigData>("read_config");
  } catch {
    if (isTauriRuntime()) {
      showToast("无法读取配置", "error");
    }
    currentConfig = {};
  }

  const content = appElement.querySelector<HTMLDivElement>("#content");
  if (!content || !currentHealth) return;
  if (activeSection === "config") {
    content.innerHTML = renderConfig(currentHealth, currentConfig);
    bindConfigEditEvents(content);
    bindRunButtons(content);
  }
}

function bindConfigEditEvents(root: ParentNode): void {
  root.querySelectorAll<HTMLButtonElement>("[data-config-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.configEdit;
      if (!key) return;
      const row = root.querySelector<HTMLElement>(`[data-config-key="${key}"]`);
      if (!row) return;
      row.querySelector<HTMLElement>(".cfg-value-text")!.hidden = true;
      row.querySelector<HTMLElement>(".cfg-edit-btn")!.hidden = true;
      row.querySelector<HTMLElement>(".cfg-edit-form")!.hidden = false;
      const input = row.querySelector<HTMLInputElement>(`[data-config-input="${key}"]`);
      if (input) input.focus();
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-config-save]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.configSave;
      if (!key) return;
      const row = root.querySelector<HTMLElement>(`[data-config-key="${key}"]`);
      if (!row) return;
      const input = row.querySelector<HTMLInputElement>(`[data-config-input="${key}"]`);
      const select = row.querySelector<HTMLSelectElement>(`[data-config-select="${key}"]`);
      const newValue = input?.value.trim() ?? select?.value ?? "";
      void saveConfigValue(key, newValue, row);
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-config-cancel]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.configCancel;
      if (!key) return;
      const row = root.querySelector<HTMLElement>(`[data-config-key="${key}"]`);
      if (!row) return;
      row.querySelector<HTMLElement>(".cfg-edit-form")!.hidden = true;
      row.querySelector<HTMLElement>(".cfg-value-text")!.hidden = false;
      row.querySelector<HTMLElement>(".cfg-edit-btn")!.hidden = false;
    });
  });
}

async function saveConfigValue(key: string, value: string, row: HTMLElement): Promise<void> {
  try {
    const jsonValue = key === "github.default_account"
      ? (value || null)
      : value;
    await invoke("write_config", { key, value: jsonValue });
    showToast("已保存", "success");

    row.querySelector<HTMLElement>(".cfg-edit-form")!.hidden = true;
    const display = row.querySelector<HTMLElement>(".cfg-value-text")!;
    display.textContent = value || "—";
    display.hidden = false;
    row.querySelector<HTMLElement>(".cfg-edit-btn")!.hidden = false;

    if (currentConfig) {
      const parts = key.split(".");
      if (parts.length === 1) {
        (currentConfig as Record<string, unknown>)[key] = value;
      } else if (parts.length === 2 && parts[0] === "github") {
        currentConfig.github = { ...currentConfig.github, [parts[1]]: value };
      }
    }
    await loadHealth({ force: true });
  } catch (error) {
    showToast(`保存失败：${String(error)}`, "error");
  }
}

function bindRunButtons(root: ParentNode): void {
  root.querySelectorAll<HTMLButtonElement>("[data-run]").forEach((button) => {
    button.addEventListener("click", (event) => {
      void runAction(button.dataset.run ?? "", event.currentTarget as HTMLButtonElement);
    });
  });
}

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}
