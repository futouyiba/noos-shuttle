const INPUT_SELECTORS = [
  "textarea",
  "div[contenteditable='true'][data-lexical-editor='true']",
  "div[contenteditable='true']",
  "[role='textbox']"
];

export function getPageText(): string {
  const main = document.querySelector("main");
  return collectVisibleTextAndComments(main ?? document.body).trim();
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

function isVisible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
}

function collectVisibleTextAndComments(root: Element): string {
  const chunks: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_COMMENT);

  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (shouldIgnoreNode(node)) {
      continue;
    }

    if (node.nodeType === Node.COMMENT_NODE) {
      chunks.push(`<!-- ${node.nodeValue?.trim() ?? ""} -->`);
      continue;
    }

    const value = node.nodeValue?.trim();
    if (value) {
      chunks.push(value);
    }
  }

  return chunks.join("\n");
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
