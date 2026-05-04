import { createThreadFilename } from "../core/filename";
import { createGenerateThreadPrompt } from "../core/prompt-templates";
import { captureNoosThreads } from "../core/thread-capture";
import type { NoosThread } from "../core/noos-thread";
import { COPY, type ShuttleLocale, getStoredLocale, storeLocale } from "../shared/i18n";
import { ClipboardAdapter } from "../storage/ClipboardAdapter";
import { DownloadAdapter } from "../storage/DownloadAdapter";
import { GitHubAdapter } from "../storage/GitHubAdapter";
import { getPageText, insertIntoChatInput, submitChatInput } from "./chatgpt-dom";
import styles from "./styles.css?inline";

type ShuttleState = "idle" | "prompt-ready" | "captured" | "needs-choice" | "warning" | "saved" | "error";

interface ViewState {
  open: boolean;
  settingsOpen: boolean;
  state: ShuttleState;
  message: string;
  threads: NoosThread[];
  selectedIndex: number;
  locale: ShuttleLocale;
}

const clipboardAdapter = new ClipboardAdapter();
const downloadAdapter = new DownloadAdapter();
const githubAdapter = new GitHubAdapter();

const viewState: ViewState = {
  open: false,
  settingsOpen: false,
  state: "idle",
  message: COPY[getStoredLocale()].ready,
  threads: [],
  selectedIndex: 0,
  locale: getStoredLocale()
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

  render(app);
}

function render(app: HTMLElement): void {
  const selectedThread = viewState.threads[viewState.selectedIndex];
  const copy = COPY[viewState.locale];

  app.innerHTML = `
    <button class="fab fab--${viewState.state}" type="button" aria-label="NOOS Shuttle">
      <span>NS</span>
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
            <div class="actions">
              <button type="button" data-action="generate">${copy.draftHandoff}</button>
              <button type="button" data-action="capture">${copy.collectHandoff}</button>
              <button type="button" data-action="copy" ${selectedThread ? "" : "disabled"}>${copy.copy}</button>
              <button type="button" data-action="download" ${selectedThread ? "" : "disabled"}>${copy.download}</button>
            </div>
            ${renderThreads(selectedThread)}
            <div class="github-note">
              <button type="button" data-action="github" ${selectedThread ? "" : "disabled"}>GitHub</button>
              <span>${copy.githubPlaceholder}</span>
            </div>
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
  `;

  app.querySelector(".fab")?.addEventListener("click", () => {
    viewState.open = !viewState.open;
    render(app);
  });

  app.querySelectorAll<HTMLButtonElement>("button[data-action]").forEach((element) => {
    element.addEventListener("click", () => handleAction(element.dataset.action ?? "", app));
  });

  app.querySelector<HTMLSelectElement>("select[data-action='select-thread']")?.addEventListener("change", () => {
    handleAction("select-thread", app);
  });
}

function renderThreads(selectedThread: NoosThread | undefined): string {
  const copy = COPY[viewState.locale];

  if (viewState.threads.length === 0) {
    return `<div class="empty">${copy.noCapturedHandoff}</div>`;
  }

  const chooser =
    viewState.threads.length > 1
      ? `<label class="field">
          <span>${copy.detectedHandoffs}</span>
          <select data-action="select-thread">
            ${viewState.threads
              .map(
                (thread, index) =>
                  `<option value="${index}" ${index === viewState.selectedIndex ? "selected" : ""}>${escapeHtml(
                    thread.title
                  )}</option>`
              )
              .join("")}
          </select>
        </label>`
      : "";

  const warnings = selectedThread?.warnings.length
    ? `<div class="warnings">
        <strong>${copy.warnings}</strong>
        <ul>${selectedThread.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>
      </div>`
    : "";

  return `
    ${chooser}
    <article class="preview">
      <div class="preview-title">${escapeHtml(selectedThread?.title ?? copy.untitledThread)}</div>
      ${warnings}
      <pre>${escapeHtml(selectedThread?.rawMarkdown ?? "")}</pre>
    </article>
  `;
}

async function handleAction(action: string, app: HTMLElement): Promise<void> {
  const copy = COPY[viewState.locale];

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
    render(app);
    return;
  }

  if (action === "generate") {
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
    const result = captureNoosThreads(getPageText());
    viewState.threads = result.threads;
    viewState.selectedIndex = 0;

    if (result.threads.length === 0) {
      viewState.state = "error";
      viewState.message = result.errors[0] ?? copy.noThreadDetected;
    } else if (result.threads.length > 1) {
      viewState.state = "needs-choice";
      viewState.message = copy.chooseDetected(result.threads.length);
    } else {
      updateStateForSelection();
      viewState.message = result.threads[0].warnings.length > 0 ? copy.capturedWithWarnings : copy.captured;
    }

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
    const result = await clipboardAdapter.saveThread(selectedThread);
    applySaveResult(result.ok ? copy.copyFinished : result.message ?? copy.copyFinished, result.ok);
    viewState.open = false;
    render(app);
    return;
  }

  if (action === "download") {
    const filename = createThreadFilename(selectedThread.title);
    const result = await downloadAdapter.saveThread(selectedThread, { filename });
    applySaveResult(result.ok ? copy.downloadFinished : result.message ?? copy.downloadFinished, result.ok);
    viewState.open = false;
    render(app);
    return;
  }

  if (action === "github") {
    const result = await githubAdapter.saveThread(selectedThread);
    applySaveResult(result.message ?? copy.githubUnavailable, result.ok);
    viewState.open = false;
    render(app);
  }
}

function updateStateForSelection(): void {
  const selectedThread = viewState.threads[viewState.selectedIndex];
  viewState.state = selectedThread?.warnings.length ? "warning" : "captured";
}

function applySaveResult(message: string, ok: boolean): void {
  viewState.state = ok ? "saved" : "error";
  viewState.message = message;
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
