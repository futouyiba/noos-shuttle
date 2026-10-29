const INPUT_SELECTORS = [
  "textarea",
  "div[contenteditable='true'][data-lexical-editor='true']",
  "div[contenteditable='true']",
  "[role='textbox']"
];

const SEND_BUTTON_SELECTORS = [
  "[data-testid='send-button']",
  "[data-testid='composer-send-button']",
  "button[aria-label='Send prompt']",
  "button[aria-label='Send message']",
  "button[aria-label='发送消息']",
  "button[aria-label='发送']",
  "form button[type='submit']"
];

// Provider-specific identities: they say *this is the live stop control*, not
// merely that the wording mentions stopping. Generic exact labels such as
// `aria-label='Stop'` / `'停止'` are deliberately absent — an exact match on a
// bare word is still only lexical evidence, so they must pass the same
// structural guard as any other candidate (issue #84).
const GENERATION_ACTIVE_SELECTORS = [
  "[data-testid='stop-button']",
  "[data-testid='composer-stop-button']",
  "button[aria-label='Stop generating']",
  "button[aria-label='Stop streaming']",
  "button[aria-label='停止生成']",
  "button[aria-label='停止回答']"
];

// Wording that *may* identify a live stop control; placement decides.
const GENERIC_STOP_LABEL = /stop|停止/i;

const COMPOSER_REGION_SELECTOR = "form, [data-testid*='composer'], [class*='composer']";

// A turn whose stream was interrupted keeps a re-rendered disclosure toggle
// describing the *finished* generation ("已停止思考" / "Stopped thinking"). It
// contains 停止/stop but means the opposite, so it must never read as active.
const CONVERGED_GENERATION_LABEL = /已停止|停止思考|stopped\s+(?:thinking|reasoning|responding|generating)/i;

// Assistant turns re-render history and host their own controls; the provider's
// live stop control only ever lives in the composer region.
const CONVERSATION_TURN_SELECTOR = "[data-message-author-role], [data-turn], [data-testid^='conversation-turn']";

const FILE_INPUT_SELECTORS = [
  "input[type='file']",
  "form input[type='file']",
  "[data-testid*='file'] input[type='file']"
];

export function getPageText(): string {
  const main = document.querySelector("main");
  return collectMarkdownAndComments(main ?? document.body).trim();
}

export function getChatComposer(): HTMLElement | null {
  return findChatInput();
}

/**
 * The composer's current draft, without touching it. Issue #63 C2: a delivery
 * must know whether the Human is mid-sentence *before* it decides to write, so
 * this deliberately reads and never focuses, selects, or edits.
 */
export function readChatComposerDraft(): string | null {
  const input = findChatInput();
  if (!input) return null;
  return input instanceof HTMLTextAreaElement ? input.value : input.textContent ?? "";
}

/**
 * True only when a usable composer is present and carries no draft text.
 *
 * "No draft text" means no non-whitespace content: `"   "` reads as **empty**,
 * because there is nothing in it for the Human to lose. The rest of the reading
 * is strict — an absent composer is not empty (there is nothing to write into),
 * and a composer Shuttle itself wrote into on an earlier attempt still counts as
 * "not empty" until an explicit cancel.
 *
 * An earlier version of this comment claimed the opposite for whitespace, that
 * only the strict reading was safe. The behaviour has always been the above,
 * three delivery paths depend on it, and issue #105 settled the disagreement in
 * favour of the code rather than changing what four call sites observe.
 */
export function isChatComposerEmpty(): boolean {
  const draft = readChatComposerDraft();
  return draft !== null && draft.trim() === "";
}

export function insertIntoChatInput(text: string, expectedComposer?: HTMLElement): boolean {
  const input = expectedComposer ?? findChatInput();
  if (!input || !isUsableComposer(input) || (expectedComposer && findChatInput() !== expectedComposer)) {
    return false;
  }

  input.focus();

  if (input instanceof HTMLTextAreaElement) {
    input.value = text;
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    return true;
  }

  input.textContent = text;
  input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  return true;
}

/**
 * Why a background-initiated write did not happen. Neither is a failure of the
 * delivery: `chatgpt_composer_not_empty` in particular means the Human's turn
 * has priority, which is the normal case during a conversation.
 */
export type ComposerInsertRefusal = "chatgpt_composer_unavailable" | "chatgpt_composer_not_empty";

export type ComposerInsertResult =
  | { readonly ok: true; readonly composer: HTMLElement }
  | { readonly ok: false; readonly reason: ComposerInsertRefusal };

/**
 * Write `text` into the composer *only* if the Human has nothing pending there,
 * and say which of the two happened without ever touching a draft (issue #98).
 *
 * This is the single place a background payload is allowed to reach the
 * composer. It exists as its own function, rather than as a check a caller is
 * trusted to remember, because both halves have to be in the same synchronous
 * turn: the emptiness read and the write below cannot be separated by an
 * `await`, or a draft typed in between would be overwritten anyway. A caller
 * that gets `ok: true` has already replaced a composer it observed empty; a
 * caller that gets `ok: false` has not modified the page at all.
 *
 * The refusal is a return value and not a throw because the refusal is
 * actionable by the *caller's* caller: the background has to learn that the
 * delivery was not attempted so it can retry once the Human's turn is done,
 * which is a different outcome from "we may have sent something".
 */
export function insertIntoFreeChatInput(text: string): ComposerInsertResult {
  const composer = getChatComposer();
  if (!composer) return { ok: false, reason: "chatgpt_composer_unavailable" };
  if (!isChatComposerEmpty()) return { ok: false, reason: "chatgpt_composer_not_empty" };
  if (!insertIntoChatInput(text, composer)) return { ok: false, reason: "chatgpt_composer_unavailable" };
  return { ok: true, composer };
}

interface AttachMarkdownFileOptions {
  root?: ParentNode | null;
}

export function attachMarkdownFileToChatInput(filename: string, content: string, options: AttachMarkdownFileOptions = {}): boolean {
  return attachMarkdownFilesToChatInput([{ filename, content }], options);
}

export function attachMarkdownFilesToChatInput(
  files: Array<{ filename: string; content: string }>,
  options: AttachMarkdownFileOptions = {}
): boolean {
  const input = findFileInput(options.root ?? document) ?? (options.root ? findFileInput(document) : null);
  if (!input || files.length === 0) {
    return false;
  }

  const dataTransfer = new DataTransfer();
  for (const file of files) {
    dataTransfer.items.add(new File([file.content], file.filename, { type: "text/markdown" }));
  }
  input.files = dataTransfer.files;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

export async function submitChatInput(expectedComposer?: HTMLElement): Promise<boolean> {
  await waitForComposerUpdate();

  const input = expectedComposer ?? findChatInput();
  if (!input || !isUsableComposer(input) || (expectedComposer && findChatInput() !== expectedComposer)) {
    return false;
  }
  const button = findSendButton(input);
  if (button) {
    button.click();
    return true;
  }

  input.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      bubbles: true,
      cancelable: true,
      composed: true
    })
  );
  return true;
}

export function isChatbotGenerating(): boolean {
  return Boolean(findGenerationActiveButton());
}

function findChatInput(): HTMLElement | null {
  return findMainChatComposer();
}

/**
 * The provider's *main* composer, as observed for readiness evidence
 * (issue #134).
 *
 * Same resolver semantics as the execution side's `findChatInput` — primary
 * `#prompt-textarea`, then the same selector chain filtered by
 * `isUsableComposer` — plus the discipline an observation probe owes: a
 * fallback candidate only counts when it sits in the composer region and
 * outside every conversation turn, so a historical-message editor or a stray
 * dialog textarea can never substitute for a missing main composer. The
 * primary keeps `findChatInput`'s reading: when the known composer is present
 * but unusable, do not hunt for substitutes.
 */
export function findMainChatComposer(): HTMLElement | null {
  const primary = document.querySelector<HTMLElement>("#prompt-textarea");
  if (primary) return isUsableComposer(primary) ? primary : null;
  for (const selector of INPUT_SELECTORS) {
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(selector));
    const main = candidates.find((candidate) => isUsableComposer(candidate) && isMainComposerPlacement(candidate));
    if (main) {
      return main;
    }
  }

  return null;
}

/**
 * A fallback composer candidate's placement: the live composer lives in the
 * composer region — the same scope `findSendButton` searches — and never
 * inside a conversation turn, where historical-message editors render.
 */
function isMainComposerPlacement(candidate: HTMLElement): boolean {
  return !candidate.closest(CONVERSATION_TURN_SELECTOR) &&
    !candidate.closest("[role='search'], [role='dialog'], dialog") &&
    Boolean(candidate.closest(COMPOSER_REGION_SELECTOR));
}

function findFileInput(root: ParentNode): HTMLInputElement | null {
  for (const selector of FILE_INPUT_SELECTORS) {
    const candidates = Array.from(root.querySelectorAll<HTMLInputElement>(selector));
    const usable = candidates.find((candidate) => !candidate.disabled && !candidate.closest("[aria-hidden='true']"));
    if (usable) {
      return usable;
    }
  }

  return null;
}

function findSendButton(composer?: HTMLElement): HTMLButtonElement | null {
  const scope = composer ? composer.closest(COMPOSER_REGION_SELECTOR) ?? composer.parentElement : document;
  for (const selector of SEND_BUTTON_SELECTORS) {
    const candidates = Array.from(scope?.querySelectorAll<HTMLButtonElement>(selector) ?? []);
    const visible = candidates.find((candidate) => isVisible(candidate) && !candidate.disabled && !candidate.closest("[aria-hidden='true']"));
    if (visible) {
      return visible;
    }
  }

  const buttons = Array.from(scope?.querySelectorAll<HTMLButtonElement>("button") ?? []);
  return (
    buttons.find((button) => {
      const label = `${button.getAttribute("aria-label") ?? ""} ${button.textContent ?? ""}`.trim();
      return isVisible(button) && !button.disabled && /send|发送/i.test(label);
    }) ?? null
  );
}

function isUsableComposer(candidate: HTMLElement): boolean {
  return isVisible(candidate) &&
    !candidate.closest("[aria-hidden='true'],[inert],[aria-disabled='true']") &&
    !candidate.matches(":disabled,[readonly]") &&
    candidate.getAttribute("aria-readonly") !== "true" &&
    (candidate instanceof HTMLTextAreaElement || candidate.isContentEditable || candidate.getAttribute("role") === "textbox");
}

/**
 * The single classifier for "a live generation stop control is present"
 * (issue #84). Every candidate — provider-specific identity or plain wording —
 * passes the same structural guard, so no second lexical scanner can revive a
 * converged turn's disclosure control.
 */
function findGenerationActiveButton(): HTMLButtonElement | null {
  for (const selector of GENERATION_ACTIVE_SELECTORS) {
    const candidates = Array.from(document.querySelectorAll<HTMLButtonElement>(selector));
    const active = candidates.find(isGuardedStopControl);
    if (active) {
      return active;
    }
  }

  // Wording alone is not authority. A generic 停止/Stop control only counts
  // when it sits in the composer region, where the provider's live stop
  // control lives; anywhere else the same words are history or a disclosure.
  return Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => isGuardedStopControl(button) && Boolean(button.closest(COMPOSER_REGION_SELECTOR)) &&
      GENERIC_STOP_LABEL.test(stopControlText(button))) ?? null;
}

/**
 * Structural guard shared by both passes. A converged turn's disclosure toggle
 * says 停止/Stop while describing a *finished* generation, and assistant turns
 * host historical controls; the provider's live stop control never lives in
 * one. A disclosure toggle is not an action either — it only expands text
 * already rendered.
 */
function isGuardedStopControl(button: HTMLButtonElement): boolean {
  if (!isVisible(button)) return false;
  if (button.closest("[aria-hidden='true']")) return false;
  if (button.closest(CONVERSATION_TURN_SELECTOR)) return false;
  if (button.hasAttribute("aria-expanded")) return false;
  return !CONVERGED_GENERATION_LABEL.test(stopControlText(button));
}

function stopControlText(button: HTMLButtonElement): string {
  return `${button.getAttribute("aria-label") ?? ""} ${button.textContent ?? ""}`.trim();
}

function waitForComposerUpdate(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 120);
  });
}

function isVisible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
}

function shouldIgnoreNode(node: Node): boolean {
  const parent = node.parentElement;
  if (!parent) {
    return false;
  }

  return Boolean(
    parent.closest(
      [
        "textarea",
        "input",
        "form",
        "[contenteditable='true']",
        "[role='textbox']",
        "#noos-shuttle-root",
        ".noos-project-import-button",
        ".noos-project-export-sources-button"
      ].join(",")
    )
  );
}

function collectMarkdownAndComments(root: Element): string {
  return normalizeMarkdownLines(renderNode(root, "block"));
}

function renderNode(node: Node, mode: "block" | "inline"): string {
  if (shouldIgnoreNode(node)) {
    return "";
  }

  if (node.nodeType === Node.COMMENT_NODE) {
    const value = node.nodeValue?.trim();
    return value ? `<!-- ${value} -->` : "";
  }

  if (node.nodeType === Node.TEXT_NODE) {
    return normalizeInlineText(node.nodeValue ?? "");
  }

  if (!(node instanceof HTMLElement)) {
    return renderChildren(node, mode);
  }

  const tagName = node.tagName.toLowerCase();

  if (tagName === "br") {
    return "\n";
  }

  if (tagName === "hr") {
    return "---";
  }

  if (tagName === "pre") {
    return node.textContent?.trim() ?? "";
  }

  if (tagName === "code") {
    return mode === "inline" ? `\`${normalizeInlineText(node.textContent ?? "")}\`` : node.textContent?.trim() ?? "";
  }

  if (tagName === "ul" || tagName === "ol") {
    return renderList(node, tagName === "ol");
  }

  if (/^h[1-6]$/.test(tagName)) {
    const level = Number(tagName.slice(1));
    return `${"#".repeat(level)} ${renderChildren(node, "inline").trim()}`;
  }

  if (tagName === "li") {
    return renderListItem(node, "-", 0);
  }

  if (tagName === "p") {
    return renderChildren(node, "inline").trim();
  }

  if (tagName === "blockquote") {
    return renderChildren(node, "block")
      .split(/\n/)
      .filter(Boolean)
      .map((line) => `> ${line}`)
      .join("\n");
  }

  if (isBlockElement(node)) {
    return renderChildren(node, "block");
  }

  return renderChildren(node, mode);
}

function renderChildren(node: Node, mode: "block" | "inline"): string {
  const pieces = Array.from(node.childNodes)
    .map((child) => renderNode(child, mode))
    .filter((value) => value.trim().length > 0);

  return pieces.join(mode === "inline" ? " " : "\n");
}

function renderList(list: HTMLElement, ordered: boolean): string {
  const items = Array.from(list.children).filter((child): child is HTMLElement => child instanceof HTMLElement && child.tagName.toLowerCase() === "li");

  return items
    .map((item, index) => renderListItem(item, ordered ? `${index + 1}.` : "-", 0))
    .filter(Boolean)
    .join("\n");
}

function renderListItem(item: HTMLElement, marker: string, depth: number): string {
  const contentPieces: string[] = [];
  const nestedLists: string[] = [];

  Array.from(item.childNodes).forEach((child) => {
    if (child instanceof HTMLElement && ["ul", "ol"].includes(child.tagName.toLowerCase())) {
      nestedLists.push(renderNestedList(child, depth + 1));
      return;
    }

    const rendered = renderNode(child, "inline").trim();
    if (rendered) {
      contentPieces.push(rendered);
    }
  });

  const indent = "  ".repeat(depth);
  const content = contentPieces.join(" ").replace(/\s+/g, " ").trim();
  const currentLine = content ? `${indent}${marker} ${content}` : "";
  return [currentLine, ...nestedLists].filter(Boolean).join("\n");
}

function renderNestedList(list: HTMLElement, depth: number): string {
  const ordered = list.tagName.toLowerCase() === "ol";
  const items = Array.from(list.children).filter((child): child is HTMLElement => child instanceof HTMLElement && child.tagName.toLowerCase() === "li");

  return items
    .map((item, index) => renderListItem(item, ordered ? `${index + 1}.` : "-", depth))
    .filter(Boolean)
    .join("\n");
}

function isBlockElement(element: HTMLElement): boolean {
  return [
    "article",
    "aside",
    "div",
    "dl",
    "fieldset",
    "figcaption",
    "figure",
    "footer",
    "form",
    "header",
    "main",
    "nav",
    "ol",
    "p",
    "section",
    "table",
    "ul"
  ].includes(element.tagName.toLowerCase());
}

function normalizeInlineText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeMarkdownLines(value: string): string {
  return value
    .split(/\n/)
    .map((line) => line.trimEnd())
    .filter((line, index, lines) => line.trim().length > 0 || (index > 0 && lines[index - 1]?.trim().length > 0))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}
