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

const GENERATION_ACTIVE_SELECTORS = [
  "[data-testid='stop-button']",
  "[data-testid='composer-stop-button']",
  "button[aria-label='Stop generating']",
  "button[aria-label='Stop streaming']",
  "button[aria-label='停止生成']",
  "button[aria-label='停止']"
];

export function getPageText(): string {
  const main = document.querySelector("main");
  return collectMarkdownAndComments(main ?? document.body).trim();
}

export function insertIntoChatInput(text: string): boolean {
  const input = findChatInput();
  if (!input) {
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

export async function submitChatInput(): Promise<boolean> {
  await waitForComposerUpdate();

  const button = findSendButton();
  if (button) {
    button.click();
    return true;
  }

  const input = findChatInput();
  if (!input) {
    return false;
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
  return Boolean(findGenerationActiveButton()) || !findSendButton();
}

function findChatInput(): HTMLElement | null {
  for (const selector of INPUT_SELECTORS) {
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(selector));
    const visible = candidates.find((candidate) => isVisible(candidate) && !candidate.closest("[aria-hidden='true']"));
    if (visible) {
      return visible;
    }
  }

  return null;
}

function findSendButton(): HTMLButtonElement | null {
  for (const selector of SEND_BUTTON_SELECTORS) {
    const candidates = Array.from(document.querySelectorAll<HTMLButtonElement>(selector));
    const visible = candidates.find((candidate) => isVisible(candidate) && !candidate.disabled && !candidate.closest("[aria-hidden='true']"));
    if (visible) {
      return visible;
    }
  }

  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
  return (
    buttons.find((button) => {
      const label = `${button.getAttribute("aria-label") ?? ""} ${button.textContent ?? ""}`.trim();
      return isVisible(button) && !button.disabled && /send|发送/i.test(label);
    }) ?? null
  );
}

function findGenerationActiveButton(): HTMLButtonElement | null {
  for (const selector of GENERATION_ACTIVE_SELECTORS) {
    const candidates = Array.from(document.querySelectorAll<HTMLButtonElement>(selector));
    const visible = candidates.find((candidate) => isVisible(candidate) && !candidate.closest("[aria-hidden='true']"));
    if (visible) {
      return visible;
    }
  }

  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
  return (
    buttons.find((button) => {
      const label = `${button.getAttribute("aria-label") ?? ""} ${button.textContent ?? ""}`.trim();
      return isVisible(button) && /stop|停止/i.test(label);
    }) ?? null
  );
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
        "#noos-shuttle-root"
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

  if (tagName === "pre") {
    return node.textContent?.trim() ?? "";
  }

  if (tagName === "code") {
    return mode === "inline" ? `\`${normalizeInlineText(node.textContent ?? "")}\`` : node.textContent?.trim() ?? "";
  }

  if (/^h[1-6]$/.test(tagName)) {
    const level = Number(tagName.slice(1));
    return `${"#".repeat(level)} ${renderChildren(node, "inline").trim()}`;
  }

  if (tagName === "li") {
    return `- ${renderChildren(node, "inline").trim()}`;
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
    "hr",
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
