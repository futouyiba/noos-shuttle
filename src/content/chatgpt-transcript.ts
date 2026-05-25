import type { BrowserTranscript, TranscriptRole, TranscriptTurn } from "../core/transcript";

const TURN_SELECTORS = [
  "article[data-testid^='conversation-turn-']",
  "[data-testid^='conversation-turn-']",
  "[data-message-author-role]"
];

const MESSAGE_SELECTORS = [
  "[data-message-author-role] .markdown",
  "[data-message-author-role] .whitespace-pre-wrap",
  "[data-message-id]",
  ".markdown",
  ".whitespace-pre-wrap",
  "[data-message-author-role]"
];

const IGNORE_SELECTORS = [
  "#noos-shuttle-root",
  "nav",
  "aside",
  "form",
  "textarea",
  "input",
  "button",
  "select",
  "svg",
  "[role='button']",
  "[role='toolbar']",
  "[role='menu']",
  "[role='menuitem']",
  "[role='dialog']",
  "[contenteditable='true']",
  "[aria-hidden='true']",
  "[hidden]",
  "[data-testid*='copy']",
  "[data-testid*='share']",
  "[data-testid*='composer']",
  "[data-testid*='voice']"
];

const CONTROL_TEXT = new Set([
  "展开",
  "收起",
  "展开收起",
  "copy",
  "copied",
  "复制",
  "复制回复",
  "share",
  "分享",
  "regenerate",
  "重新生成"
]);

const MAX_SCROLL_CAPTURE_MS = 8000;
const MAX_TOP_PROBE_ATTEMPTS = 6;
const MAX_DOWN_SCROLL_ATTEMPTS = 14;
const DOM_SETTLE_MS = 140;

export function captureRenderedChatGptTranscript(root: ParentNode = document): BrowserTranscript {
  const main = root.querySelector?.("main") ?? document.querySelector("main");
  const conversationRoot = main ?? document.body;
  const turns = extractTurns(conversationRoot);
  const title = document.title?.replace(/\s*\|\s*ChatGPT\s*$/i, "").trim() || "ChatGPT Conversation";
  const warnings: string[] = [];

  if (turns.length === 0) {
    warnings.push("No ChatGPT conversation turns were detected in the currently rendered page.");
  }

  warnings.push("Transcript capture used currently rendered browser DOM only; long conversations may require scroll-probe capture before this can be marked complete.");

  return {
    title,
    turns,
    markdown: renderTranscriptMarkdown(title, turns),
    warnings,
    capture: {
      method: "browser_shuttle_dom",
      completeness: "rendered_only",
      topReached: false,
      bottomReached: true,
      partialReasons: ["scroll_probe_not_run"]
    }
  };
}

export async function captureChatGptTranscriptWithScroll(root: ParentNode = document): Promise<BrowserTranscript> {
  const scrollElement = findScrollElement(root);
  const originalTop = scrollElement?.scrollTop ?? 0;
  const deadline = Date.now() + MAX_SCROLL_CAPTURE_MS;
  const title = document.title?.replace(/\s*\|\s*ChatGPT\s*$/i, "").trim() || "ChatGPT Conversation";
  const warnings: string[] = [];
  let topReached = false;
  let bottomReached = false;

  if (!scrollElement) {
    const rendered = captureRenderedChatGptTranscript(root);
    return {
      ...rendered,
      warnings: [...rendered.warnings, "No scroll container was found; transcript capture is limited to currently rendered turns."],
      capture: {
        ...rendered.capture,
        completeness: "rendered_only",
        partialReasons: [...rendered.capture.partialReasons, "scroll_container_not_found"]
      }
    };
  }

  try {
    topReached = await probeTop(scrollElement, deadline);
    const result = await collectTurnsWhileScrollingDown(root, scrollElement, deadline);
    const turns = result.turns;
    bottomReached = isAtBottom(scrollElement);

    if (turns.length === 0) {
      warnings.push("No ChatGPT conversation turns were detected after scroll-probe capture.");
    }
    if (!topReached) {
      warnings.push("Transcript capture could not prove that the top of the conversation was reached.");
    }
    if (!bottomReached) {
      warnings.push("Transcript capture could not prove that the bottom of the conversation was reached.");
    }
    if (result.timeBudgetExhausted) {
      warnings.push("Transcript scroll-probe stopped after its time budget to avoid freezing the page.");
    }
    if (result.noScrollProgress) {
      warnings.push("Transcript scroll-probe stopped because the detected scroll container did not make progress.");
    }

    const partialReasons = [
      ...(!topReached ? ["top_not_confirmed"] : []),
      ...(!bottomReached ? ["bottom_not_confirmed"] : []),
      ...(turns.length === 0 ? ["no_turns_detected"] : []),
      ...(result.timeBudgetExhausted ? ["time_budget_exhausted"] : []),
      ...(result.noScrollProgress ? ["no_scroll_progress"] : [])
    ];

    return {
      title,
      turns,
      markdown: renderTranscriptMarkdown(title, turns),
      warnings,
      capture: {
        method: "browser_shuttle_dom",
        completeness: partialReasons.length === 0 ? "complete" : "partial",
        topReached,
        bottomReached,
        partialReasons
      }
    };
  } finally {
    safeSetScrollTop(scrollElement, originalTop);
  }
}

function extractTurns(root: Element): TranscriptTurn[] {
  const candidates = uniqueElements(TURN_SELECTORS.flatMap((selector) => Array.from(root.querySelectorAll<HTMLElement>(selector))))
    .filter((candidate) => !isHiddenElement(candidate));
  const rawTurns = candidates
    .map((candidate) => {
      const role = detectRole(candidate);
      const messageElement = findMessageElement(candidate);
      const markdown = messageElement ? stripControlText(renderElementToMarkdown(messageElement).trim()) : "";
      return { role, markdown };
    })
    .filter((turn) => turn.markdown.length > 0 && turn.role !== "unknown");

  return dedupeRenderedTurns(rawTurns).map((turn, index) => ({
    id: `T${String(index + 1).padStart(3, "0")}`,
    role: turn.role,
    markdown: turn.markdown
  }));
}

function uniqueElements(elements: HTMLElement[]): HTMLElement[] {
  const result: HTMLElement[] = [];
  for (const element of elements) {
    if (result.some((existing) => existing === element || existing.contains(element))) {
      continue;
    }
    if (elements.some((other) => other !== element && other.contains(element))) {
      continue;
    }
    result.push(element);
  }
  return result;
}

function detectRole(element: HTMLElement): TranscriptRole {
  const roleElement = element.matches("[data-message-author-role]")
    ? element
    : element.querySelector<HTMLElement>("[data-message-author-role]");
  const role = roleElement?.dataset.messageAuthorRole?.toLowerCase();
  if (role === "user" || role === "assistant" || role === "tool" || role === "system_snapshot") {
    return role;
  }

  const label = `${element.getAttribute("aria-label") ?? ""} ${element.textContent?.slice(0, 80) ?? ""}`.toLowerCase();
  if (/\byou\b|你|用户/.test(label)) {
    return "user";
  }
  if (/chatgpt|assistant|助手/.test(label)) {
    return "assistant";
  }
  return "unknown";
}

function findMessageElement(turnElement: HTMLElement): HTMLElement | null {
  for (const selector of MESSAGE_SELECTORS) {
    const matches = [
      ...(turnElement.matches(selector) ? [turnElement] : []),
      ...Array.from(turnElement.querySelectorAll<HTMLElement>(selector))
    ];
    const match = matches.find((item) => !shouldIgnoreElement(item) && !isHiddenElement(item) && hasMeaningfulText(item));
    if (match) {
      return match;
    }
  }
  return shouldIgnoreElement(turnElement) ? null : turnElement;
}

function renderTranscriptMarkdown(title: string, turns: TranscriptTurn[]): string {
  const lines = [`# Full Transcript: ${title}`, ""];
  for (const turn of turns) {
    lines.push(`## ${turn.id} ${turn.role}`, "", turn.markdown, "");
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

async function probeTop(scrollElement: Element, deadline: number): Promise<boolean> {
  let stableCount = 0;
  let previousTop = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < MAX_TOP_PROBE_ATTEMPTS && Date.now() < deadline; attempt += 1) {
    safeSetScrollTop(scrollElement, 0);
    await waitForDomSettle();
    const currentTop = scrollElement.scrollTop;
    if (currentTop <= 2) {
      stableCount += 1;
    }
    if (Math.abs(currentTop - previousTop) <= 2 && currentTop <= 2 && stableCount >= 2) {
      return true;
    }
    previousTop = currentTop;
  }
  return scrollElement.scrollTop <= 2;
}

async function collectTurnsWhileScrollingDown(
  root: ParentNode,
  scrollElement: Element,
  deadline: number
): Promise<{ turns: TranscriptTurn[]; timeBudgetExhausted: boolean; noScrollProgress: boolean }> {
  const collected = new Map<string, { role: TranscriptRole; markdown: string }>();
  let stableBottomCount = 0;
  let previousSize = -1;
  let noProgressCount = 0;
  let previousTop = scrollElement.scrollTop;
  let noScrollProgress = false;

  for (let attempt = 0; attempt < MAX_DOWN_SCROLL_ATTEMPTS && Date.now() < deadline; attempt += 1) {
    for (const turn of extractTurns(getConversationRoot(root))) {
      collected.set(turnSignature(turn), { role: turn.role, markdown: turn.markdown });
    }

    if (isAtBottom(scrollElement)) {
      stableBottomCount = collected.size === previousSize ? stableBottomCount + 1 : 0;
      if (stableBottomCount >= 2) {
        break;
      }
    }

    previousSize = collected.size;
    safeSetScrollTop(scrollElement, Math.min(scrollElement.scrollTop + Math.max(320, getViewportStep(scrollElement)), scrollElement.scrollHeight));
    await waitForDomSettle();

    const currentTop = scrollElement.scrollTop;
    if (Math.abs(currentTop - previousTop) <= 2 && collected.size === previousSize) {
      noProgressCount += 1;
      if (noProgressCount >= 3) {
        noScrollProgress = !isAtBottom(scrollElement);
        break;
      }
    } else {
      noProgressCount = 0;
    }
    previousTop = currentTop;
  }

  return {
    turns: Array.from(collected.values()).map((turn, index) => ({
      id: `T${String(index + 1).padStart(3, "0")}`,
      role: turn.role,
      markdown: turn.markdown
    })),
    timeBudgetExhausted: Date.now() >= deadline,
    noScrollProgress
  };
}

function getConversationRoot(root: ParentNode): Element {
  return root.querySelector?.("main") ?? document.querySelector("main") ?? document.body;
}

function findScrollElement(root: ParentNode): HTMLElement | null {
  const candidates = [
    root instanceof Document ? root.scrollingElement : null,
    document.scrollingElement,
    document.querySelector("main"),
    document.documentElement,
    document.body
  ].filter((element): element is HTMLElement => element instanceof HTMLElement);

  return candidates.find((element) => element.scrollHeight > element.clientHeight + 8) ?? candidates[0] ?? null;
}

function isAtBottom(element: Element): boolean {
  return element.scrollTop + element.clientHeight >= element.scrollHeight - 4;
}

function getViewportStep(element: Element): number {
  return Math.floor(element.clientHeight * 0.82);
}

function safeSetScrollTop(element: Element, top: number): boolean {
  try {
    if ("scrollTo" in element && typeof element.scrollTo === "function") {
      element.scrollTo({ top, behavior: "instant" });
    } else {
      element.scrollTop = top;
    }
    return true;
  } catch {
    try {
      if (element === document.documentElement || element === document.body || element === document.scrollingElement) {
        window.scrollTo({ top, behavior: "instant" });
        return true;
      }
    } catch {
      return false;
    }
    return false;
  }
}

function turnSignature(turn: TranscriptTurn): string {
  const normalized = turn.markdown.replace(/\s+/g, " ").trim();
  return `${turn.role}:${normalized.slice(0, 160)}:${normalized.slice(-120)}`;
}

function waitForDomSettle(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, DOM_SETTLE_MS));
}

function renderElementToMarkdown(element: HTMLElement): string {
  return normalizeMarkdown(renderNode(element, "block"));
}

function renderNode(node: Node, mode: "block" | "inline"): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return mode === "inline" ? normalizeInline(node.nodeValue ?? "") : normalizeBlockText(node.nodeValue ?? "");
  }

  if (node.nodeType === Node.COMMENT_NODE) {
    return "";
  }

  if (!(node instanceof HTMLElement)) {
    return renderChildren(node, mode);
  }

  if (shouldIgnoreElement(node)) {
    return "";
  }

  const tag = node.tagName.toLowerCase();
  if (tag === "br") {
    return "\n";
  }
  if (tag === "pre") {
    const code = node.querySelector("code");
    const language = code ? detectCodeLanguage(code) : "";
    return `\`\`\`${language}\n${(code?.textContent ?? node.textContent ?? "").trimEnd()}\n\`\`\``;
  }
  if (tag === "code") {
    const value = normalizeInline(node.textContent ?? "");
    return mode === "inline" ? `\`${value}\`` : value;
  }
  if (tag === "a") {
    const label = renderChildren(node, "inline").trim() || node.getAttribute("href") || "";
    const href = node.getAttribute("href");
    return href ? `[${label}](${href})` : label;
  }
  if (/^h[1-6]$/.test(tag)) {
    return `${"#".repeat(Number(tag.slice(1)))} ${renderChildren(node, "inline").trim()}`;
  }
  if (tag === "li") {
    return renderListItem(node, "-");
  }
  if (tag === "ol" || tag === "ul") {
    return renderList(node, tag === "ol");
  }
  if (tag === "blockquote") {
    return renderChildren(node, "block")
      .split(/\n/)
      .filter(Boolean)
      .map((line) => `> ${line}`)
      .join("\n");
  }
  if (tag === "table") {
    return renderTable(node);
  }
  if (tag === "img") {
    const alt = node.getAttribute("alt") || "image";
    const src = node.getAttribute("src") || "";
    return src ? `![${alt}](${src})` : `[image: ${alt}]`;
  }
  if (tag === "p") {
    return renderChildren(node, "inline");
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
  return pieces.join(mode === "inline" ? " " : "\n\n");
}

function renderList(list: HTMLElement, ordered: boolean): string {
  const items = Array.from(list.children).filter((child): child is HTMLElement => child instanceof HTMLElement && child.tagName.toLowerCase() === "li");
  return items.map((item, index) => renderListItem(item, ordered ? `${index + 1}.` : "-")).join("\n");
}

function renderListItem(item: HTMLElement, marker: string): string {
  const pieces = Array.from(item.childNodes)
    .map((child) => renderNode(child, child instanceof HTMLElement && /^(ul|ol)$/i.test(child.tagName) ? "block" : "inline"))
    .filter((value) => value.trim().length > 0);
  const [first = "", ...rest] = pieces;
  const continuation = rest
    .join("\n")
    .split(/\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => `  ${line}`)
    .join("\n");
  return continuation ? `${marker} ${first.trim()}\n${continuation}` : `${marker} ${first.trim()}`;
}

function renderTable(table: HTMLElement): string {
  const rows = Array.from(table.querySelectorAll("tr")).map((row) =>
    Array.from(row.querySelectorAll("th,td")).map((cell) => normalizeInline(cell.textContent ?? ""))
  );
  if (rows.length === 0) {
    return "";
  }
  const [head, ...body] = rows;
  const separator = head.map(() => "---");
  return [head, separator, ...body].map((row) => `| ${row.join(" | ")} |`).join("\n");
}

function shouldIgnoreElement(element: HTMLElement): boolean {
  return IGNORE_SELECTORS.some((selector) => element.matches(selector) || Boolean(element.closest(selector)));
}

function isHiddenElement(element: HTMLElement): boolean {
  if (element.hidden || element.getAttribute("aria-hidden") === "true") {
    return true;
  }
  const style = element.getAttribute("style") ?? "";
  if (/\bdisplay\s*:\s*none\b|\bvisibility\s*:\s*hidden\b/i.test(style)) {
    return true;
  }
  const className = typeof element.className === "string" ? element.className : "";
  return /\bhidden\b|\bsr-only\b/.test(className);
}

function hasMeaningfulText(element: HTMLElement): boolean {
  return stripControlText(element.textContent ?? "").trim().length > 0 || element.querySelector("img") !== null;
}

function isBlockElement(element: HTMLElement): boolean {
  return [
    "article",
    "div",
    "dl",
    "fieldset",
    "figcaption",
    "figure",
    "footer",
    "hr",
    "main",
    "ol",
    "p",
    "section",
    "table",
    "ul"
  ].includes(element.tagName.toLowerCase());
}

function detectCodeLanguage(code: Element): string {
  const className = Array.from(code.classList).find((item) => item.startsWith("language-"));
  return className ? className.replace(/^language-/, "") : "";
}

function normalizeInline(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeBlockText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .split(/\n/)
    .map((line) => normalizeInline(line))
    .filter((line) => line.length > 0)
    .join("\n");
}

function normalizeMarkdown(value: string): string {
  return value
    .split(/\n/)
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\s+([.,;:!?，。；：！？])/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripControlText(value: string): string {
  return value
    .split(/\n/)
    .map((line) => line.trim())
    .filter((line) => !CONTROL_TEXT.has(line.toLowerCase()))
    .join("\n")
    .replace(/(?:^|\n)(?:展开收起|展开|收起)(?=\n|$)/g, "\n")
    .replace(/(?:展开收起|展开|收起)$/g, "")
    .trim();
}

function dedupeRenderedTurns(turns: Array<{ role: TranscriptRole; markdown: string }>): Array<{ role: TranscriptRole; markdown: string }> {
  const result: Array<{ role: TranscriptRole; markdown: string }> = [];
  for (const turn of turns) {
    const normalized = normalizeTurnText(turn.markdown);
    const previous = result[result.length - 1];
    if (previous?.role === turn.role) {
      const previousNormalized = normalizeTurnText(previous.markdown);
      if (previousNormalized === normalized) {
        continue;
      }
      const shorter = previousNormalized.length <= normalized.length ? previousNormalized : normalized;
      const longer = previousNormalized.length > normalized.length ? previousNormalized : normalized;
      const overlapRatio = shorter.length / Math.max(longer.length, 1);
      if ((overlapRatio > 0.82 && longer.includes(shorter)) || (shorter.length >= 20 && longer.startsWith(shorter))) {
        result[result.length - 1] = turn;
        continue;
      }
    }
    result.push(turn);
  }
  return result;
}

function normalizeTurnText(value: string): string {
  return value
    .replace(/[.,;:!?，。；：！？、"'`“”‘’()[\]{}<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
