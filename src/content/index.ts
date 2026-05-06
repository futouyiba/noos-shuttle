import { createThreadFilename } from "../core/filename";
import { createGenerateThreadPrompt } from "../core/prompt-templates";
import { captureNoosThreads } from "../core/thread-capture";
import type { NoosThread } from "../core/noos-thread";
import { COPY, type ShuttleLocale, getStoredLocale, storeLocale } from "../shared/i18n";
import { ClipboardAdapter } from "../storage/ClipboardAdapter";
import { DownloadAdapter } from "../storage/DownloadAdapter";
import { NoosVaultAdapter } from "../storage/NoosVaultAdapter";
import { getPageText, insertIntoChatInput, isChatbotGenerating, submitChatInput } from "./chatgpt-dom";
import styles from "./styles.css?inline";

type ShuttleState = "idle" | "prompt-ready" | "waiting" | "captured" | "needs-choice" | "warning" | "saved" | "error";
type DeliveryMode = "copy" | "download" | "vault";
type ModalState =
  | { kind: "success"; title: string; message: string }
  | { kind: "warnings"; title: string; message: string; warnings: string[] }
  | { kind: "choose-thread" }
  | null;

interface ViewState {
  open: boolean;
  settingsOpen: boolean;
  state: ShuttleState;
  message: string;
  threads: NoosThread[];
  selectedIndex: number;
  locale: ShuttleLocale;
  deliveryModes: DeliveryMode[];
  modal: ModalState;
}

interface ActiveWait {
  observer: MutationObserver;
  timeoutId: number;
  fallbackStartId: number;
  quietTimerId: number | null;
  hasStartedGenerating: boolean;
}

interface ShuttlePosition {
  x: number;
  y: number;
}

const WAIT_FOR_HANDOFF_TIMEOUT_MS = 120_000;
const GENERATION_START_GRACE_MS = 1_500;
const GENERATION_QUIET_MS = 1_200;
const FAB_SIZE = 44;
const EDGE_GAP = 12;
const SHUTTLE_ICON_URL = getExtensionAssetUrl("icons/icon-128.png");
const clipboardAdapter = new ClipboardAdapter();
const downloadAdapter = new DownloadAdapter();
const noosVaultAdapter = new NoosVaultAdapter();
let activeWait: ActiveWait | null = null;
let currentConversationUrl = window.location.href;
let conversationWatcherInstalled = false;
let shuttlePosition = getStoredPosition();
let suppressNextFabClick = false;

const viewState: ViewState = {
  open: false,
  settingsOpen: false,
  state: "idle",
  message: COPY[getStoredLocale()].ready,
  threads: [],
  selectedIndex: 0,
  locale: getStoredLocale(),
  deliveryModes: getStoredDeliveryModes(),
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
  window.addEventListener("resize", () => {
    shuttlePosition = clampPosition(shuttlePosition);
    applyShuttlePosition(app, shuttlePosition);
    storePosition(shuttlePosition);
  });
}

function render(app: HTMLElement): void {
  const selectedThread = viewState.threads[viewState.selectedIndex];
  const copy = COPY[viewState.locale];

  app.innerHTML = `
    <button class="fab fab--${viewState.state}" type="button" aria-label="NOOS Shuttle">
      <span class="fab-logo" style="background-image: url('${escapeAttribute(SHUTTLE_ICON_URL)}')"></span>
    </button>
    ${
      viewState.open
        ? `<section class="popover" aria-label="NOOS Shuttle">
            <header class="header">
              <div>
                <strong>NOOS Shuttle</strong>
                <span>${escapeHtml(viewState.message)}</span>
              </div>
              <button class="icon-button" type="button" data-action="close" aria-label="${copy.close}">x</button>
            </header>
            <div class="primary-actions">
              <button class="primary-action" type="button" data-action="generate-capture" ${
                viewState.state === "waiting" ? "disabled" : ""
              }>${copy.generateAndCollect}</button>
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
              </div>
            </div>
            <div class="actions">
              <button type="button" data-action="generate">${copy.draftHandoff}</button>
              <button type="button" data-action="capture">${copy.collectHandoff}</button>
            </div>
            ${renderThreads(selectedThread)}
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
    ${renderModal()}
  `;

  app.querySelector(".fab")?.addEventListener("click", () => {
    if (suppressNextFabClick) {
      suppressNextFabClick = false;
      return;
    }

    viewState.open = !viewState.open;
    render(app);
  });
  installDragHandlers(app);

  app.querySelectorAll<HTMLButtonElement>("button[data-action]").forEach((element) => {
    element.addEventListener("click", () => handleAction(element.dataset.action ?? "", app));
  });

  app.querySelector<HTMLSelectElement>("select[data-action='select-thread']")?.addEventListener("change", () => {
    handleAction("select-thread", app);
  });

}

function renderDeliveryOption(mode: DeliveryMode, label: string): string {
  const pressed = viewState.deliveryModes.includes(mode);
  return `<button class="delivery-option" type="button" data-action="delivery-${mode}" aria-pressed="${pressed}">${label}</button>`;
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
      ${warnings}
      <pre>${escapeHtml(selectedThread?.rawMarkdown ?? "")}</pre>
      <footer class="preview-actions" aria-label="${copy.detectedHandoffs}">
        <button type="button" data-action="copy">${copy.copyText}</button>
        <button type="button" data-action="download">${copy.downloadFile}</button>
        <button type="button" data-action="vault">${copy.saveToVault}</button>
      </footer>
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
                `<button type="button" data-action="choose-thread-${index}">
                  <strong>${escapeHtml(thread.title)}</strong>
                  <span>${escapeHtml(threadChoiceSummary(thread, copy))}</span>
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

  return `<div class="modal-backdrop" role="presentation">
    <section class="modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(modal.title)}">
      <header class="modal-header">
        <strong>${escapeHtml(modal.title)}</strong>
        <button class="icon-button" type="button" data-action="modal-close" aria-label="${copy.close}">x</button>
      </header>
      <p>${escapeHtml(modal.message)}</p>
      <footer class="modal-actions">
        <button type="button" data-action="modal-close">${copy.ok}</button>
      </footer>
    </section>
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
    const selectedThread = viewState.threads[viewState.selectedIndex];
    viewState.message = selectedThread?.warnings.length ? copy.capturedWithWarnings : copy.captured;
    viewState.open = true;
    if (selectedThread?.warnings.length) {
      showValidationModal(selectedThread);
    }
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
    viewState.open = false;
    render(app);
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

  if (action === "generate-capture") {
    await generateAndCollect(app);
    return;
  }

  if (action === "generate") {
    cancelActiveWait();
    const inserted = insertIntoChatInput(createGenerateThreadPrompt(window.location.href, viewState.locale));
    viewState.state = inserted ? "prompt-ready" : "error";
    viewState.open = false;
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
    render(app);
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
  viewState.open = false;
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

function applyManualCapture(): void {
  const copy = COPY[viewState.locale];
  const result = captureNoosThreads(getPageText());
  viewState.threads = result.threads;
  viewState.selectedIndex = 0;

  if (result.threads.length === 0) {
    viewState.state = "error";
    viewState.message = result.errors[0] ?? copy.noThreadDetected;
  } else if (result.threads.length > 1) {
    viewState.state = "needs-choice";
    viewState.message = copy.chooseDetected(result.threads.length);
    viewState.modal = { kind: "choose-thread" };
  } else {
    updateStateForSelection();
    viewState.message = result.threads[0].warnings.length > 0 ? copy.capturedWithWarnings : copy.captured;
    if (result.threads[0].warnings.length > 0) {
      showValidationModal(result.threads[0]);
    }
  }
}

function waitForGeneratedHandoff(app: HTMLElement, baselineBegin: number): void {
  const copy = COPY[viewState.locale];

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
    const deliveryModes = activeDeliveryModes();
    viewState.message =
      candidate.warnings.length > 0 && deliveryModes.length > 0 ? copy.autoDeliverySkipped : candidate.warnings.length > 0 ? copy.capturedWithWarnings : copy.captured;
    viewState.open = true;
    cancelActiveWait();
    if (candidate.warnings.length > 0) {
      showValidationModal(candidate);
      render(app);
    } else if (deliveryModes.length > 0) {
      void deliverSelectedThreads(deliveryModes, app);
    } else {
      viewState.modal = { kind: "success", title: copy.deliverySuccessTitle, message: copy.captured };
      viewState.open = true;
      render(app);
    }
    return true;
  };

  let quietTimerId: number | null = null;
  let hasStartedGenerating = false;

  const completeAfterQuietPeriod = () => {
    if (!activeWait || !hasStartedGenerating || isChatbotGenerating()) {
      return;
    }

    if (quietTimerId !== null) {
      window.clearTimeout(quietTimerId);
    }
    quietTimerId = window.setTimeout(() => {
      if (!activeWait || isChatbotGenerating()) {
        return;
      }
      viewState.message = copy.waitingForHandoff;
      render(app);
      tryCapture();
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
    viewState.open = true;
    viewState.message = copy.waitingTimedOut;
    render(app);
  }, WAIT_FOR_HANDOFF_TIMEOUT_MS);
  activeWait = { observer, timeoutId, fallbackStartId, quietTimerId, hasStartedGenerating };
  observeGenerationState();
}

function cancelActiveWait(): void {
  if (!activeWait) {
    return;
  }

  activeWait.observer.disconnect();
  window.clearTimeout(activeWait.timeoutId);
  window.clearTimeout(activeWait.fallbackStartId);
  if (activeWait.quietTimerId !== null) {
    window.clearTimeout(activeWait.quietTimerId);
  }
  activeWait = null;
}

function newestMarkerBegin(threads: NoosThread[]): number {
  return threads.reduce((max, thread) => Math.max(max, thread.markerRange.begin), -1);
}

function findNewestThreadAfter(threads: NoosThread[], baselineBegin: number): NoosThread | undefined {
  for (let index = threads.length - 1; index >= 0; index -= 1) {
    if (threads[index].markerRange.begin > baselineBegin) {
      return threads[index];
    }
  }

  return undefined;
}

function installConversationWatcher(app: HTMLElement): void {
  if (conversationWatcherInstalled) {
    return;
  }

  conversationWatcherInstalled = true;
  const checkConversation = () => {
    if (window.location.href === currentConversationUrl) {
      return;
    }

    currentConversationUrl = window.location.href;
    resetForConversationChange(app);
  };

  wrapHistoryMethod("pushState", checkConversation);
  wrapHistoryMethod("replaceState", checkConversation);
  window.addEventListener("popstate", checkConversation);
  window.setInterval(checkConversation, 1000);
}

function wrapHistoryMethod(method: "pushState" | "replaceState", onChange: () => void): void {
  const original = history[method];
  history[method] = function (this: History, ...args: Parameters<History[typeof method]>) {
    const result = original.apply(this, args);
    window.setTimeout(onChange, 0);
    return result;
  } as History[typeof method];
}

function resetForConversationChange(app: HTMLElement): void {
  cancelActiveWait();
  viewState.open = false;
  viewState.settingsOpen = false;
  viewState.state = "idle";
  viewState.message = COPY[viewState.locale].conversationChanged;
  viewState.threads = [];
  viewState.selectedIndex = 0;
  viewState.modal = null;
  render(app);
}

async function deliverSelectedThread(mode: DeliveryMode, app: HTMLElement): Promise<void> {
  await deliverSelectedThreads([mode], app);
}

async function deliverSelectedThreads(modes: DeliveryMode[], app: HTMLElement): Promise<void> {
  const selectedThread = viewState.threads[viewState.selectedIndex];
  const copy = COPY[viewState.locale];
  const activeModes = uniqueDeliveryModes(modes);
  if (!selectedThread || activeModes.length === 0) {
    viewState.open = true;
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
  viewState.open = true;
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
    const filename = createThreadFilename(selectedThread.title);
    const result = await downloadAdapter.saveThread(selectedThread, { filename });
    return { ok: result.ok, message: result.ok ? copy.downloadFinished : result.message ?? copy.downloadFinished };
  }

  const filename = createThreadFilename(selectedThread.title);
  const result = await noosVaultAdapter.saveThread(selectedThread, { filename });
  return { ok: result.ok, message: result.ok ? copy.vaultFinished : result.message ?? copy.vaultUnavailable };
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
      viewState.open = false;
      app.querySelector(".popover")?.remove();
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
