import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { restoreEditableControls, snapshotEditableControls } from "../src/content/panel-input-preservation";

/**
 * Issue #126's deliverable 1: a full-DOM panel rebuild must not eat what the
 * Human is typing. These cases simulate the rebuild the way `render()` performs
 * it — same-shaped controls, brand-new nodes — and assert value, caret,
 * selection and focus survive.
 */

function withDom(html: string, callback: () => void): void {
  const dom = new JSDOM(html, { url: "https://chatgpt.com/c/example", pretendToBeVisual: true });
  const win = dom.window as unknown as Window & typeof globalThis;
  const keys = ["document", "window", "Node", "Element", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement"] as const;
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const key of keys) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value: win[key as keyof typeof win], configurable: true });
  }
  try {
    callback();
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
  }
}

/** The settings-panel shape the real template emits for the pairing row. */
const PANEL = `<div class="shuttle">
  <input class="bcr-eval-input" type="text" inputmode="numeric" maxlength="8" data-hub-pairing-input autocomplete="off" />
  <input type="checkbox" data-action="toggle-transcript" />
  <textarea class="outbox-input" data-outbox-input="true" placeholder="queued"></textarea>
  <textarea class="outbox-edit-input" data-outbox-edit-input="item-7">old payload</textarea>
</div>`;

function rebuild(root: HTMLElement): void {
  // What render() does: replace every node, same shape.
  root.innerHTML = PANEL.replace('old payload', '').replace('item-7', 'item-7');
}

describe("snapshotEditableControls / restoreEditableControls (issue #126)", () => {
  it("preserves a half-typed pairing code, its caret and the focus across a rebuild", () => {
    withDom(PANEL, () => {
      const root = document.querySelector(".shuttle") as HTMLElement;
      const input = root.querySelector<HTMLInputElement>("[data-hub-pairing-input]")!;
      input.value = "1234";
      input.focus();
      input.setSelectionRange(2, 2);

      const snapshot = snapshotEditableControls(root);
      rebuild(root);
      restoreEditableControls(root, snapshot);

      const rebuilt = root.querySelector<HTMLInputElement>("[data-hub-pairing-input]")!;
      expect(rebuilt).not.toBe(input); // a genuinely new node — the rebuild really happened
      expect(rebuilt.value).toBe("1234");
      expect(rebuilt.selectionStart).toBe(2);
      expect(rebuilt.selectionEnd).toBe(2);
      expect(document.activeElement).toBe(rebuilt);
    });
  });

  it("preserves a text selection, not just the caret", () => {
    withDom(PANEL, () => {
      const root = document.querySelector(".shuttle") as HTMLElement;
      const input = root.querySelector<HTMLInputElement>("[data-hub-pairing-input]")!;
      input.value = "56781234";
      input.focus();
      input.setSelectionRange(1, 5, "backward");

      const snapshot = snapshotEditableControls(root);
      rebuild(root);
      restoreEditableControls(root, snapshot);

      const rebuilt = root.querySelector<HTMLInputElement>("[data-hub-pairing-input]")!;
      expect(rebuilt.selectionStart).toBe(1);
      expect(rebuilt.selectionEnd).toBe(5);
      expect(rebuilt.selectionDirection).toBe("backward");
    });
  });

  it("keys the outbox edit box by its item id, so multiple editors do not cross-wire", () => {
    withDom(`<div class="shuttle">
      <textarea data-outbox-edit-input="item-7"></textarea>
      <textarea data-outbox-edit-input="item-9"></textarea>
    </div>`, () => {
      const root = document.querySelector(".shuttle") as HTMLElement;
      const [first, second] = Array.from(root.querySelectorAll<HTMLTextAreaElement>("[data-outbox-edit-input]"));
      first.value = "payload for seven";
      second.value = "payload for nine";
      second.focus();
      second.setSelectionRange(6, 6);

      const snapshot = snapshotEditableControls(root);
      root.innerHTML = `<textarea data-outbox-edit-input="item-7"></textarea><textarea data-outbox-edit-input="item-9"></textarea>`;
      restoreEditableControls(root, snapshot);

      const [rebuiltFirst, rebuiltSecond] = Array.from(root.querySelectorAll<HTMLTextAreaElement>("[data-outbox-edit-input]"));
      expect(rebuiltFirst.value).toBe("payload for seven");
      expect(rebuiltSecond.value).toBe("payload for nine");
      expect(rebuiltSecond.selectionStart).toBe(6);
      expect(document.activeElement).toBe(rebuiltSecond);
    });
  });

  it("restores checkbox state so a template/rendered mismatch cannot flip a setting back", () => {
    withDom(PANEL, () => {
      const root = document.querySelector(".shuttle") as HTMLElement;
      const box = root.querySelector<HTMLInputElement>("input[data-action='toggle-transcript']")!;
      box.checked = true;

      const snapshot = snapshotEditableControls(root);
      // The rebuild renders the checkbox from viewState — suppose viewState had
      // not caught up; the restore must still put the Human's toggle back.
      rebuild(root);
      restoreEditableControls(root, snapshot);
      expect(root.querySelector<HTMLInputElement>("input[data-action='toggle-transcript']")!.checked).toBe(true);
    });
  });

  it("leaves controls alone when the rebuilt panel no longer contains them (modal closed, etc.)", () => {
    withDom(PANEL, () => {
      const root = document.querySelector(".shuttle") as HTMLElement;
      const snapshot = snapshotEditableControls(root);
      root.innerHTML = `<button type="button">no inputs here</button>`;
      expect(() => restoreEditableControls(root, snapshot)).not.toThrow();
    });
  });

  it("does not steal focus that was elsewhere before the rebuild", () => {
    withDom(PANEL, () => {
      const root = document.querySelector(".shuttle") as HTMLElement;
      const input = root.querySelector<HTMLInputElement>("[data-hub-pairing-input]")!;
      input.value = "1234";
      // Not focused — the Human had clicked away.
      const snapshot = snapshotEditableControls(root);
      rebuild(root);
      restoreEditableControls(root, snapshot);
      expect(document.activeElement).not.toBe(root.querySelector("[data-hub-pairing-input]"));
    });
  });

  it("without the restore, the rebuild really does destroy the value (the mutation this guards against)", () => {
    withDom(PANEL, () => {
      const root = document.querySelector(".shuttle") as HTMLElement;
      const input = root.querySelector<HTMLInputElement>("[data-hub-pairing-input]")!;
      input.value = "1234";
      input.focus();
      const snapshot = snapshotEditableControls(root);
      rebuild(root);
      // Deliberately no restore: this is the pre-fix behaviour.
      const rebuilt = root.querySelector<HTMLInputElement>("[data-hub-pairing-input]")!;
      expect(rebuilt.value).toBe("");
      expect(document.activeElement).not.toBe(rebuilt);
      void snapshot;
    });
  });
});
