import { createCrystalFilename, createThreadFilenameFromThread } from "../core/filename";
import { createContextPack, type ContextPack } from "../core/context-pack";
import { createGenerateCrystalPrompt, createGenerateThreadPrompt } from "../core/prompt-templates";
import { captureNoosThreads } from "../core/thread-capture";
import { captureNoosCrystals } from "../core/crystal-capture";
import type { NoosThread } from "../core/noos-thread";
import type { NoosCrystal } from "../core/noos-crystal";
import { EXTENSION_CONTEXT_INVALID, sendExtensionMessage } from "../shared/extension-runtime";
import { COPY, type ShuttleLocale, getStoredLocale, storeLocale } from "../shared/i18n";
import { ClipboardAdapter } from "../storage/ClipboardAdapter";
import { DownloadAdapter } from "../storage/DownloadAdapter";
import { NoosVaultAdapter } from "../storage/NoosVaultAdapter";
import { attachMarkdownFilesToChatInput, getPageText, insertIntoChatInput, isChatbotGenerating, submitChatInput } from "./chatgpt-dom";
import { captureChatGptTranscriptWithScroll, captureRenderedChatGptTranscript } from "./chatgpt-transcript";
import styles from "./styles.css?inline";

type ShuttleState = "idle" | "prompt-ready" | "waiting" | "captured" | "needs-choice" | "warning" | "saved" | "error";
type DeliveryMode = "copy" | "download" | "vault";
type VaultRoute = "checking" | "hub" | "needs-repair" | "mirror";
type VaultFeedTarget = "chat" | "project" | "feishu_publish";
type SurfaceKind = "chatgpt" | "feishu" | "none";
type FeishuPageContextKind = "doc" | "drive_root" | "drive_folder";
type FeishuPublishMode = "create" | "overwrite";
type FeishuPublishDestinationKind = "current_doc" | "drive_root" | "drive_folder";
type FeishuWikiAction =
  | "export_md"
  | "change_category"
  | "organize_wiki"
  | "export_md_and_organize"
  | "open_markdown_folder"
  | "open_wiki_folder";
type ModalState =
  | { kind: "success"; title: string; message: string; actions?: ModalAction[] }
  | { kind: "warnings"; title: string; message: string; warnings: string[] }
  | { kind: "choose-thread" }
  | { kind: "choose-crystal" }
  | { kind: "vault-picker" }
  | { kind: "feishu-category"; pendingAction?: FeishuWikiAction }
  | { kind: "confirm-feishu-overwrite" }
  | null;

interface ModalAction {
  label: string;
  action?: string;
  href?: string;
  primary?: boolean;
  testId?: string;
}

interface ViewState {
  open: boolean;
  surfaceOpen: boolean;
  settingsOpen: boolean;
  state: ShuttleState;
  message: string;
  threads: NoosThread[];
  crystals: NoosCrystal[];
  selectedIndex: number;
  selectedCrystalIndex: number;
  locale: ShuttleLocale;
  deliveryModes: DeliveryMode[];
  captureFullTranscript: boolean;
  contextPack: ContextPack | null;
  vaultRoute: VaultRoute;
  vaultObjects: VaultObjectSummary[];
  vaultFolders: VaultFolderSummary[];
  vaultBrowseFolder: string;
  vaultBrowseQuery: string;
  selectedVaultObjectKeys: string[];
  selectedPublishSource: VaultObjectContent | null;
  wikiProjectPath: string;
  wikiCategoryPath: string;
  recentCategoryPaths: string[];
  modal: ModalState;
}

interface VaultObjectSummary {
  object_type: "handoff" | "crystal" | "result" | string;
  lookup_key?: string;
  key?: string;
  title?: string;
  name?: string;
  path?: string;
  folder?: string;
  modified_epoch?: number;
}

interface VaultFolderSummary {
  id: string;
  label: string;
  kind?: string;
}

interface VaultObjectContent {
  object_type?: string;
  lookup_key?: string;
  key?: string;
  title?: string;
  name?: string;
  path?: string;
  content: string;
}

interface ProjectSourceSnapshot {
  title: string;
  detail?: string;
  href?: string;
}

interface GeneratedImageArtifact {
  filename: string;
  url: string;
  sourceUrl: string;
  width: number;
  height: number;
}

interface FeishuActionResponse {
  ok?: boolean;
  status?: string;
  message?: string;
  errorCode?: string;
  error_code?: string;
  sourcePath?: string;
  source_path?: string;
  wikiProjectPath?: string;
  wiki_project_path?: string;
  documentUrl?: string;
  document_url?: string;
  folderName?: string;
  folder_name?: string;
}

interface FeishuPageContext {
  kind: FeishuPageContextKind;
  label: string;
  folderToken?: string;
}

interface ActiveWait {
  observer: MutationObserver;
  timeoutId: number;
  fallbackStartId: number;
  capturePollId: number;
  quietTimerId: number | null;
  retryTimerId: number | null;
  hasStartedGenerating: boolean;
}

interface ShuttlePosition {
  x: number;
  y: number;
}

type PageKind = "conversation" | "composer" | "login" | "unavailable" | "unsupported" | "unknown";

interface PageContext {
  href: string;
  origin: string;
  pathname: string;
  conversationId: string;
  pageKind: PageKind;
  textFingerprint: string;
  signature: string;
}

const WAIT_FOR_HANDOFF_TIMEOUT_MS = 120_000;
const GENERATION_START_GRACE_MS = 1_500;
const GENERATION_QUIET_MS = 2_500;
const CAPTURE_RETRY_MS = 1_200;
const CAPTURE_POLL_MS = 1_500;
const PAGE_CONTEXT_POLL_MS = 1_000;
const PAGE_CONTEXT_DEBOUNCE_MS = 250;
const FAB_SIZE = 44;
const EDGE_GAP = 12;
const SHUTTLE_ICON_URL = getExtensionAssetUrl("icons/icon-128.png");
const clipboardAdapter = new ClipboardAdapter();
const downloadAdapter = new DownloadAdapter();
const noosVaultAdapter = new NoosVaultAdapter();
let activeWait: ActiveWait | null = null;
let currentPageContext = getPageContext();
let conversationWatcherInstalled = false;
let projectImportBridgeInstalled = false;
let pageContextDebounceId: number | null = null;
let shuttlePosition = getStoredPosition();
let suppressNextFabClick = false;
let vaultFeedTarget: VaultFeedTarget = "chat";
let preferredVaultAttachRoot: HTMLElement | null = null;

const viewState: ViewState = {
  open: false,
  surfaceOpen: false,
  settingsOpen: false,
  state: "idle",
  message: COPY[getStoredLocale()].ready,
  threads: [],
  crystals: [],
  selectedIndex: 0,
  selectedCrystalIndex: 0,
  locale: getStoredLocale(),
  deliveryModes: getStoredDeliveryModes(),
  captureFullTranscript: getStoredCaptureFullTranscript(),
  contextPack: null,
  vaultRoute: "checking",
  vaultObjects: [],
  vaultFolders: [],
  vaultBrowseFolder: "latest",
  vaultBrowseQuery: "",
  selectedVaultObjectKeys: [],
  selectedPublishSource: null,
  wikiProjectPath: "",
  wikiCategoryPath: "",
  recentCategoryPaths: [],
  modal: null
};

bootstrap();

function bootstrap(): void {
  if (document.getElementById("noos-shuttle-root")) {
    return;
  }

  const host = document.createElement("div");
  host.id = "noos-shuttle-root";
  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = styles;
  shadow.append(style);

  const app = document.createElement("div");
  app.className = "shuttle";
  shadow.append(app);
  document.documentElement.append(host);
  applyShuttlePosition(app, shuttlePosition);

  render(app);
  installConversationWatcher(app);
  installProjectImportBridge(app);
  void refreshVaultStatus(app);
  window.addEventListener("resize", () => {
    shuttlePosition = clampPosition(shuttlePosition);
    applyShuttlePosition(app, shuttlePosition);
    storePosition(shuttlePosition);
  });
}

function render(app: HTMLElement): void {
  const selectedThread = viewState.threads[viewState.selectedIndex];
  const copy = COPY[viewState.locale];
  const surface = getCurrentSurface();

  app.innerHTML = `
    <button class="fab fab--${viewState.state}" type="button" aria-label="NOOS Shuttle">
      <span class="fab-logo" style="background-image: url('${escapeAttribute(SHUTTLE_ICON_URL)}')"></span>
    </button>
    ${
      surface === "none"
        ? ""
        : `<button class="surface-fab surface-fab--${surface}" type="button" aria-label="${escapeAttribute(surfaceTitle(surface, copy))}">
            <span>${surface === "feishu" ? "MD" : "AI"}</span>
          </button>`
    }
    ${
      viewState.open
        ? `<section class="popover global-popover" aria-label="${escapeAttribute(copy.globalBalloonTitle)}">
            <header class="header">
              <div>
                <strong>${escapeHtml(copy.globalBalloonTitle)}</strong>
                <span>${escapeHtml(viewState.message)}</span>
              </div>
              <button class="icon-button" type="button" data-action="close" aria-label="${copy.close}">x</button>
            </header>
            ${renderVaultRoute(copy)}
            ${renderVaultImport()}
            <div class="settings">
              <button class="settings-toggle" type="button" data-action="settings">${copy.settings}</button>
              ${
                viewState.settingsOpen
                  ? `<div class="settings-panel">
                      <div class="settings-label">${copy.language}</div>
                      <div class="segmented" role="group" aria-label="${copy.language}">
                        <button type="button" data-action="locale-zh" aria-pressed="${
                          viewState.locale === "zh"
                        }">中文</button>
                        <button type="button" data-action="locale-en" aria-pressed="${
                          viewState.locale === "en"
                        }">English</button>
                      </div>
                    </div>`
                  : ""
              }
            </div>
          </section>`
        : ""
    }
    ${viewState.surfaceOpen && surface !== "none" ? renderSurfacePopover(surface, selectedThread, copy) : ""}
    ${renderModal()}
  `;

  app.querySelector(".fab")?.addEventListener("click", () => {
    if (suppressNextFabClick) {
      suppressNextFabClick = false;
      return;
    }

    vaultFeedTarget = "chat";
    preferredVaultAttachRoot = null;
    viewState.open = !viewState.open;
    viewState.surfaceOpen = false;
    render(app);
    if (viewState.open) {
      void refreshVaultStatus(app);
      void refreshVaultObjects(app);
    }
  });
  app.querySelector(".surface-fab")?.addEventListener("click", () => {
    viewState.surfaceOpen = !viewState.surfaceOpen;
    viewState.open = false;
    render(app);
    if (viewState.surfaceOpen && getCurrentSurface() === "feishu") {
      void refreshWikiTarget(app);
    }
  });
  installDragHandlers(app);

  app.querySelectorAll<HTMLButtonElement>("button[data-action]").forEach((element) => {
    element.addEventListener("click", () => handleAction(element.dataset.action ?? "", app));
  });

  app.querySelector<HTMLSelectElement>("select[data-action='select-thread']")?.addEventListener("change", () => {
    handleAction("select-thread", app);
  });

  app.querySelector<HTMLInputElement>("input[data-action='vault-search']")?.addEventListener("input", (event) => {
    const input = event.currentTarget as HTMLInputElement;
    viewState.vaultBrowseQuery = input.value;
    void refreshVaultObjects(app, { preserveSelection: true, preserveScroll: true });
  });

  app.querySelector<HTMLInputElement>("[data-feishu-category-dialog-input='true']")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void handleAction("feishu-confirm-category", app);
    }
  });

  app.querySelector<HTMLInputElement>("input[data-action='toggle-transcript']")?.addEventListener("change", (event) => {
    viewState.captureFullTranscript = (event.currentTarget as HTMLInputElement).checked;
    storeCaptureFullTranscript(viewState.captureFullTranscript);
    if (!viewState.captureFullTranscript) {
      viewState.contextPack = null;
    } else {
      captureContextPackForSelectedThread();
    }
    render(app);
  });
}

function renderPreservingPopoverScroll(app: HTMLElement): void {
  const popover = app.querySelector<HTMLElement>(".popover");
  const scrollTop = popover?.scrollTop ?? 0;
  render(app);
  const nextPopover = app.querySelector<HTMLElement>(".popover");
  if (nextPopover) {
    nextPopover.scrollTop = scrollTop;
  }
}

function renderDeliveryOption(mode: DeliveryMode, label: string): string {
  const pressed = viewState.deliveryModes.includes(mode);
  return `<button class="delivery-option" type="button" role="switch" data-action="delivery-${mode}" aria-checked="${pressed}">
    <span>${escapeHtml(label)}</span>
    <span class="switch-track" aria-hidden="true"><span class="switch-thumb"></span></span>
  </button>`;
}

function renderSurfacePopover(surface: SurfaceKind, selectedThread: NoosThread | undefined, copy: (typeof COPY)[ShuttleLocale]): string {
  return `<section class="popover surface-popover surface-popover--${surface}" aria-label="${escapeAttribute(surfaceTitle(surface, copy))}">
    <header class="header">
      <div>
        <strong>${escapeHtml(surfaceTitle(surface, copy))}</strong>
        <span>${escapeHtml(surfaceSubtitle(surface, copy))}</span>
      </div>
      <div class="header-actions">
        <button class="surface-back" type="button" data-action="surface-back" aria-label="${escapeAttribute(copy.globalBalloonTitle)}">${escapeHtml(
          copy.globalBalloonTitle
        )}</button>
        <button class="icon-button" type="button" data-action="close" aria-label="${copy.close}">x</button>
      </div>
    </header>
    ${surface === "chatgpt" ? renderChatGptSurface(selectedThread, copy) : renderFeishuSurface(copy)}
  </section>`;
}

function renderChatGptSurface(selectedThread: NoosThread | undefined, copy: (typeof COPY)[ShuttleLocale]): string {
  return `<div class="primary-actions">
    <button class="primary-action" type="button" data-action="generate-capture" ${
      viewState.state === "waiting" ? "disabled" : ""
    }>${copy.generateAndCollect}</button>
    <button class="secondary-action" type="button" data-action="generate-crystal" ${
      viewState.state === "waiting" ? "disabled" : ""
    }>${copy.extractCrystal}</button>
    ${
      viewState.state === "waiting"
        ? `<button class="cancel-action" type="button" data-action="cancel-wait">${copy.cancel}</button>`
        : ""
    }
    <div class="auto-delivery">
      <span>${copy.autoAfterCollect}</span>
      <div class="delivery-options" role="group" aria-label="${copy.autoAfterCollect}">
        ${renderDeliveryOption("copy", copy.autoCopy)}
        ${renderDeliveryOption("download", copy.autoDownload)}
        ${renderDeliveryOption("vault", copy.autoSave)}
      </div>
      <label class="transcript-option">
        <input type="checkbox" data-action="toggle-transcript" ${viewState.captureFullTranscript ? "checked" : ""} />
        <span>${copy.captureFullTranscript}</span>
      </label>
    </div>
  </div>
  <div class="actions supporting-actions">
    <button type="button" data-action="generate">${copy.draftHandoff}</button>
    <button type="button" data-action="capture">${copy.collectHandoff}</button>
    <button type="button" data-action="capture-crystal">${copy.scanCrystal}</button>
    <button type="button" data-action="download-images">${copy.downloadImages}</button>
  </div>
  ${renderThreads(selectedThread)}`;
}

function renderFeishuSurface(copy: (typeof COPY)[ShuttleLocale]): string {
  const pageContext = getFeishuPageContext();
  const documentTitle = feishuDocumentTitle();
  const target = viewState.wikiProjectPath || copy.defaultWikiProjectUnknown;
  const category = viewState.wikiCategoryPath || copy.feishuCategoryUnset;
  const contextLabel =
    pageContext?.kind === "drive_root"
      ? copy.feishuRootFolder
      : pageContext?.kind === "drive_folder"
        ? pageContext.label || copy.feishuCurrentFolder
        : documentTitle;
  return `<div class="surface-panel">
    <div class="surface-summary">
      <span>${escapeHtml(pageContext?.kind === "doc" ? copy.feishuDocumentTitle : copy.feishuPageLocation)}</span>
      <strong>${escapeHtml(contextLabel)}</strong>
    </div>
    ${
      pageContext?.kind === "doc"
        ? `<section class="surface-section">
            <div class="surface-section-title">${escapeHtml(copy.feishuExportSectionTitle)}</div>
            <div class="surface-summary">
              <span>${escapeHtml(copy.defaultWikiProject)}</span>
              <strong>${escapeHtml(target)}</strong>
            </div>
            <div class="surface-summary">
              <span>${escapeHtml(copy.feishuLibraryCategory)}</span>
              <strong>${escapeHtml(category)}</strong>
            </div>
            <div class="primary-actions">
              <button class="primary-action" type="button" data-action="feishu-export-md">${escapeHtml(copy.feishuExportMd)}</button>
              <div class="surface-secondary-actions">
                <button class="secondary-action" type="button" data-action="feishu-change-category">${escapeHtml(copy.feishuChangeCategory)}</button>
                <button class="secondary-action" type="button" data-action="feishu-organize-wiki">${escapeHtml(copy.feishuOrganizeWiki)}</button>
                <button class="secondary-action" type="button" data-action="feishu-export-organize">${escapeHtml(copy.feishuExportMdAndOrganize)}</button>
              </div>
            </div>
            <div class="surface-folder-actions">
              <button type="button" data-action="feishu-open-markdown-folder">${escapeHtml(copy.feishuOpenMarkdownFolder)}</button>
              <button type="button" data-action="feishu-open-wiki-folder">${escapeHtml(copy.feishuOpenWikiFolder)}</button>
            </div>
            <p class="surface-hint">${escapeHtml(copy.feishuMarkdownHint)}</p>
          </section>`
        : ""
    }
    ${renderFeishuPublishSection(pageContext, copy)}
  </div>`;
}

function renderFeishuPublishSection(pageContext: FeishuPageContext | null, copy: (typeof COPY)[ShuttleLocale]): string {
  const selected = viewState.selectedPublishSource;
  const selectedTitle = selected?.title || selected?.name || selected?.lookup_key || selected?.key || "";
  const selectedPath = selected?.path || selected?.lookup_key || selected?.key || "";
  const publishLabel =
    pageContext?.kind === "drive_root"
      ? copy.feishuPublishToRootFolder
      : pageContext?.kind === "drive_folder"
        ? copy.feishuPublishToCurrentFolder
        : copy.feishuPublishNewDocument;
  return `<section class="surface-section surface-section--publish">
    <div class="surface-section-title">${escapeHtml(copy.feishuPublishSectionTitle)}</div>
    ${
      selected
        ? `<div class="surface-summary">
            <span>${escapeHtml(copy.feishuSelectedMarkdown)}</span>
            <strong>${escapeHtml(selectedTitle || selectedPath)}</strong>
            ${selectedPath ? `<small>${escapeHtml(selectedPath)}</small>` : ""}
          </div>`
        : `<p class="surface-hint">${escapeHtml(copy.feishuPublishSectionHint)}</p>`
    }
    <div class="primary-actions">
      ${
        selected
          ? `<button class="primary-action" type="button" data-action="feishu-publish-new">${escapeHtml(publishLabel)}</button>
             ${
               pageContext?.kind === "doc"
                 ? `<button class="danger-action" type="button" data-action="feishu-overwrite-current">${escapeHtml(copy.feishuOverwriteCurrentDocument)}</button>`
                 : ""
             }`
          : `<button class="primary-action" type="button" data-action="feishu-select-markdown">${escapeHtml(copy.feishuSelectMarkdown)}</button>`
      }
      ${
        selected
          ? `<button class="secondary-action" type="button" data-action="feishu-select-markdown">${escapeHtml(copy.feishuChangeMarkdown)}</button>`
          : ""
      }
    </div>
    <p class="surface-hint">${escapeHtml(copy.feishuPublishHint)}</p>
  </section>`;
}

function renderVaultRoute(copy: (typeof COPY)[ShuttleLocale]): string {
  const message =
    viewState.vaultRoute === "hub"
      ? copy.vaultStatusHub
      : viewState.vaultRoute === "needs-repair"
        ? copy.vaultStatusNeedsRepair
        : viewState.vaultRoute === "mirror"
          ? copy.vaultStatusMirror
          : copy.vaultStatusChecking;

  return `<div class="vault-route vault-route--${viewState.vaultRoute}">
    <span>${escapeHtml(copy.vaultAdapterNote)}</span>
    <strong>${escapeHtml(message)}</strong>
    <button type="button" data-action="refresh-vault">${escapeHtml(copy.vaultStatusRefresh)}</button>
  </div>`;
}

function renderVaultImport(): string {
  const copy = COPY[viewState.locale];
  const handoffs = viewState.vaultObjects.filter((item) => item.object_type === "handoff").slice(0, 2);
  const crystals = viewState.vaultObjects.filter((item) => item.object_type === "crystal").slice(0, 2);
  const results = viewState.vaultObjects.filter((item) => item.object_type === "result").slice(0, 2);
  const newest = viewState.vaultObjects.slice(0, 2);
  const selectedKeys = selectedVaultObjectKeys();
  const targetLabel = vaultTargetLabel(copy);
  const canUseSelection = canUseVaultSelection(selectedKeys);

  return `<section class="vault-import" aria-label="${escapeAttribute(copy.importFromNoos)}">
    <header>
      <div>
        <strong>${escapeHtml(copy.importFromNoos)}</strong>
        <span>${escapeHtml(copy.importFromNoosHint)}</span>
      </div>
      <div class="vault-import-header-actions">
        <button type="button" data-action="open-vault-picker">${escapeHtml(copy.browseVaultObjects)}</button>
        <button type="button" data-action="refresh-vault-objects">${escapeHtml(copy.vaultStatusRefresh)}</button>
      </div>
    </header>
    ${
      viewState.vaultObjects.length
        ? `<div class="vault-import-groups">
            ${renderVaultObjectGroup(copy.latestVaultObjects, newest, selectedKeys)}
            ${renderVaultObjectGroup(copy.latestHandoffs, handoffs, selectedKeys)}
            ${renderVaultObjectGroup(copy.latestCrystals, crystals, selectedKeys)}
            ${renderVaultObjectGroup(copy.latestResults, results, selectedKeys)}
          </div>
          <footer>
            <span class="shuttle-signature">FuTou 2026</span>
            <button type="button" data-action="feed-selected-vault-object" ${canUseSelection ? "" : "disabled"}>${escapeHtml(
              selectedKeys.length > 1 ? copy.attachSelectedToTarget(selectedKeys.length, targetLabel) : targetLabel
            )}</button>
          </footer>`
        : `<div class="vault-import-empty">${escapeHtml(copy.noVaultObjects)}</div>`
    }
  </section>`;
}

function vaultTargetLabel(copy: (typeof COPY)[ShuttleLocale]): string {
  if (vaultFeedTarget === "project") {
    return copy.attachToProjectSources;
  }
  if (vaultFeedTarget === "feishu_publish") {
    return copy.attachToFeishuPublish;
  }
  return copy.attachToCurrentChat;
}

function canUseVaultSelection(selectedKeys: string[]): boolean {
  if (vaultFeedTarget === "feishu_publish") {
    return selectedKeys.length === 1;
  }
  return selectedKeys.length > 0;
}

function renderVaultObjectGroup(title: string, objects: VaultObjectSummary[], selectedKeys: string[]): string {
  if (objects.length === 0) {
    return "";
  }

  return `<div class="vault-object-group">
    <div class="vault-object-group-title">${escapeHtml(title)}</div>
    <div class="vault-object-list">
      ${objects
        .map((object) => {
          const key = vaultObjectKey(object);
          const title = object.title || object.name || key;
          const label = `${object.object_type}${object.path ? ` · ${compactPath(object.path)}` : ""}`;
          return `<button type="button" data-action="select-vault-object-${escapeAttribute(key)}" aria-pressed="${
            selectedKeys.includes(key)
          }">
            <span class="vault-object-check" aria-hidden="true">${selectedKeys.includes(key) ? "✓" : ""}</span>
            <strong>${escapeHtml(title)}</strong>
            <span>${escapeHtml(key)}</span>
            <small>${escapeHtml(label)}</small>
          </button>`;
        })
        .join("")}
    </div>
  </div>`;
}

function renderThreads(selectedThread: NoosThread | undefined): string {
  const copy = COPY[viewState.locale];

  if (viewState.threads.length === 0) {
    return `<div class="empty">${copy.noCapturedHandoff}</div>`;
  }

  const warnings = selectedThread?.warnings.length
    ? `<div class="warnings">
        <strong>${copy.warnings}</strong>
        <ul>${selectedThread.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>
      </div>`
    : "";

  return `
    <article class="preview">
      <div class="preview-title">${escapeHtml(selectedThread?.title ?? copy.untitledThread)}</div>
      <footer class="preview-actions" aria-label="${copy.detectedHandoffs}">
        <button type="button" data-action="copy">${copy.copyText}</button>
        <button type="button" data-action="download">${copy.downloadFile}</button>
        <button type="button" data-action="vault">${copy.saveToVault}</button>
      </footer>
      ${warnings}
      <pre>${escapeHtml(selectedThread?.rawMarkdown ?? "")}</pre>
      <div class="vault-note">${escapeHtml(copy.vaultAdapterNote)}</div>
    </article>
  `;
}

function threadChoiceSummary(thread: NoosThread, copy: (typeof COPY)[ShuttleLocale]): string {
  const parts = [
    thread.frontmatter?.handoff_revision,
    thread.frontmatter?.created_at,
    thread.frontmatter?.status,
    thread.frontmatter?.target_agent,
    thread.frontmatter?.preferred_path
  ].filter(Boolean);

  if (thread.warnings.length > 0) {
    parts.push(`${copy.warnings}: ${thread.warnings.length}`);
  }

  return parts.length > 0 ? parts.join(" · ") : copy.captured;
}

function crystalChoiceSummary(crystal: NoosCrystal, copy: (typeof COPY)[ShuttleLocale]): string {
  const parts = [
    crystal.frontmatter?.created_at,
    crystal.key,
    crystal.summary
  ].filter(Boolean);

  if (crystal.warnings.length > 0) {
    parts.push(`${copy.warnings}: ${crystal.warnings.length}`);
  }

  return parts.join(" · ");
}

function crystalPreview(crystal: NoosCrystal): string {
  return crystal.bodyMarkdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("---"))
    .slice(0, 4)
    .join(" ")
    .slice(0, 220);
}

function renderModal(): string {
  const modal = viewState.modal;
  const copy = COPY[viewState.locale];
  if (!modal) {
    return "";
  }

  if (modal.kind === "choose-thread") {
    return `<div class="modal-backdrop" role="presentation">
      <section class="modal" role="dialog" aria-modal="true" aria-label="${copy.chooseHandoffTitle}">
        <header class="modal-header">
          <strong>${copy.chooseHandoffTitle}</strong>
          <button class="icon-button" type="button" data-action="modal-close" aria-label="${copy.close}">x</button>
        </header>
        <p>${copy.chooseHandoffIntro}</p>
        <div class="thread-list">
          ${viewState.threads
            .map(
              (thread, index) =>
                `<button type="button" data-action="choose-thread-${index}" aria-pressed="${index === viewState.selectedIndex}">
                  <strong>${escapeHtml(thread.title)}</strong>
                  <span>${escapeHtml(threadChoiceSummary(thread, copy))}</span>
                </button>`
            )
            .join("")}
        </div>
      </section>
    </div>`;
  }

  if (modal.kind === "choose-crystal") {
    return `<div class="modal-backdrop" role="presentation">
      <section class="modal" role="dialog" aria-modal="true" aria-label="${copy.chooseCrystalTitle}">
        <header class="modal-header">
          <strong>${copy.chooseCrystalTitle}</strong>
          <button class="icon-button" type="button" data-action="modal-close" aria-label="${copy.close}">x</button>
        </header>
        <p>${copy.chooseCrystalIntro}</p>
        <div class="thread-list">
          ${viewState.crystals
            .map(
              (crystal, index) =>
                `<button type="button" data-action="choose-crystal-${index}" aria-pressed="${index === viewState.selectedCrystalIndex}">
                  <strong>${escapeHtml(crystal.title)}</strong>
                  <span>${escapeHtml(crystalChoiceSummary(crystal, copy))}</span>
                  <small>${escapeHtml(crystalPreview(crystal))}</small>
                </button>`
            )
            .join("")}
        </div>
      </section>
    </div>`;
  }

  if (modal.kind === "warnings") {
    return `<div class="modal-backdrop" role="presentation">
      <section class="modal" role="dialog" aria-modal="true" aria-label="${copy.validationWarningTitle}">
        <header class="modal-header">
          <strong>${escapeHtml(modal.title)}</strong>
          <button class="icon-button" type="button" data-action="modal-close" aria-label="${copy.close}">x</button>
        </header>
        <p>${escapeHtml(modal.message)}</p>
        <div class="modal-warnings">
          <ul>${modal.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>
        </div>
        <footer class="modal-actions">
          <button type="button" data-action="modal-copy">${copy.continueCopy}</button>
          <button type="button" data-action="modal-download">${copy.continueDownload}</button>
          <button type="button" data-action="modal-vault">${copy.continueSave}</button>
        </footer>
      </section>
    </div>`;
  }

  if (modal.kind === "vault-picker") {
    const selectedKeys = selectedVaultObjectKeys();
    const targetLabel = vaultTargetLabel(copy);
    const canUseSelection = canUseVaultSelection(selectedKeys);

    return `<div class="modal-backdrop" role="presentation">
      <section class="modal modal--wide" role="dialog" aria-modal="true" aria-label="${copy.browseVaultObjects}">
        <header class="modal-header">
          <div>
            <strong>${copy.browseVaultObjects}</strong>
            <span>${escapeHtml(copy.browseVaultObjectsHint)}</span>
          </div>
          <button class="icon-button" type="button" data-action="modal-close" aria-label="${copy.close}">x</button>
        </header>
        <div class="vault-picker-search">
          <label>
            <span>${escapeHtml(copy.searchVaultObjects)}</span>
            <input type="search" data-action="vault-search" value="${escapeAttribute(viewState.vaultBrowseQuery)}" placeholder="${escapeAttribute(
              copy.searchVaultObjects
            )}" />
          </label>
        </div>
        <div class="vault-picker-body">
          <aside class="vault-folder-tree" aria-label="${escapeAttribute(copy.vaultFolders)}">
            <strong>${escapeHtml(copy.vaultFolders)}</strong>
            ${renderVaultFolderTree()}
          </aside>
          <div class="vault-picker-results">
            ${renderVaultObjectGroup(copy.allVaultObjects, viewState.vaultObjects, selectedKeys)}
          </div>
        </div>
        <footer class="modal-actions">
          <button type="button" data-action="clear-vault-selection">${copy.clearSelection}</button>
          <button class="modal-primary-action" type="button" data-action="feed-selected-vault-object" ${canUseSelection ? "" : "disabled"}>${escapeHtml(
            copy.attachSelectedToTarget(selectedKeys.length, targetLabel)
          )}</button>
        </footer>
      </section>
    </div>`;
  }

  if (modal.kind === "feishu-category") {
    const recentCategories = uniqueCategoryPaths(viewState.recentCategoryPaths);
    const recentOptions = recentCategories.map((path) => `<option value="${escapeAttribute(path)}"></option>`).join("");
    const recentButtons = recentCategories
      .map(
        (path) =>
          `<button type="button" data-action="feishu-use-category-${escapeAttribute(encodeURIComponent(path))}">
            <span>${escapeHtml(path)}</span>
          </button>`
      )
      .join("");

    return `<div class="modal-backdrop" role="presentation">
      <section class="modal" role="dialog" aria-modal="true" aria-label="${escapeAttribute(copy.feishuCategoryDialogTitle)}">
        <header class="modal-header">
          <div>
            <strong>${escapeHtml(copy.feishuCategoryDialogTitle)}</strong>
            <span>${escapeHtml(copy.feishuCategoryDialogHint)}</span>
          </div>
          <button class="icon-button" type="button" data-action="modal-close" aria-label="${copy.close}">x</button>
        </header>
        <div class="feishu-category-dialog">
          <label class="feishu-category-field">
            <span>${escapeHtml(copy.feishuCategoryInput)}</span>
            <input type="text" value="${escapeAttribute(viewState.wikiCategoryPath)}" list="noos-feishu-category-dialog-list" data-feishu-category-dialog-input="true" placeholder="projects/noos-shuttle/design" autofocus />
            <datalist id="noos-feishu-category-dialog-list">${recentOptions}</datalist>
          </label>
          ${
            viewState.state === "warning" && viewState.message === copy.feishuCategoryRequired
              ? `<p class="feishu-category-warning">${escapeHtml(viewState.message)}</p>`
              : ""
          }
          ${
            recentButtons
              ? `<div class="recent-category-list" aria-label="${escapeAttribute(copy.feishuRecentCategories)}">
                  <strong>${escapeHtml(copy.feishuRecentCategories)}</strong>
                  ${recentButtons}
                </div>`
              : ""
          }
        </div>
        <footer class="modal-actions">
          <button type="button" data-action="modal-close">${copy.cancel}</button>
          <button class="modal-primary-action" type="button" data-action="feishu-confirm-category">${copy.feishuUseCategory}</button>
        </footer>
      </section>
    </div>`;
  }

  if (modal.kind === "confirm-feishu-overwrite") {
    return `<div class="modal-backdrop" role="presentation">
      <section class="modal" role="dialog" aria-modal="true" aria-label="${escapeAttribute(copy.feishuOverwriteConfirmTitle)}">
        <header class="modal-header">
          <strong>${escapeHtml(copy.feishuOverwriteConfirmTitle)}</strong>
          <button class="icon-button" type="button" data-action="modal-close" aria-label="${copy.close}">x</button>
        </header>
        <p>${escapeHtml(copy.feishuOverwriteConfirmMessage)}</p>
        <footer class="modal-actions">
          <button type="button" data-action="modal-close">${copy.cancel}</button>
          <button class="modal-danger-action" type="button" data-action="confirm-feishu-overwrite">${copy.feishuOverwriteCurrentDocument}</button>
        </footer>
      </section>
    </div>`;
  }

  return `<div class="modal-backdrop" role="presentation">
    <section class="modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(modal.title)}">
      <header class="modal-header">
        <strong>${escapeHtml(modal.title)}</strong>
        <button class="icon-button" type="button" data-action="modal-close" aria-label="${copy.close}">x</button>
      </header>
      <p>${escapeHtml(modal.message)}</p>
      ${renderSuccessModalActions(modal.actions, copy)}
    </section>
  </div>`;
}

function renderSuccessModalActions(actions: ModalAction[] | undefined, copy: (typeof COPY)[ShuttleLocale]): string {
  const modalActions = actions?.length ? actions : [{ label: copy.ok, action: "modal-close" }];
  return `<footer class="modal-actions">
    ${modalActions
      .map((action) => {
        const className = action.primary ? "modal-primary-action" : "";
        const testId = action.testId ? ` data-modal-test-id="${escapeAttribute(action.testId)}"` : "";
        if (action.href) {
          return `<a class="${className}" href="${escapeAttribute(action.href)}" target="_blank" rel="noopener noreferrer"${testId}>${escapeHtml(
            action.label
          )}</a>`;
        }
        return `<button class="${className}" type="button" data-action="${escapeAttribute(action.action || "modal-close")}"${testId}>${escapeHtml(
          action.label
        )}</button>`;
      })
      .join("")}
  </footer>`;
}

function renderVaultFolderTree(): string {
  const folders = viewState.vaultFolders.length
    ? viewState.vaultFolders
    : [
        { id: "latest", label: "Latest", kind: "system" },
        { id: "handoffs", label: "Handoffs", kind: "group" },
        { id: "crystals", label: "Crystals", kind: "group" },
        { id: "results", label: "Results", kind: "group" }
      ];

  return `<div class="vault-folder-list">
    ${folders
      .map((folder) => {
        const selected = folder.id === viewState.vaultBrowseFolder;
        const depth = folder.id.includes("/") ? 1 : 0;
        return `<button type="button" data-action="set-vault-folder-${escapeAttribute(
          encodeURIComponent(folder.id)
        )}" data-depth="${depth}" aria-pressed="${selected}">
          <span>${escapeHtml(folder.label)}</span>
        </button>`;
      })
      .join("")}
  </div>`;
}

async function handleAction(action: string, app: HTMLElement): Promise<void> {
  const copy = COPY[viewState.locale];

  if (action === "modal-close") {
    viewState.modal = null;
    render(app);
    return;
  }

  if (action.startsWith("choose-thread-")) {
    viewState.selectedIndex = Number(action.replace("choose-thread-", ""));
    viewState.modal = null;
    updateStateForSelection();
    captureContextPackForSelectedThread();
    const selectedThread = viewState.threads[viewState.selectedIndex];
    viewState.message = selectedThread?.warnings.length ? copy.capturedWithWarnings : copy.captured;
    openSurfacePanel();
    if (selectedThread?.warnings.length) {
      showValidationModal(selectedThread);
    }
    render(app);
    return;
  }

  if (action.startsWith("choose-crystal-")) {
    viewState.selectedCrystalIndex = Number(action.replace("choose-crystal-", ""));
    viewState.modal = null;
    await deliverSelectedCrystal(app);
    return;
  }

  if (action.startsWith("select-vault-object-")) {
    toggleVaultObjectSelection(action.replace("select-vault-object-", ""));
    renderPreservingPopoverScroll(app);
    return;
  }

  if (action === "open-vault-picker") {
    viewState.modal = { kind: "vault-picker" };
    render(app);
    void refreshVaultObjects(app, { preserveSelection: true });
    return;
  }

  if (action.startsWith("set-vault-folder-")) {
    viewState.vaultBrowseFolder = decodeURIComponent(action.replace("set-vault-folder-", ""));
    await refreshVaultObjects(app, { preserveSelection: true });
    return;
  }

  if (action === "clear-vault-selection") {
    viewState.selectedVaultObjectKeys = [];
    render(app);
    return;
  }

  if (action === "modal-copy" || action === "modal-download" || action === "modal-vault") {
    viewState.modal = null;
    const mode = action === "modal-copy" ? "copy" : action === "modal-download" ? "download" : "vault";
    await deliverSelectedThread(mode, app);
    return;
  }

  if (action === "close") {
    closePanels();
    render(app);
    return;
  }

  if (action === "surface-back") {
    openGlobalPanel();
    render(app);
    void refreshVaultStatus(app);
    void refreshVaultObjects(app);
    return;
  }

  if (action === "select-thread") {
    const select = app.querySelector<HTMLSelectElement>("select[data-action='select-thread']");
    viewState.selectedIndex = Number(select?.value ?? 0);
    updateStateForSelection();
    render(app);
    return;
  }

  if (action.startsWith("delivery-")) {
    const mode = parseDeliveryMode(action.replace("delivery-", ""));
    if (mode) {
      toggleDeliveryMode(mode);
      storeDeliveryModes(viewState.deliveryModes);
    }
    render(app);
    return;
  }

  if (action === "settings") {
    viewState.settingsOpen = !viewState.settingsOpen;
    render(app);
    return;
  }

  if (action === "locale-zh" || action === "locale-en") {
    const locale = action === "locale-zh" ? "zh" : "en";
    viewState.locale = locale;
    storeLocale(locale);
    viewState.message = COPY[locale].ready;
    viewState.modal = null;
    render(app);
    return;
  }

  if (action === "cancel-wait") {
    cancelActiveWait();
    viewState.state = "idle";
    viewState.message = copy.waitCancelled;
    render(app);
    return;
  }

  if (action === "refresh-vault") {
    await refreshVaultStatus(app);
    return;
  }

  if (action === "refresh-vault-objects") {
    await refreshVaultObjects(app);
    return;
  }

  if (action === "feed-selected-vault-object") {
    await feedSelectedVaultObject(app);
    return;
  }

  if (action === "feishu-export-organize") {
    await runFeishuAction(app, "export_md_and_organize");
    return;
  }

  if (action === "feishu-export-md") {
    await runFeishuAction(app, "export_md");
    return;
  }

  if (action === "feishu-change-category") {
    viewState.modal = { kind: "feishu-category" };
    render(app);
    return;
  }

  if (action === "feishu-confirm-category") {
    await confirmFeishuCategory(app, readFeishuCategoryDialogInput(app));
    return;
  }

  if (action.startsWith("feishu-use-category-")) {
    await confirmFeishuCategory(app, normalizeFeishuCategoryPath(decodeURIComponent(action.replace("feishu-use-category-", ""))));
    return;
  }

  if (action === "feishu-organize-wiki") {
    await runFeishuAction(app, "organize_wiki");
    return;
  }

  if (action === "feishu-open-markdown-folder") {
    await runFeishuAction(app, "open_markdown_folder");
    return;
  }

  if (action === "feishu-modal-open-markdown-folder") {
    viewState.modal = null;
    await runFeishuAction(app, "open_markdown_folder");
    return;
  }

  if (action === "feishu-open-wiki-folder") {
    await runFeishuAction(app, "open_wiki_folder");
    return;
  }

  if (action === "feishu-select-markdown") {
    vaultFeedTarget = "feishu_publish";
    viewState.selectedVaultObjectKeys = viewState.selectedPublishSource ? [vaultObjectKey(viewState.selectedPublishSource)].filter(Boolean) : [];
    viewState.message = copy.feishuSelectMarkdown;
    openGlobalPanel();
    viewState.modal = { kind: "vault-picker" };
    render(app);
    await refreshVaultObjects(app, { preserveSelection: true });
    return;
  }

  if (action === "feishu-publish-new") {
    await runFeishuPublish(app, "create");
    return;
  }

  if (action === "feishu-overwrite-current") {
    if (!viewState.selectedPublishSource) {
      viewState.message = copy.feishuPublishNeedsSource;
      openSurfacePanel();
      render(app);
      return;
    }
    viewState.modal = { kind: "confirm-feishu-overwrite" };
    render(app);
    return;
  }

  if (action === "confirm-feishu-overwrite") {
    viewState.modal = null;
    await runFeishuPublish(app, "overwrite");
    return;
  }

  if (action === "generate-capture") {
    await generateAndCollect(app);
    return;
  }

  if (action === "generate-crystal") {
    await generateAndCollectCrystal(app);
    return;
  }

  if (action === "generate") {
    cancelActiveWait();
    const inserted = insertIntoChatInput(createGenerateThreadPrompt(window.location.href, viewState.locale));
    viewState.state = inserted ? "prompt-ready" : "error";
    closePanels();
    viewState.message = inserted ? copy.promptInserted : copy.inputNotFound;
    render(app);
    if (inserted) {
      const sent = await submitChatInput();
      viewState.message = sent ? copy.promptSent : copy.sendNotFound;
      render(app);
    }
    return;
  }

  if (action === "capture") {
    cancelActiveWait();
    applyManualCapture();
    openSurfacePanel();
    render(app);
    return;
  }

  if (action === "capture-crystal") {
    cancelActiveWait();
    applyManualCrystalCapture();
    openSurfacePanel();
    render(app);
    return;
  }

  if (action === "download-images") {
    await downloadGeneratedImages(app);
    return;
  }

  const selectedThread = viewState.threads[viewState.selectedIndex];
  if (!selectedThread) {
    viewState.state = "error";
    viewState.message = copy.captureBeforeDelivery;
    render(app);
    return;
  }

  if (action === "copy") {
    await deliverSelectedThread("copy", app);
    return;
  }

  if (action === "download") {
    await deliverSelectedThread("download", app);
    return;
  }

  if (action === "vault") {
    await deliverSelectedThread("vault", app);
  }
}

async function generateAndCollect(app: HTMLElement): Promise<void> {
  const copy = COPY[viewState.locale];
  const baselineBegin = newestMarkerBegin(captureNoosThreads(getPageText()).threads);
  const inserted = insertIntoChatInput(createGenerateThreadPrompt(window.location.href, viewState.locale));

  if (!inserted) {
    viewState.state = "error";
    viewState.message = copy.inputNotFound;
    render(app);
    return;
  }

  cancelActiveWait();
  viewState.state = "waiting";
  closePanels();
  viewState.message = copy.waitingForHandoff;
  render(app);

  const sent = await submitChatInput();
  if (!sent) {
    viewState.message = copy.sendNotFound;
    render(app);
    return;
  }

  viewState.message = copy.generationSubmitted;
  render(app);
  waitForGeneratedHandoff(app, baselineBegin);
}

async function generateAndCollectCrystal(app: HTMLElement): Promise<void> {
  const copy = COPY[viewState.locale];
  const baselineBegin = newestCrystalMarkerBegin(captureNoosCrystals(getPageText()).crystals);
  const inserted = insertIntoChatInput(createGenerateCrystalPrompt(window.location.href, viewState.locale));

  if (!inserted) {
    viewState.state = "error";
    viewState.message = copy.inputNotFound;
    render(app);
    return;
  }

  cancelActiveWait();
  viewState.state = "waiting";
  closePanels();
  viewState.message = copy.waitingForCrystal;
  render(app);

  const sent = await submitChatInput();
  if (!sent) {
    viewState.message = copy.sendNotFound;
    render(app);
    return;
  }

  viewState.message = copy.crystalSubmitted;
  render(app);
  waitForGeneratedCrystal(app, baselineBegin);
}

function applyManualCapture(): void {
  const copy = COPY[viewState.locale];
  const result = captureNoosThreads(getPageText());
  viewState.threads = [...result.threads].reverse();
  viewState.selectedIndex = 0;
  viewState.contextPack = null;

  if (viewState.threads.length === 0) {
    viewState.state = "error";
    viewState.message = result.errors[0] ?? copy.noThreadDetected;
  } else if (viewState.threads.length > 1) {
    viewState.state = "needs-choice";
    viewState.message = copy.chooseDetected(viewState.threads.length);
    viewState.modal = { kind: "choose-thread" };
  } else {
    updateStateForSelection();
    const selectedThread = viewState.threads[0];
    captureContextPackForSelectedThread();
    viewState.message = selectedThread.warnings.length > 0 ? copy.capturedWithWarnings : copy.captured;
    if (selectedThread.warnings.length > 0) {
      showValidationModal(selectedThread);
    }
  }
}

function applyManualCrystalCapture(): void {
  const copy = COPY[viewState.locale];
  const result = captureNoosCrystals(getPageText());
  viewState.crystals = [...result.crystals].reverse();
  viewState.selectedCrystalIndex = 0;

  if (viewState.crystals.length === 0) {
    viewState.state = "error";
    viewState.message = result.errors[0] ?? copy.noCrystalDetected;
    return;
  }

  const selected = result.crystals[viewState.selectedCrystalIndex];
  viewState.state = selected.warnings.length ? "warning" : "captured";
  viewState.message = selected.warnings.length ? copy.crystalCapturedWithWarnings : copy.crystalCaptured;
  viewState.modal = { kind: "choose-crystal" };
}

async function downloadGeneratedImages(app: HTMLElement): Promise<void> {
  const copy = COPY[viewState.locale];
  const images = await collectGeneratedImages();
  if (images.length === 0) {
    viewState.state = "warning";
    openSurfacePanel();
    viewState.message = copy.noGeneratedImagesDetected;
    viewState.modal = {
      kind: "warnings",
      title: copy.deliveryIssueTitle,
      message: copy.noGeneratedImagesDetected,
      warnings: [copy.noGeneratedImagesDetected]
    };
    render(app);
    return;
  }

  const directory = `chatgpt-images/${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${slugifyProjectSourceText(document.title || "chatgpt-images")}`;
  let response: { ok?: boolean; location?: string; message?: string; count?: number };
  try {
    response = await sendExtensionMessage<
      { type: "NOOS_DOWNLOAD_ARTIFACTS"; directory: string; files: Array<{ filename: string; url: string }> },
      { ok?: boolean; location?: string; message?: string; count?: number }
    >({
      type: "NOOS_DOWNLOAD_ARTIFACTS",
      directory,
      files: images.map((image) => ({ filename: image.filename, url: image.url }))
    });
  } catch (error) {
    response = {
      ok: false,
      message: error instanceof Error ? error.message : copy.vaultUnavailable
    };
  }

  if (!response.ok) {
    viewState.state = "error";
    openSurfacePanel();
    viewState.message = response.message ?? copy.vaultUnavailable;
    render(app);
    return;
  }

  const location = response.location || `Downloads/NOOS/vault/artifacts/files/${directory}`;
  viewState.state = "saved";
  openSurfacePanel();
  viewState.message = copy.imagesDownloaded(response.count ?? images.length, location);
  viewState.modal = {
    kind: "success",
    title: copy.deliverySuccessTitle,
    message: viewState.message
  };
  render(app);
}

async function collectGeneratedImages(): Promise<GeneratedImageArtifact[]> {
  const scope = findGeneratedImageScope();
  if (!scope) {
    return [];
  }

  const candidates = Array.from(scope.querySelectorAll<HTMLImageElement>("img"));
  const images: GeneratedImageArtifact[] = [];
  const seen = new Set<string>();

  for (const image of candidates) {
    const src = image.currentSrc || image.src;
    if (!src || src.startsWith("chrome-extension://")) {
      continue;
    }
    const width = image.naturalWidth || Math.round(image.getBoundingClientRect().width);
    const height = image.naturalHeight || Math.round(image.getBoundingClientRect().height);
    if (!isLikelyGeneratedImage(image, width, height)) {
      continue;
    }

    const downloadableUrl = await imageDownloadUrl(src);
    if (!downloadableUrl || seen.has(downloadableUrl)) {
      continue;
    }
    seen.add(downloadableUrl);

    images.push({
      filename: createGeneratedImageFilename(image, images.length + 1, downloadableUrl),
      url: downloadableUrl,
      sourceUrl: src,
      width,
      height
    });
  }

  return images.slice(0, 20);
}

function findGeneratedImageScope(): ParentNode | null {
  const dialog = Array.from(document.querySelectorAll<HTMLElement>("[role='dialog']"))
    .filter((candidate) => candidate.querySelector("img") && isDocumentElementVisible(candidate))
    .sort((a, b) => scoreImageScope(b) - scoreImageScope(a))[0];
  if (dialog) {
    return dialog;
  }

  const selectionScope = selectedReplyScope();
  if (selectionScope?.querySelector("img")) {
    return selectionScope;
  }

  const replyScopes = Array.from(
    document.querySelectorAll<HTMLElement>(
      [
        "article",
        "[data-message-author-role]",
        "[data-testid*='conversation-turn']",
        "[role='article']",
        "main section"
      ].join(",")
    )
  )
    .filter((candidate) => !candidate.closest("#noos-shuttle-root") && candidate.querySelector("img"))
    .filter((candidate, index, all) => !all.some((other, otherIndex) => otherIndex !== index && other !== candidate && other.contains(candidate)))
    .sort((a, b) => scoreImageScope(b) - scoreImageScope(a));

  return replyScopes[0] ?? null;
}

function selectedReplyScope(): HTMLElement | null {
  const selection = window.getSelection();
  const node = selection?.anchorNode;
  const element = node instanceof Element ? node : node?.parentElement;
  if (!element || element.closest("#noos-shuttle-root")) {
    return null;
  }
  return element.closest<HTMLElement>(
    [
      "article",
      "[data-message-author-role]",
      "[data-testid*='conversation-turn']",
      "[role='article']",
      "main section"
    ].join(",")
  );
}

function scoreImageScope(element: HTMLElement): number {
  const rect = element.getBoundingClientRect();
  const viewportHeight = Math.max(document.documentElement.clientHeight, window.innerHeight || 0);
  const viewportCenter = viewportHeight / 2;
  const elementCenter = rect.top + rect.height / 2;
  const visibleHeight = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
  const visibleRatio = rect.height > 0 ? visibleHeight / Math.min(rect.height, viewportHeight) : 0;
  const distanceScore = Math.max(0, viewportHeight - Math.abs(elementCenter - viewportCenter));
  const imageCount = element.querySelectorAll("img").length;
  return visibleRatio * 10_000 + distanceScore + imageCount * 10;
}

function isLikelyGeneratedImage(image: HTMLImageElement, width: number, height: number): boolean {
  if (width < 256 || height < 256) {
    return false;
  }
  const rect = image.getBoundingClientRect();
  const hasLargeNaturalSize = (image.naturalWidth || 0) >= 256 && (image.naturalHeight || 0) >= 256;
  if (!hasLargeNaturalSize && (rect.width < 120 || rect.height < 120)) {
    return false;
  }
  const alt = `${image.alt ?? ""} ${image.getAttribute("aria-label") ?? ""}`.toLowerCase();
  if (/avatar|profile|icon|logo|用户头像|头像/.test(alt)) {
    return false;
  }
  return true;
}

async function imageDownloadUrl(src: string): Promise<string | null> {
  if (src.startsWith("data:")) {
    return src;
  }
  if (src.startsWith("blob:")) {
    return blobUrlToDataUrl(src);
  }
  if (/^https?:\/\//i.test(src)) {
    return src;
  }
  try {
    return new URL(src, location.href).href;
  } catch {
    return null;
  }
}

async function blobUrlToDataUrl(src: string): Promise<string | null> {
  try {
    const response = await fetch(src);
    const blob = await response.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function createGeneratedImageFilename(image: HTMLImageElement, index: number, url: string): string {
  const alt = image.alt || image.getAttribute("aria-label") || document.title || "chatgpt-image";
  const extension = imageExtensionFromUrl(url) || "png";
  return `${String(index).padStart(2, "0")}-${slugifyProjectSourceText(alt)}.${extension}`;
}

function imageExtensionFromUrl(url: string): string | null {
  if (url.startsWith("data:image/")) {
    const match = url.match(/^data:image\/([a-zA-Z0-9.+-]+)[;,]/);
    return normalizeImageExtension(match?.[1]);
  }
  try {
    const path = new URL(url).pathname;
    const match = path.match(/\.([a-zA-Z0-9]+)$/);
    return normalizeImageExtension(match?.[1]);
  } catch {
    return null;
  }
}

function normalizeImageExtension(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.toLowerCase().replace("jpeg", "jpg").replace("svg+xml", "svg");
  return /^(png|jpg|webp|gif|svg|avif)$/.test(normalized) ? normalized : null;
}

function waitForGeneratedHandoff(app: HTMLElement, baselineBegin: number): void {
  const copy = COPY[viewState.locale];
  let retryTimerId: number | null = null;

  const tryCapture = (): boolean => {
    const result = captureNoosThreads(getPageText());
    const candidate = findNewestThreadAfter(result.threads, baselineBegin);
    if (!candidate) {
      return false;
    }

    const selectedIndex = result.threads.indexOf(candidate);
    viewState.threads = result.threads;
    viewState.selectedIndex = selectedIndex;
    updateStateForSelection();
    captureContextPackForSelectedThread();
    const deliveryModes = activeDeliveryModes();
    viewState.message =
      candidate.warnings.length > 0 && deliveryModes.length > 0 ? copy.autoDeliverySkipped : candidate.warnings.length > 0 ? copy.capturedWithWarnings : copy.captured;
    openSurfacePanel();
    cancelActiveWait();
    if (candidate.warnings.length > 0) {
      showValidationModal(candidate);
      render(app);
    } else if (deliveryModes.length > 0) {
      void deliverSelectedThreads(deliveryModes, app);
    } else {
      viewState.modal = { kind: "success", title: copy.deliverySuccessTitle, message: copy.captured };
      openSurfacePanel();
      render(app);
    }
    return true;
  };

  const retryCapture = () => {
    if (!activeWait) {
      return;
    }
    if (tryCapture()) {
      return;
    }
    retryTimerId = window.setTimeout(retryCapture, CAPTURE_RETRY_MS);
    if (activeWait) {
      activeWait.retryTimerId = retryTimerId;
    }
  };

  let quietTimerId: number | null = null;
  let hasStartedGenerating = false;

  const completeAfterQuietPeriod = () => {
    if (!activeWait || !hasStartedGenerating || isChatbotGenerating()) {
      return;
    }

    if (quietTimerId !== null) {
      return;
    }
    quietTimerId = window.setTimeout(() => {
      if (!activeWait || isChatbotGenerating()) {
        return;
      }
      quietTimerId = null;
      if (activeWait) {
        activeWait.quietTimerId = null;
      }
      viewState.message = copy.waitingForHandoff;
      render(app);
      retryCapture();
    }, GENERATION_QUIET_MS);
    if (activeWait) {
      activeWait.quietTimerId = quietTimerId;
    }
  };

  const observeGenerationState = () => {
    if (!activeWait) {
      return;
    }

    if (isChatbotGenerating()) {
      hasStartedGenerating = true;
      activeWait.hasStartedGenerating = true;
      if (quietTimerId !== null) {
        window.clearTimeout(quietTimerId);
        quietTimerId = null;
        activeWait.quietTimerId = null;
      }
      viewState.message = copy.waitingForGenerationStart;
      return;
    }

    completeAfterQuietPeriod();
  };

  const observer = new MutationObserver(() => {
    observeGenerationState();
  });
  observer.observe(document.body, { attributes: true, childList: true, subtree: true, characterData: true });
  const capturePollId = window.setInterval(() => {
    if (!activeWait) {
      return;
    }
    observeGenerationState();
  }, CAPTURE_POLL_MS);
  const fallbackStartId = window.setTimeout(() => {
    if (!activeWait || hasStartedGenerating) {
      return;
    }
    hasStartedGenerating = true;
    activeWait.hasStartedGenerating = true;
    completeAfterQuietPeriod();
  }, GENERATION_START_GRACE_MS);
  const timeoutId = window.setTimeout(() => {
    cancelActiveWait();
    viewState.state = "error";
    openSurfacePanel();
    viewState.message = copy.waitingTimedOut;
    render(app);
  }, WAIT_FOR_HANDOFF_TIMEOUT_MS);
  activeWait = { observer, timeoutId, fallbackStartId, capturePollId, quietTimerId, retryTimerId, hasStartedGenerating };
  observeGenerationState();
}

function waitForGeneratedCrystal(app: HTMLElement, baselineBegin: number): void {
  const copy = COPY[viewState.locale];
  let retryTimerId: number | null = null;

  const tryCapture = (): boolean => {
    const result = captureNoosCrystals(getPageText());
    const candidate = findNewestCrystalAfter(result.crystals, baselineBegin);
    if (!candidate) {
      return false;
    }

    viewState.crystals = result.crystals;
    viewState.selectedCrystalIndex = result.crystals.indexOf(candidate);
    viewState.state = candidate.warnings.length ? "warning" : "captured";
    viewState.message = candidate.warnings.length ? copy.crystalCapturedWithWarnings : copy.crystalCaptured;
    openSurfacePanel();
    cancelActiveWait();

    viewState.modal = { kind: "choose-crystal" };
    render(app);
    return true;
  };

  const retryCapture = () => {
    if (!activeWait) {
      return;
    }
    if (tryCapture()) {
      return;
    }
    retryTimerId = window.setTimeout(retryCapture, CAPTURE_RETRY_MS);
    if (activeWait) {
      activeWait.retryTimerId = retryTimerId;
    }
  };

  let quietTimerId: number | null = null;
  let hasStartedGenerating = false;

  const completeAfterQuietPeriod = () => {
    if (!activeWait || !hasStartedGenerating || isChatbotGenerating()) {
      return;
    }

    if (quietTimerId !== null) {
      return;
    }
    quietTimerId = window.setTimeout(() => {
      if (!activeWait || isChatbotGenerating()) {
        return;
      }
      quietTimerId = null;
      if (activeWait) {
        activeWait.quietTimerId = null;
      }
      viewState.message = copy.waitingForCrystal;
      render(app);
      retryCapture();
    }, GENERATION_QUIET_MS);
    if (activeWait) {
      activeWait.quietTimerId = quietTimerId;
    }
  };

  const observeGenerationState = () => {
    if (!activeWait) {
      return;
    }
    if (isChatbotGenerating()) {
      hasStartedGenerating = true;
      activeWait.hasStartedGenerating = true;
      if (quietTimerId !== null) {
        window.clearTimeout(quietTimerId);
        quietTimerId = null;
        activeWait.quietTimerId = null;
      }
      viewState.message = copy.waitingForGenerationStart;
      return;
    }
    completeAfterQuietPeriod();
  };

  const observer = new MutationObserver(() => {
    observeGenerationState();
  });
  observer.observe(document.body, { attributes: true, childList: true, subtree: true, characterData: true });
  const capturePollId = window.setInterval(() => {
    if (!activeWait) {
      return;
    }
    observeGenerationState();
  }, CAPTURE_POLL_MS);
  const fallbackStartId = window.setTimeout(() => {
    if (!activeWait || hasStartedGenerating) {
      return;
    }
    hasStartedGenerating = true;
    activeWait.hasStartedGenerating = true;
    completeAfterQuietPeriod();
  }, GENERATION_START_GRACE_MS);
  const timeoutId = window.setTimeout(() => {
    cancelActiveWait();
    viewState.state = "error";
    openSurfacePanel();
    viewState.message = copy.waitingTimedOut;
    render(app);
  }, WAIT_FOR_HANDOFF_TIMEOUT_MS);
  activeWait = { observer, timeoutId, fallbackStartId, capturePollId, quietTimerId, retryTimerId, hasStartedGenerating };
  observeGenerationState();
}

function cancelActiveWait(): void {
  if (!activeWait) {
    return;
  }

  activeWait.observer.disconnect();
  window.clearTimeout(activeWait.timeoutId);
  window.clearTimeout(activeWait.fallbackStartId);
  window.clearInterval(activeWait.capturePollId);
  if (activeWait.quietTimerId !== null) {
    window.clearTimeout(activeWait.quietTimerId);
  }
  if (activeWait.retryTimerId !== null) {
    window.clearTimeout(activeWait.retryTimerId);
  }
  activeWait = null;
}

function newestMarkerBegin(threads: NoosThread[]): number {
  return threads.reduce((max, thread) => Math.max(max, thread.markerRange.begin), -1);
}

function newestCrystalMarkerBegin(crystals: NoosCrystal[]): number {
  return crystals.reduce((max, crystal) => Math.max(max, crystal.markerRange.begin), -1);
}

function findNewestThreadAfter(threads: NoosThread[], baselineBegin: number): NoosThread | undefined {
  for (let index = threads.length - 1; index >= 0; index -= 1) {
    if (threads[index].markerRange.begin > baselineBegin) {
      return threads[index];
    }
  }

  return undefined;
}

function findNewestCrystalAfter(crystals: NoosCrystal[], baselineBegin: number): NoosCrystal | undefined {
  for (let index = crystals.length - 1; index >= 0; index -= 1) {
    if (crystals[index].markerRange.begin > baselineBegin) {
      return crystals[index];
    }
  }

  return undefined;
}

function installConversationWatcher(app: HTMLElement): void {
  if (conversationWatcherInstalled) {
    return;
  }

  conversationWatcherInstalled = true;
  const scheduleContextCheck = () => {
    if (pageContextDebounceId !== null) {
      window.clearTimeout(pageContextDebounceId);
    }
    pageContextDebounceId = window.setTimeout(() => {
      pageContextDebounceId = null;
      checkPageContext(app);
    }, PAGE_CONTEXT_DEBOUNCE_MS);
  };

  wrapHistoryMethod("pushState", scheduleContextCheck);
  wrapHistoryMethod("replaceState", scheduleContextCheck);
  window.addEventListener("popstate", scheduleContextCheck);
  window.addEventListener("hashchange", scheduleContextCheck);
  window.addEventListener("focus", scheduleContextCheck);
  window.addEventListener("pageshow", scheduleContextCheck);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      scheduleContextCheck();
    }
  });
  window.addEventListener("pagehide", () => cancelActiveWait());
  window.setInterval(() => checkPageContext(app), PAGE_CONTEXT_POLL_MS);
}

function installProjectImportBridge(app: HTMLElement): void {
  if (projectImportBridgeInstalled || !location.hostname.endsWith("chatgpt.com")) {
    return;
  }

  projectImportBridgeInstalled = true;
  const refresh = () => upsertProjectImportButton(app);
  refresh();
  const observer = new MutationObserver(() => window.setTimeout(refresh, 100));
  observer.observe(document.body, { childList: true, subtree: true });
}

function upsertProjectImportButton(app: HTMLElement): void {
  const existing = document.querySelector<HTMLButtonElement>(".noos-project-import-button");
  const existingExport = document.querySelector<HTMLButtonElement>(".noos-project-export-sources-button");
  if (!isChatGptProjectLikePage()) {
    existing?.remove();
    existingExport?.remove();
    return;
  }

  const anchor = findProjectSourceAnchor();
  if (!anchor) {
    existing?.remove();
    existingExport?.remove();
    return;
  }

  const button = existing ?? document.createElement("button");
  button.type = "button";
  button.className = "noos-project-import-button";
  button.textContent = COPY[viewState.locale].importFromNoos;
  button.setAttribute("aria-label", COPY[viewState.locale].importFromNoos);
  Object.assign(button.style, {
    marginLeft: "8px",
    minHeight: "30px",
    padding: "0 10px",
    border: "1px solid rgba(36, 90, 120, 0.35)",
    borderRadius: "6px",
    background: "#245a78",
    color: "#ffffff",
    cursor: "pointer",
    font: "700 12px/1.2 system-ui, sans-serif",
    verticalAlign: "middle",
    zIndex: "2147483646"
  });
  button.onclick = () => {
    currentPageContext = getPageContext();
    vaultFeedTarget = "project";
    preferredVaultAttachRoot = findProjectSourceRoot(anchor);
    openGlobalPanel();
    viewState.message = COPY[viewState.locale].importFromNoos;
    render(app);
    void refreshVaultObjects(app);
  };

  if (!existing || button.previousElementSibling !== anchor) {
    anchor.insertAdjacentElement("afterend", button);
  }

  const exportButton = existingExport ?? document.createElement("button");
  exportButton.type = "button";
  exportButton.className = "noos-project-export-sources-button";
  exportButton.textContent = COPY[viewState.locale].exportProjectSources;
  exportButton.setAttribute("aria-label", COPY[viewState.locale].exportProjectSources);
  Object.assign(exportButton.style, {
    marginLeft: "8px",
    minHeight: "30px",
    padding: "0 10px",
    border: "1px solid rgba(132, 75, 30, 0.4)",
    borderRadius: "6px",
    background: "#8a4b1f",
    color: "#ffffff",
    cursor: "pointer",
    font: "700 12px/1.2 system-ui, sans-serif",
    verticalAlign: "middle",
    zIndex: "2147483646"
  });
  exportButton.onclick = () => {
    void exportProjectSourcesToNoos(app, findProjectSourceRoot(anchor));
  };

  if (!existingExport || exportButton.previousElementSibling !== button) {
    button.insertAdjacentElement("afterend", exportButton);
  }
}

function findProjectSourceAnchor(): HTMLElement | null {
  const explicitSourceControls = Array.from(
    document.querySelectorAll<HTMLElement>("button,h1,h2,h3,[role='heading'],[role='tab'],label")
  );
  const sourceAreaControls = explicitSourceControls.filter(isProjectSourceAnchorCandidate);
  const preferredControl =
    sourceAreaControls.find((candidate) => /^(add source|添加来源)$/i.test(normalizeVisibleText(candidate))) ??
    sourceAreaControls.find((candidate) => /^(project sources|sources|来源)$/i.test(normalizeVisibleText(candidate))) ??
    sourceAreaControls[0];

  if (preferredControl) {
    return preferredControl;
  }

  return (
    Array.from(document.querySelectorAll<HTMLElement>("[role='tabpanel'],section,article,form"))
      .filter(isProjectSourceContainerCandidate)
      .sort((a, b) => scoreProjectSourceContainer(b) - scoreProjectSourceContainer(a))[0] ?? null
  );
}

function findProjectSourceRoot(anchor: HTMLElement): HTMLElement {
  return (
    anchor.closest<HTMLElement>("[role='tabpanel'],section, article, form, [role='region']") ??
    anchor.closest<HTMLElement>("main") ??
    anchor.parentElement ??
    document.body
  );
}

function isChatGptProjectLikePage(): boolean {
  return location.hostname.endsWith("chatgpt.com") && /(^|\/)(g|project|projects)(\/|$)/i.test(location.pathname);
}

function isDocumentElementVisible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
}

function isProjectSourceAnchorCandidate(element: HTMLElement): boolean {
  if (element.closest("#noos-shuttle-root") || element.closest(".noos-project-import-button,.noos-project-export-sources-button")) {
    return false;
  }

  if (!isDocumentElementVisible(element)) {
    return false;
  }

  const text = normalizeVisibleText(element);
  if (text.length === 0 || text.length > 64) {
    return false;
  }

  if (!/(project sources|sources|source|knowledge|add source|项目文件|项目知识|来源|添加来源|提供更多背景信息)/i.test(text)) {
    return false;
  }

  return isInsideLikelyProjectMainArea(element);
}

function isProjectSourceContainerCandidate(element: HTMLElement): boolean {
  if (element.closest("#noos-shuttle-root") || element.closest(".noos-project-import-button,.noos-project-export-sources-button")) {
    return false;
  }

  if (!isDocumentElementVisible(element) || !isInsideLikelyProjectMainArea(element)) {
    return false;
  }

  const text = normalizeVisibleText(element);
  return (
    text.length > 0 &&
    text.length < 280 &&
    /(project sources|sources|knowledge|add source|项目文件|项目知识|来源|添加来源|提供更多背景信息)/i.test(text)
  );
}

function isInsideLikelyProjectMainArea(element: HTMLElement): boolean {
  if (element.closest("nav, aside, [aria-label*='历史聊天记录'], [aria-label*='History']")) {
    return false;
  }

  if (element.closest("main")) {
    return true;
  }

  const rect = element.getBoundingClientRect();
  const viewportWidth = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
  if (viewportWidth > 900 && rect.left < viewportWidth * 0.25) {
    return false;
  }

  return true;
}

function scoreProjectSourceContainer(element: HTMLElement): number {
  const text = normalizeVisibleText(element);
  let score = 0;
  if (element.querySelector("input[type='file']")) score += 6;
  if (element.matches("[role='tabpanel']")) score += 4;
  if (/添加来源|add source/i.test(text)) score += 3;
  if (/提供更多背景信息|project sources|sources/i.test(text)) score += 2;
  return score;
}

async function exportProjectSourcesToNoos(app: HTMLElement, root: HTMLElement): Promise<void> {
  const copy = COPY[viewState.locale];
  const sources = collectProjectSourceSnapshots(root);
  if (sources.length === 0) {
    viewState.state = "warning";
    openSurfacePanel();
    viewState.message = copy.noProjectSourcesDetected;
    viewState.modal = {
      kind: "warnings",
      title: copy.projectSourcesExportNeedsAttention,
      message: copy.noProjectSourcesDetected,
      warnings: [copy.noProjectSourcesDetected]
    };
    render(app);
    return;
  }

  const pack = createProjectSourcesPackage(sources);
  let response: { ok?: boolean; location?: string; message?: string };
  try {
    response = await sendExtensionMessage<
      { type: "NOOS_SAVE_CONTEXT_PACK_TO_VAULT"; directory: string; files: Array<{ path: string; content: string }>; sourceUrl?: string },
      { ok?: boolean; location?: string; message?: string }
    >({
      type: "NOOS_SAVE_CONTEXT_PACK_TO_VAULT",
      directory: pack.directory,
      files: pack.files,
      sourceUrl: window.location.href
    });
  } catch (error) {
    response = {
      ok: false,
      message: error instanceof Error ? error.message : copy.vaultUnavailable
    };
  }

  if (!response.ok) {
    viewState.state = "error";
    openSurfacePanel();
    viewState.message = response.message ?? copy.vaultUnavailable;
    viewState.modal = {
      kind: "success",
      title: copy.projectSourcesExportNeedsAttention,
      message: viewState.message
    };
    render(app);
    return;
  }

  const location = response.location || pack.directory;
  viewState.state = "saved";
  openSurfacePanel();
  viewState.message = copy.projectSourcesExported(sources.length, location);
  viewState.modal = {
    kind: "success",
    title: copy.deliverySuccessTitle,
    message: response.message ?? viewState.message
  };
  render(app);
}

function collectProjectSourceSnapshots(root: HTMLElement): ProjectSourceSnapshot[] {
  const candidates = Array.from(root.querySelectorAll<HTMLElement>("a,button,[role='button'],li,[data-testid],div,span,p"));
  const sources: ProjectSourceSnapshot[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    if (!isDocumentElementVisible(candidate) || candidate.closest("#noos-shuttle-root") || candidate.closest(".noos-project-import-button,.noos-project-export-sources-button")) {
      continue;
    }

    const text = normalizeVisibleText(candidate);
    if (!isLikelyProjectSourceText(text)) {
      continue;
    }

    const title = shortenProjectSourceTitle(text);
    const key = title.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    sources.push({
      title,
      detail: text === title ? undefined : text,
      href: candidate instanceof HTMLAnchorElement ? candidate.href : candidate.querySelector<HTMLAnchorElement>("a[href]")?.href
    });
  }

  if (sources.length > 0) {
    return sources.slice(0, 100);
  }

  return fallbackProjectSourceLines(root).map((line) => ({ title: line })).slice(0, 100);
}

function isLikelyProjectSourceText(text: string): boolean {
  if (text.length < 2 || text.length > 240) {
    return false;
  }
  if (/^(project sources|sources|source|add source|添加来源|来源|从 NOOS 导入|导出项目源到 NOOS)$/i.test(text)) {
    return false;
  }
  if (/\b(pdf|docx?|xlsx?|csv|pptx?|txt|md|markdown|json|yaml|yml|png|jpe?g|webp|gif|zip)\b/i.test(text)) {
    return true;
  }
  return /[\w\u4e00-\u9fff][\w\s\u4e00-\u9fff.-]{2,}\.(?:pdf|docx?|xlsx?|csv|pptx?|txt|md|markdown|json|yaml|yml|png|jpe?g|webp|gif|zip)\b/i.test(text);
}

function shortenProjectSourceTitle(text: string): string {
  const fileMatch = text.match(/[\w\u4e00-\u9fff][\w\s\u4e00-\u9fff()[\]{}.,+_-]{0,120}\.(?:pdf|docx?|xlsx?|csv|pptx?|txt|md|markdown|json|yaml|yml|png|jpe?g|webp|gif|zip)\b/i);
  return (fileMatch?.[0] ?? text).replace(/\s+/g, " ").trim();
}

function fallbackProjectSourceLines(root: HTMLElement): string[] {
  const ignored = /^(project sources|sources|source|add source|添加来源|来源|从 NOOS 导入|导出项目源到 NOOS|browse vault|refresh)$/i;
  const lines = normalizeVisibleText(root)
    .split(/(?<=[。.!?])\s+|\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 2 && line.length <= 160 && !ignored.test(line));
  return Array.from(new Set(lines));
}

function createProjectSourcesPackage(sources: ProjectSourceSnapshot[]): { directory: string; files: Array<{ path: string; content: string }> } {
  const capturedAt = new Date().toISOString();
  const dateSlug = capturedAt.slice(0, 10).replace(/-/g, "");
  const projectSlug = slugifyProjectSourceText(document.title || location.pathname || "chatgpt-project");
  const directory = `chatgpt-project-sources/${dateSlug}-${projectSlug}`;
  const sourceRows = sources
    .map((source, index) => `| ${index + 1} | ${escapeMarkdownTable(source.title)} | ${escapeMarkdownTable(source.href ?? "")} |`)
    .join("\n");

  return {
    directory,
    files: [
      {
        path: "README.md",
        content: `---
type: noos_project_sources_snapshot
version: 0.1
source_app: chatgpt
source_url: ${yamlScalar(location.href)}
created_at: ${yamlScalar(capturedAt)}
title: ${yamlScalar("ChatGPT Project Sources Snapshot")}
---

# ChatGPT Project Sources Snapshot

This package records the visible source items from a ChatGPT Project page.

Current limitation: ChatGPT does not expose original uploaded source file bytes through the page DOM. This snapshot preserves the visible source list, source titles, links when present, and provenance so NOOS / agents can locate or reason about the Project source set.

## Files

- \`manifest.md\`: source table and provenance.
- \`sources/*.md\`: one stub Markdown file per visible source item.
`
      },
      {
        path: "manifest.md",
        content: `---
type: noos_project_sources_manifest
version: 0.1
source_app: chatgpt
source_url: ${yamlScalar(location.href)}
created_at: ${yamlScalar(capturedAt)}
source_count: ${sources.length}
---

# Project Sources Manifest

| # | Title | URL |
|---:|---|---|
${sourceRows}
`
      },
      ...sources.map((source, index) => ({
        path: `sources/${String(index + 1).padStart(3, "0")}-${slugifyProjectSourceText(source.title)}.md`,
        content: `---
type: noos_project_source_stub
version: 0.1
source_app: chatgpt
source_url: ${yamlScalar(source.href || location.href)}
created_at: ${yamlScalar(capturedAt)}
title: ${yamlScalar(source.title)}
---

# ${source.title}

## Visible Metadata

- Source title: ${source.title}
${source.href ? `- Source URL: ${source.href}\n` : ""}${source.detail ? `- Visible detail: ${source.detail}\n` : ""}
## Capture Note

This is a NOOS stub for a ChatGPT Project source item. The browser page exposed the source entry metadata, not the original uploaded file bytes.
`
      }))
    ]
  };
}

function slugifyProjectSourceText(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[`"'’“”]/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "project-sources";
}

function escapeMarkdownTable(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function yamlScalar(value: string): string {
  return JSON.stringify(value);
}

function normalizeVisibleText(element: HTMLElement): string {
  return (element.textContent ?? "").replace(/\s+/g, " ").trim();
}

function wrapHistoryMethod(method: "pushState" | "replaceState", onChange: () => void): void {
  const original = history[method];
  history[method] = function (this: History, ...args: Parameters<History[typeof method]>) {
    const result = original.apply(this, args);
    window.setTimeout(onChange, 0);
    return result;
  } as History[typeof method];
}

function checkPageContext(app: HTMLElement): void {
  const nextContext = getPageContext();
  if (nextContext.signature === currentPageContext.signature) {
    currentPageContext = nextContext;
    upsertProjectImportButton(app);
    return;
  }

  currentPageContext = nextContext;
  resetForConversationChange(app);
}

function resetForConversationChange(app: HTMLElement): void {
  cancelActiveWait();
  closePanels();
  viewState.settingsOpen = false;
  viewState.state = "idle";
  viewState.message = COPY[viewState.locale].conversationChanged;
  viewState.threads = [];
  viewState.crystals = [];
  viewState.contextPack = null;
  viewState.selectedIndex = 0;
  viewState.selectedCrystalIndex = 0;
  viewState.modal = null;
  render(app);
  window.setTimeout(() => upsertProjectImportButton(app), 0);
}

function getPageContext(): PageContext {
  const url = new URL(window.location.href);
  const pageKind = detectPageKind(url);
  const conversationId = detectConversationId(url);
  const textFingerprint = fingerprintText(document.querySelector("main")?.textContent ?? document.body.textContent ?? "");
  const signature = [url.origin, normalizedPathname(url), conversationId, pageKind].join("|");

  return {
    href: url.href,
    origin: url.origin,
    pathname: url.pathname,
    conversationId,
    pageKind,
    textFingerprint,
    signature
  };
}

function detectConversationId(url: URL): string {
  const patterns = [
    /^\/c\/([^/?#]+)/,
    /^\/chat\/([^/?#]+)/,
    /^\/app\/[^/]+\/chat\/([^/?#]+)/,
    /^\/u\/\d+\/c\/([^/?#]+)/
  ];

  for (const pattern of patterns) {
    const match = url.pathname.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return "";
}

function detectPageKind(url: URL): PageKind {
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();
  const text = (document.querySelector("main")?.textContent ?? document.body.textContent ?? "").toLowerCase();
  const hasComposer = Boolean(document.querySelector("textarea, div[contenteditable='true'], [role='textbox']"));

  if (!isSupportedChatHost(host)) {
    return "unsupported";
  }
  if (/login|auth|signin|sign-in|oauth|登录|登入/.test(path) || /log in|sign in|sign up|登录|注册/.test(text)) {
    return "login";
  }
  if (/not found|conversation not found|unable to load|you do not have access|找不到|无法访问|没有权限/.test(text)) {
    return "unavailable";
  }
  if (detectConversationId(url)) {
    return "conversation";
  }
  if (hasComposer) {
    return "composer";
  }

  return "unknown";
}

function normalizedPathname(url: URL): string {
  const conversationId = detectConversationId(url);
  return conversationId ? url.pathname.replace(conversationId, ":conversation") : url.pathname;
}

function isSupportedChatHost(host: string): boolean {
  return [
    "chatgpt.com",
    "chat.openai.com",
    "claude.ai",
    "gemini.google.com",
    "aistudio.google.com",
    "chat.deepseek.com",
    "kimi.moonshot.cn",
    "yuanbao.tencent.com",
    "www.doubao.com",
    "chat.qwen.ai",
    "grok.com",
    "www.perplexity.ai",
    "poe.com"
  ].some((candidate) => host === candidate || host.endsWith(`.${candidate}`));
}

function getCurrentSurface(): SurfaceKind {
  if (getFeishuPageContext()) {
    return "feishu";
  }
  const host = location.hostname.toLowerCase();
  if (isSupportedChatHost(host)) {
    return "chatgpt";
  }
  return "none";
}

function getFeishuPageContext(): FeishuPageContext | null {
  const host = location.hostname.toLowerCase();
  const pathname = location.pathname;
  if (!isFeishuHost(host)) {
    return null;
  }
  if (isFeishuDocumentPage(host, pathname)) {
    return { kind: "doc", label: feishuDocumentTitle() };
  }

  const folderToken = feishuFolderTokenFromLocation();
  if (folderToken) {
    return { kind: "drive_folder", label: feishuFolderTitle(), folderToken };
  }
  if (isFeishuDriveRootPage(pathname)) {
    return { kind: "drive_root", label: COPY[viewState.locale].feishuRootFolder };
  }
  return null;
}

function isFeishuHost(host: string): boolean {
  return ["feishu.cn", "larksuite.com"].some((candidate) => host === candidate || host.endsWith(`.${candidate}`));
}

function isFeishuDocumentPage(host: string, pathname: string): boolean {
  if (!isFeishuHost(host)) {
    return false;
  }
  return /\/(docx|wiki|sheets|base|bitable)\//i.test(pathname);
}

function isFeishuDriveRootPage(pathname: string): boolean {
  return pathname === "/" || /^\/(drive|space|docs)(\/(home|my|personal|files)?)?\/?$/i.test(pathname);
}

function feishuFolderTokenFromLocation(): string | undefined {
  const pathname = location.pathname;
  const pathMatch = pathname.match(/\/(?:drive|space|docs)\/(?:folder|folders)\/([^/?#]+)/i) || pathname.match(/\/folder\/([^/?#]+)/i);
  const token = pathMatch?.[1] || new URLSearchParams(location.search).get("folder_token") || new URLSearchParams(location.search).get("folderToken");
  return token?.trim() || undefined;
}

function feishuFolderTitle(): string {
  return (
    document.querySelector<HTMLElement>("[data-noos-folder-title]")?.innerText.trim() ||
    document.querySelector<HTMLElement>("[aria-current='page']")?.textContent?.trim() ||
    feishuDocumentTitle()
  );
}

function feishuPublishDestinationKind(pageContext: FeishuPageContext, mode: FeishuPublishMode): FeishuPublishDestinationKind {
  if (mode === "overwrite") {
    return "current_doc";
  }
  if (pageContext.kind === "drive_folder") {
    return "drive_folder";
  }
  if (pageContext.kind === "drive_root") {
    return "drive_root";
  }
  return "current_doc";
}

function surfaceTitle(surface: SurfaceKind, copy: (typeof COPY)[ShuttleLocale]): string {
  if (surface === "feishu") {
    return copy.feishuSurfaceTitle;
  }
  if (surface === "chatgpt") {
    return copy.chatGptSurfaceTitle;
  }
  return copy.surfaceUnavailable;
}

function surfaceSubtitle(surface: SurfaceKind, copy: (typeof COPY)[ShuttleLocale]): string {
  if (surface !== "feishu") {
    return viewState.message;
  }
  if (viewState.state === "idle" || viewState.message === copy.ready || viewState.message === copy.conversationChanged) {
    const pageContext = getFeishuPageContext();
    if (pageContext && pageContext.kind !== "doc") {
      return copy.feishuPublishSectionHint;
    }
    return copy.feishuSurfaceReady;
  }
  return viewState.message;
}

function feishuDocumentTitle(): string {
  return document.title.replace(/\s*[-|_]\s*(飞书|Feishu|Lark).*$/i, "").trim() || location.pathname;
}

function openGlobalPanel(): void {
  viewState.open = true;
  viewState.surfaceOpen = false;
}

function openSurfacePanel(): void {
  if (getCurrentSurface() === "none") {
    openGlobalPanel();
    return;
  }
  viewState.surfaceOpen = true;
  viewState.open = false;
}

function closePanels(): void {
  viewState.open = false;
  viewState.surfaceOpen = false;
}

function fingerprintText(value: string): string {
  let hash = 0;
  const normalized = value.replace(/\s+/g, " ").trim().slice(0, 2000);
  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash * 31 + normalized.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16);
}

async function deliverSelectedThread(mode: DeliveryMode, app: HTMLElement): Promise<void> {
  await deliverSelectedThreads([mode], app);
}

async function deliverSelectedThreads(modes: DeliveryMode[], app: HTMLElement): Promise<void> {
  const selectedThread = viewState.threads[viewState.selectedIndex];
  const copy = COPY[viewState.locale];
  const activeModes = uniqueDeliveryModes(modes);
  if (!selectedThread || activeModes.length === 0) {
    openSurfacePanel();
    viewState.modal = { kind: "success", title: copy.deliverySuccessTitle, message: copy.captured };
    render(app);
    return;
  }

  const messages: string[] = [];
  let ok = true;
  for (const mode of activeModes) {
    const result = await saveThreadWithMode(mode, selectedThread);
    ok = ok && result.ok;
    messages.push(result.message);
  }

  applySaveResult(messages.join(" "), ok);
  openSurfacePanel();
  viewState.modal = { kind: "success", title: ok ? copy.deliverySuccessTitle : copy.deliveryIssueTitle, message: viewState.message };
  render(app);
}

async function saveThreadWithMode(mode: DeliveryMode, selectedThread: NoosThread): Promise<{ ok: boolean; message: string }> {
  const copy = COPY[viewState.locale];
  if (mode === "copy") {
    const result = await clipboardAdapter.saveThread(selectedThread);
    return { ok: result.ok, message: result.ok ? copy.copyFinished : result.message ?? copy.copyFinished };
  }
  if (mode === "download") {
    const filename = createThreadFilenameFromThread(selectedThread);
    const result = await downloadAdapter.saveThread(selectedThread, { filename });
    return { ok: result.ok, message: result.ok ? copy.downloadFinished : result.message ?? copy.downloadFinished };
  }

  if (viewState.captureFullTranscript) {
    const pack = await captureContextPackForSelectedThreadWithScroll();
    if (pack) {
      const result = await noosVaultAdapter.saveContextPack(pack, window.location.href);
      if (result.backend === "hub_local") {
        viewState.vaultRoute = "hub";
      } else if (result.backend === "downloads_mirror") {
        viewState.vaultRoute = "mirror";
      }
      return { ok: result.ok, message: result.ok ? result.message ?? copy.contextPackSaved : result.message ?? copy.vaultUnavailable };
    }
  }

  const filename = createThreadFilenameFromThread(selectedThread);
  const result = await noosVaultAdapter.saveThread(selectedThread, { filename });
  if (result.backend === "hub_local") {
    viewState.vaultRoute = "hub";
  } else if (result.backend === "downloads_mirror") {
    viewState.vaultRoute = "mirror";
  }
  const failureMessage =
    result.errorCode === EXTENSION_CONTEXT_INVALID ? copy.extensionContextInvalid : result.message ?? copy.vaultUnavailable;
  return { ok: result.ok, message: result.ok ? result.message ?? copy.vaultFinished : failureMessage };
}

async function deliverSelectedCrystal(app: HTMLElement): Promise<void> {
  const copy = COPY[viewState.locale];
  const crystal = viewState.crystals[viewState.selectedCrystalIndex];
  if (!crystal) {
    viewState.state = "error";
    viewState.message = copy.noCrystalDetected;
    render(app);
    return;
  }

  const filename = createCrystalFilename(crystal.key || crystal.title);
  let response: { ok?: boolean; backend?: string; location?: string; message?: string; errorCode?: string; key?: string };
  try {
    response = await sendExtensionMessage<
      { type: "NOOS_SAVE_CRYSTAL_TO_VAULT"; filename: string; content: string },
      { ok?: boolean; backend?: string; location?: string; message?: string; errorCode?: string; key?: string }
    >({
      type: "NOOS_SAVE_CRYSTAL_TO_VAULT",
      filename,
      content: crystal.rawMarkdown
    });
  } catch (error) {
    response = {
      ok: false,
      errorCode: error instanceof Error && error.message === EXTENSION_CONTEXT_INVALID ? EXTENSION_CONTEXT_INVALID : "vault_failed",
      message: error instanceof Error ? error.message : copy.vaultUnavailable
    };
  }

  if (response?.backend === "hub_local") {
    viewState.vaultRoute = "hub";
  } else if (response?.backend === "downloads_mirror") {
    viewState.vaultRoute = "mirror";
  }

  const savedKey = response?.key ?? crystal.key;
  let copiedKey = true;
  try {
    await navigator.clipboard.writeText(savedKey);
  } catch {
    copiedKey = false;
  }
  viewState.state = response?.ok ? "saved" : "error";
  viewState.message = response?.ok
    ? copiedKey
      ? copy.crystalSaved(savedKey)
      : copy.crystalSavedWithoutClipboard(savedKey)
    : response?.errorCode === EXTENSION_CONTEXT_INVALID
      ? copy.extensionContextInvalid
      : response?.message ?? copy.vaultUnavailable;
  viewState.modal = {
    kind: "success",
    title: response?.ok ? copy.deliverySuccessTitle : copy.deliveryIssueTitle,
    message: viewState.message
  };
  openSurfacePanel();
  render(app);
}

async function refreshVaultStatus(app: HTMLElement): Promise<void> {
  try {
    const response = await sendExtensionMessage<
      { type: "NOOS_GET_VAULT_STATUS" },
      { hubAvailable?: boolean; paired?: boolean }
    >({ type: "NOOS_GET_VAULT_STATUS" });

    if (response?.hubAvailable && response.paired) {
      viewState.vaultRoute = "hub";
    } else if (response?.hubAvailable) {
      viewState.vaultRoute = "needs-repair";
    } else {
      viewState.vaultRoute = "mirror";
    }
  } catch {
    viewState.vaultRoute = "mirror";
  }

  render(app);
}

async function refreshVaultObjects(
  app: HTMLElement,
  options: { preserveSelection?: boolean; preserveScroll?: boolean } = {}
): Promise<void> {
  try {
    const response = await sendExtensionMessage<
      { type: "NOOS_BROWSE_VAULT"; folder: string; query: string } | { type: "NOOS_GET_VAULT_RECENT" },
      { ok?: boolean; objects?: VaultObjectSummary[]; folders?: VaultFolderSummary[]; folder?: string; query?: string }
    >(
      viewState.modal?.kind === "vault-picker"
        ? { type: "NOOS_BROWSE_VAULT", folder: viewState.vaultBrowseFolder, query: viewState.vaultBrowseQuery }
        : { type: "NOOS_GET_VAULT_RECENT" }
    );

    viewState.vaultObjects = response?.ok && Array.isArray(response.objects) ? response.objects : [];
    viewState.vaultFolders = response?.ok && Array.isArray(response.folders) ? response.folders : viewState.vaultFolders;
    if (response?.folder) {
      viewState.vaultBrowseFolder = response.folder;
    }
    const availableKeys = new Set(viewState.vaultObjects.map(vaultObjectKey).filter(Boolean));
    if (!options.preserveSelection) {
      viewState.selectedVaultObjectKeys = viewState.selectedVaultObjectKeys.filter((key) => availableKeys.has(key));
    }
    if (viewState.selectedVaultObjectKeys.length === 0 && viewState.vaultObjects[0] && !options.preserveSelection) {
      viewState.selectedVaultObjectKeys = [vaultObjectKey(viewState.vaultObjects[0])];
    }
  } catch {
    viewState.vaultObjects = [];
  }

  if (options.preserveScroll) {
    renderPreservingPopoverScroll(app);
  } else {
    render(app);
  }
}

async function refreshWikiTarget(app: HTMLElement, options: { preserveScroll?: boolean } = {}): Promise<void> {
  try {
    const response = await sendExtensionMessage<
      { type: "NOOS_GET_WIKI_TARGET" },
      {
        ok?: boolean;
        projectPath?: string;
        project_path?: string;
        currentCategoryPath?: string;
        current_category_path?: string;
        recentCategoryPaths?: string[];
        recent_category_paths?: string[];
        message?: string;
      }
    >({ type: "NOOS_GET_WIKI_TARGET" });
    viewState.wikiProjectPath = response?.projectPath || response?.project_path || "";
    viewState.wikiCategoryPath = response?.currentCategoryPath || response?.current_category_path || viewState.wikiCategoryPath;
    viewState.recentCategoryPaths = response?.recentCategoryPaths || response?.recent_category_paths || [];
  } catch {
    viewState.wikiProjectPath = "";
  }
  if (options.preserveScroll) {
    renderPreservingPopoverScroll(app);
  } else {
    render(app);
  }
}

async function runFeishuAction(app: HTMLElement, action: FeishuWikiAction, categoryOverride?: string): Promise<void> {
  const copy = COPY[viewState.locale];
  const categoryPath = categoryOverride || readFeishuCategoryInput(app) || viewState.wikiCategoryPath;
  if ((action === "change_category" || action === "export_md" || action === "export_md_and_organize") && !categoryPath) {
    viewState.state = "warning";
    viewState.message = copy.feishuCategoryRequired;
    viewState.modal = { kind: "feishu-category", pendingAction: action };
    openSurfacePanel();
    render(app);
    return;
  }
  viewState.wikiCategoryPath = categoryPath;
  viewState.state = "waiting";
  viewState.message = copy.feishuMarkdownHint;
  openSurfacePanel();
  render(app);

  let response: FeishuActionResponse;
  try {
    response = await sendExtensionMessage<
      {
        type: "NOOS_FEISHU_WIKI_ACTION";
        action: FeishuWikiAction;
        url: string;
        title?: string;
        wikiProjectPath?: string;
        categoryPath?: string;
      },
      FeishuActionResponse
    >({
      type: "NOOS_FEISHU_WIKI_ACTION",
      action,
      url: location.href,
      title: feishuDocumentTitle(),
      wikiProjectPath: viewState.wikiProjectPath || undefined,
      categoryPath: categoryPath || undefined
    });
  } catch (error) {
    response = {
      ok: false,
      message: error instanceof Error ? error.message : copy.feishuActionFailed
    };
  }

  const errorCode = response.errorCode || response.error_code;
  if (!response.ok) {
    viewState.state = errorCode === "needs_auth" ? "warning" : "error";
    viewState.message = errorCode === "needs_auth" ? copy.feishuActionNeedsAuth : response.message || copy.feishuActionFailed;
    openSurfacePanel();
    render(app);
    return;
  }

  viewState.state = response.status === "unchanged" ? "warning" : "saved";
  viewState.wikiProjectPath = response.wikiProjectPath || response.wiki_project_path || viewState.wikiProjectPath;
  viewState.message = copy.feishuActionFinished(response.status || "queued", response.message || "");
  await refreshWikiTarget(app, { preserveScroll: true });
  if (isFeishuExportAction(action)) {
    const sourceLocation = response.sourcePath || response.source_path || categoryPath;
    viewState.modal = {
      kind: "success",
      title: copy.feishuExportSuccessTitle,
      message: copy.feishuExportSuccessMessage(sourceLocation, action === "export_md_and_organize"),
      actions: [
        { label: copy.feishuOpenMarkdownFolder, action: "feishu-modal-open-markdown-folder", primary: true, testId: "feishu-open-export-folder" },
        { label: copy.ok, action: "modal-close" }
      ]
    };
  }
  openSurfacePanel();
  render(app);
}

function isFeishuExportAction(action: FeishuWikiAction): boolean {
  return action === "export_md" || action === "export_md_and_organize";
}

async function confirmFeishuCategory(app: HTMLElement, categoryPath: string): Promise<void> {
  const copy = COPY[viewState.locale];
  if (!categoryPath) {
    viewState.state = "warning";
    viewState.message = copy.feishuCategoryRequired;
    render(app);
    return;
  }

  const pendingAction = viewState.modal?.kind === "feishu-category" ? viewState.modal.pendingAction : undefined;
  viewState.modal = null;
  viewState.wikiCategoryPath = categoryPath;
  await runFeishuAction(app, pendingAction || "change_category", categoryPath);
}

function readFeishuCategoryInput(app: HTMLElement): string {
  const input = app.querySelector<HTMLInputElement>("[data-feishu-category-input='true']");
  return normalizeFeishuCategoryPath(input?.value || "");
}

function readFeishuCategoryDialogInput(app: HTMLElement): string {
  const input = app.querySelector<HTMLInputElement>("[data-feishu-category-dialog-input='true']");
  return normalizeFeishuCategoryPath(input?.value || "");
}

function uniqueCategoryPaths(paths: string[]): string[] {
  return Array.from(new Set(paths.map(normalizeFeishuCategoryPath).filter(Boolean)));
}

function normalizeFeishuCategoryPath(value: string): string {
  const parts = value
    .split(/[\\/]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length || parts.some((part) => part === "." || part === ".." || part.startsWith("."))) {
    return "";
  }
  return parts
    .map((part) =>
      part
        .replace(/[:*?"<>|]/g, "-")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
    )
    .filter(Boolean)
    .join("/");
}

async function runFeishuPublish(app: HTMLElement, mode: FeishuPublishMode): Promise<void> {
  const copy = COPY[viewState.locale];
  const source = viewState.selectedPublishSource;
  const pageContext = getFeishuPageContext();
  if (!source) {
    viewState.state = "warning";
    viewState.message = copy.feishuPublishNeedsSource;
    openSurfacePanel();
    render(app);
    return;
  }
  if (!pageContext) {
    viewState.state = "error";
    viewState.message = copy.feishuActionFailed;
    render(app);
    return;
  }
  if (mode === "overwrite" && pageContext.kind !== "doc") {
    viewState.state = "error";
    viewState.message = copy.feishuActionFailed;
    render(app);
    return;
  }

  const destinationKind = feishuPublishDestinationKind(pageContext, mode);
  viewState.state = "waiting";
  viewState.message = copy.feishuPublishHint;
  openSurfacePanel();
  render(app);

  let response: FeishuActionResponse;
  try {
    response = await sendExtensionMessage<
      {
        type: "NOOS_FEISHU_PUBLISH_MARKDOWN";
        action: "publish_markdown";
        sourceKey: string;
        mode: FeishuPublishMode;
        destinationKind: FeishuPublishDestinationKind;
        url: string;
        title?: string;
        folderToken?: string;
        folderName?: string;
      },
      FeishuActionResponse
    >({
      type: "NOOS_FEISHU_PUBLISH_MARKDOWN",
      action: "publish_markdown",
      sourceKey: vaultObjectKey(source),
      mode,
      destinationKind,
      url: location.href,
      title: feishuDocumentTitle(),
      folderToken: pageContext.folderToken,
      folderName: pageContext.label
    });
  } catch (error) {
    response = {
      ok: false,
      message: error instanceof Error ? error.message : copy.feishuPublishFailed
    };
  }

  const errorCode = response.errorCode || response.error_code;
  if (!response.ok) {
    viewState.state = errorCode === "needs_auth" ? "warning" : "error";
    viewState.message = errorCode === "needs_auth" ? copy.feishuPublishNeedsAuth : response.message || copy.feishuPublishFailed;
    openSurfacePanel();
    render(app);
    return;
  }

  viewState.state = "saved";
  viewState.message = copy.feishuPublishFinished(response.status || "published", response.message || "");
  const documentUrl = response.documentUrl || response.document_url;
  viewState.modal = {
    kind: "success",
    title: copy.feishuPublishSuccessTitle,
    message: copy.feishuPublishSuccessMessage(viewState.message, documentUrl),
    actions: [
      ...(documentUrl
        ? [{ label: copy.feishuOpenFeishuDocument, href: documentUrl, primary: true, testId: "feishu-open-published-doc" }]
        : []),
      { label: copy.ok, action: "modal-close" }
    ]
  };
  openSurfacePanel();
  render(app);
}

async function feedSelectedVaultObject(app: HTMLElement): Promise<void> {
  const copy = COPY[viewState.locale];
  const lookupKeys = selectedVaultObjectKeys();
  if (!lookupKeys.length) {
    viewState.message = copy.noVaultObjects;
    render(app);
    return;
  }

  if (vaultFeedTarget === "feishu_publish") {
    await selectVaultObjectForFeishuPublish(app, lookupKeys[0]);
    return;
  }

  const objects: VaultObjectContent[] = [];
  for (const lookupKey of lookupKeys) {
    const response = await loadVaultObject(lookupKey, copy);

    if (!response.ok || !response.object) {
      viewState.state = "error";
      viewState.message = response.message ?? copy.vaultUnavailable;
      render(app);
      return;
    }
    objects.push(response.object);
  }

  if (!objects.length) {
    viewState.state = "error";
    viewState.message = copy.noVaultObjects;
    render(app);
    return;
  }

  const allAttached = attachMarkdownFilesToChatInput(
    objects.map((object) => ({ filename: createVaultObjectFilename(object), content: object.content })),
    { root: preferredVaultAttachRoot }
  );
  if (vaultFeedTarget === "project") {
    if (!allAttached) {
      for (const object of objects) {
        downloadMarkdownFile(createVaultObjectFilename(object), object.content);
      }
      viewState.state = "warning";
      openGlobalPanel();
      viewState.message = copy.vaultObjectsDownloadedForProject(lookupKeys);
      viewState.modal = {
        kind: "success",
        title: copy.deliveryIssueTitle,
        message: viewState.message
      };
      render(app);
      return;
    }

    viewState.state = "saved";
    openGlobalPanel();
    viewState.message = copy.vaultObjectsAttachedToProject(lookupKeys);
    viewState.modal = {
      kind: "success",
      title: copy.deliverySuccessTitle,
      message: viewState.message
    };
    render(app);
    return;
  }

  const instruction = createChatbotFeedInstruction(objects, allAttached, viewState.locale);
  const inserted = insertIntoChatInput(instruction);

  if (!allAttached && !inserted) {
    viewState.state = "error";
    viewState.message = copy.inputNotFound;
    render(app);
    return;
  }

  viewState.state = "saved";
  openGlobalPanel();
  viewState.message = allAttached ? copy.vaultObjectsAttached(lookupKeys) : copy.vaultObjectsInserted(lookupKeys);
  viewState.modal = {
    kind: "success",
    title: copy.deliverySuccessTitle,
    message: viewState.message
  };
  render(app);
}

async function selectVaultObjectForFeishuPublish(app: HTMLElement, lookupKey: string): Promise<void> {
  const copy = COPY[viewState.locale];
  const response = await loadVaultObject(lookupKey, copy);
  if (!response.ok || !response.object) {
    viewState.state = "error";
    viewState.message = response.message ?? copy.vaultUnavailable;
    render(app);
    return;
  }

  viewState.selectedPublishSource = response.object;
  viewState.selectedVaultObjectKeys = [lookupKey];
  viewState.state = "saved";
  viewState.message = copy.feishuMarkdownSelected(lookupKey);
  viewState.modal = null;
  openSurfacePanel();
  render(app);
}

async function loadVaultObject(
  lookupKey: string,
  copy: (typeof COPY)[ShuttleLocale]
): Promise<{ ok?: boolean; object?: VaultObjectContent; message?: string }> {
  try {
    return await sendExtensionMessage<
      { type: "NOOS_GET_VAULT_OBJECT"; lookupKey: string },
      { ok?: boolean; object?: VaultObjectContent; message?: string }
    >({ type: "NOOS_GET_VAULT_OBJECT", lookupKey });
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : copy.vaultUnavailable
    };
  }
}

function vaultObjectKey(object: VaultObjectSummary | VaultObjectContent | undefined): string {
  return object?.lookup_key || object?.key || object?.name?.replace(/\.md$/i, "") || "";
}

function selectedVaultObjectKeys(): string[] {
  if (viewState.selectedVaultObjectKeys.length > 0) {
    return viewState.selectedVaultObjectKeys;
  }
  const fallbackKey = vaultObjectKey(viewState.vaultObjects[0]);
  return fallbackKey ? [fallbackKey] : [];
}

function toggleVaultObjectSelection(key: string): void {
  if (!key) {
    return;
  }
  if (viewState.selectedVaultObjectKeys.includes(key)) {
    viewState.selectedVaultObjectKeys = viewState.selectedVaultObjectKeys.filter((selectedKey) => selectedKey !== key);
    return;
  }
  viewState.selectedVaultObjectKeys = [...viewState.selectedVaultObjectKeys, key];
}

function createVaultObjectFilename(object: VaultObjectContent): string {
  const base = (object.lookup_key || object.key || object.name || "noos-context")
    .replace(/[\\/]/g, "-")
    .replace(/^\.+/, "")
    .trim();
  return `${base || "noos-context"}.md`;
}

function compactPath(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.slice(-3).join("/");
}

function downloadMarkdownFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.rel = "noopener";
    anchor.click();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }
}

function createChatbotFeedInstruction(objects: VaultObjectContent[], attached: boolean, locale: ShuttleLocale): string {
  const refs = objects.map((object) => ({
    key: object.lookup_key || object.key || object.name || "noos-context",
    title: object.title || object.lookup_key || object.key || object.name || "NOOS context"
  }));
  const refText = refs.map((ref) => `- ${ref.key}: ${ref.title}`).join("\n");
  if (attached) {
    return locale === "zh"
      ? `请读取我刚刚附上的 NOOS Markdown 文件，并基于其中内容继续当前对话。\n\nNOOS 对象：\n${refText}\n\n请不要复述全文，先总结你理解到的任务/知识要点，再继续推进。`
      : `Please read the attached NOOS Markdown files and continue this conversation from them.\n\nNOOS objects:\n${refText}\n\nDo not repeat the full files. First summarize the task or knowledge you understood, then continue.`;
  }

  const content = objects
    .map((object) => {
      const key = object.lookup_key || object.key || object.name || "noos-context";
      const title = object.title || key;
      return `## ${title}\n\nNOOS key: ${key}\n\n${object.content}`;
    })
    .join("\n\n---\n\n");

  return locale === "zh"
    ? `请基于下面这些 NOOS 对象继续当前对话。\n\n${content}`
    : `Please continue this conversation using the NOOS objects below.\n\n${content}`;
}

function showValidationModal(thread: NoosThread): void {
  const copy = COPY[viewState.locale];
  viewState.modal = {
    kind: "warnings",
    title: copy.validationWarningTitle,
    message: copy.reviewBeforeDelivery,
    warnings: thread.warnings
  };
}

function updateStateForSelection(): void {
  const selectedThread = viewState.threads[viewState.selectedIndex];
  viewState.state = selectedThread?.warnings.length ? "warning" : "captured";
}

function applySaveResult(message: string, ok: boolean): void {
  viewState.state = ok ? "saved" : "error";
  viewState.message = message;
}

function captureContextPackForSelectedThread(): ContextPack | null {
  if (!viewState.captureFullTranscript) {
    return null;
  }
  const selectedThread = viewState.threads[viewState.selectedIndex];
  if (!selectedThread) {
    return null;
  }
  const transcript = captureRenderedChatGptTranscript();
  viewState.contextPack = createContextPack({
    title: selectedThread.title,
    sourceUrl: window.location.href,
    thread: selectedThread,
    transcript
  });
  return viewState.contextPack;
}

async function captureContextPackForSelectedThreadWithScroll(): Promise<ContextPack | null> {
  if (!viewState.captureFullTranscript) {
    return null;
  }
  const selectedThread = viewState.threads[viewState.selectedIndex];
  if (!selectedThread) {
    return null;
  }
  const transcript = await captureChatGptTranscriptWithScroll();
  viewState.contextPack = createContextPack({
    title: selectedThread.title,
    sourceUrl: window.location.href,
    thread: selectedThread,
    transcript
  });
  return viewState.contextPack;
}

function installDragHandlers(app: HTMLElement): void {
  const fab = app.querySelector<HTMLButtonElement>(".fab");
  if (!fab) {
    return;
  }

  let dragStart: { pointerId: number; pointerX: number; pointerY: number; originX: number; originY: number; moved: boolean } | null = null;

  fab.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }

    dragStart = {
      pointerId: event.pointerId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      originX: shuttlePosition.x,
      originY: shuttlePosition.y,
      moved: false
    };
    fab.setPointerCapture(event.pointerId);
  });

  fab.addEventListener("pointermove", (event) => {
    if (!dragStart || event.pointerId !== dragStart.pointerId) {
      return;
    }

    const deltaX = event.clientX - dragStart.pointerX;
    const deltaY = event.clientY - dragStart.pointerY;
    if (Math.abs(deltaX) + Math.abs(deltaY) > 4) {
      dragStart.moved = true;
      closePanels();
      app.querySelectorAll(".popover").forEach((popover) => popover.remove());
    }

    shuttlePosition = clampPosition({ x: dragStart.originX + deltaX, y: dragStart.originY + deltaY });
    applyShuttlePosition(app, shuttlePosition);
  });

  fab.addEventListener("pointerup", (event) => {
    if (!dragStart || event.pointerId !== dragStart.pointerId) {
      return;
    }

    const wasDragged = dragStart.moved;
    dragStart = null;
    if (wasDragged) {
      shuttlePosition = dockPosition(shuttlePosition);
      applyShuttlePosition(app, shuttlePosition);
      storePosition(shuttlePosition);
      suppressNextFabClick = true;
      window.setTimeout(() => {
        suppressNextFabClick = false;
      }, 0);
    }
  });
}

function applyShuttlePosition(app: HTMLElement, position: ShuttlePosition): void {
  const clamped = clampPosition(position);
  app.style.left = `${clamped.x}px`;
  app.style.top = `${clamped.y}px`;
  app.dataset.dock = clamped.x + FAB_SIZE / 2 < window.innerWidth / 2 ? "left" : "right";
  app.dataset.vertical = clamped.y + FAB_SIZE / 2 < window.innerHeight / 2 ? "top" : "bottom";
}

function dockPosition(position: ShuttlePosition): ShuttlePosition {
  const dockedX = position.x + FAB_SIZE / 2 < window.innerWidth / 2 ? EDGE_GAP : window.innerWidth - FAB_SIZE - EDGE_GAP;
  return clampPosition({ x: dockedX, y: position.y });
}

function clampPosition(position: ShuttlePosition): ShuttlePosition {
  return {
    x: Math.min(Math.max(position.x, EDGE_GAP), Math.max(EDGE_GAP, window.innerWidth - FAB_SIZE - EDGE_GAP)),
    y: Math.min(Math.max(position.y, EDGE_GAP), Math.max(EDGE_GAP, window.innerHeight - FAB_SIZE - EDGE_GAP))
  };
}

function getStoredPosition(): ShuttlePosition {
  const raw = window.localStorage.getItem("noos-shuttle-position");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<ShuttlePosition>;
      if (typeof parsed.x === "number" && typeof parsed.y === "number") {
        return clampPosition({ x: parsed.x, y: parsed.y });
      }
    } catch {
      window.localStorage.removeItem("noos-shuttle-position");
    }
  }

  return clampPosition({ x: window.innerWidth - FAB_SIZE - 18, y: window.innerHeight - FAB_SIZE - 84 });
}

function storePosition(position: ShuttlePosition): void {
  window.localStorage.setItem("noos-shuttle-position", JSON.stringify(position));
}

function activeDeliveryModes(): DeliveryMode[] {
  return viewState.deliveryModes;
}

function toggleDeliveryMode(mode: DeliveryMode): void {
  if (viewState.deliveryModes.includes(mode)) {
    viewState.deliveryModes = viewState.deliveryModes.filter((item) => item !== mode);
    return;
  }

  viewState.deliveryModes = uniqueDeliveryModes([...viewState.deliveryModes, mode]);
}

function parseDeliveryMode(value: string | undefined): DeliveryMode | null {
  if (value === "github") {
    return "vault";
  }

  return value === "copy" || value === "download" || value === "vault" ? value : null;
}

function uniqueDeliveryModes(modes: DeliveryMode[]): DeliveryMode[] {
  return ["copy", "download", "vault"].filter((mode): mode is DeliveryMode => modes.includes(mode as DeliveryMode));
}

function getStoredDeliveryModes(): DeliveryMode[] {
  const stored = window.localStorage.getItem("noos-shuttle-delivery-modes");
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        return uniqueDeliveryModes(parsed.map((item) => parseDeliveryMode(String(item))).filter(Boolean) as DeliveryMode[]);
      }
    } catch {
      window.localStorage.removeItem("noos-shuttle-delivery-modes");
    }
  }

  const legacy = window.localStorage.getItem("noos-shuttle-delivery-mode");
  const legacyMode = legacy === "none" ? null : parseDeliveryMode(legacy ?? undefined);
  return legacyMode ? [legacyMode] : [];
}

function storeDeliveryModes(modes: DeliveryMode[]): void {
  window.localStorage.setItem("noos-shuttle-delivery-modes", JSON.stringify(uniqueDeliveryModes(modes)));
}

function getStoredCaptureFullTranscript(): boolean {
  return window.localStorage.getItem("noos-shuttle-capture-full-transcript") === "true";
}

function storeCaptureFullTranscript(value: boolean): void {
  window.localStorage.setItem("noos-shuttle-capture-full-transcript", value ? "true" : "false");
}

function getExtensionAssetUrl(path: string): string {
  return typeof chrome !== "undefined" && chrome.runtime?.getURL ? chrome.runtime.getURL(path) : path;
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

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#96;");
}
