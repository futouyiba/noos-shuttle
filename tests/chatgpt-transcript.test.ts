import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { captureRenderedChatGptTranscript } from "../src/content/chatgpt-transcript";

function withDom(html: string, callback: () => void): void {
  const dom = new JSDOM(html, { url: "https://chatgpt.com/c/example" });
  const previousDocument = globalThis.document;
  const previousHTMLElement = globalThis.HTMLElement;
  const previousNode = globalThis.Node;
  Object.defineProperty(globalThis, "document", { value: dom.window.document, configurable: true });
  Object.defineProperty(globalThis, "HTMLElement", { value: dom.window.HTMLElement, configurable: true });
  Object.defineProperty(globalThis, "Node", { value: dom.window.Node, configurable: true });
  try {
    callback();
  } finally {
    Object.defineProperty(globalThis, "document", { value: previousDocument, configurable: true });
    Object.defineProperty(globalThis, "HTMLElement", { value: previousHTMLElement, configurable: true });
    Object.defineProperty(globalThis, "Node", { value: previousNode, configurable: true });
  }
}

describe("captureRenderedChatGptTranscript", () => {
  it("extracts user and assistant turns from rendered ChatGPT DOM", () => {
    withDom(
      `<body>
        <aside>Old sidebar conversation should not be captured</aside>
        <main>
          <article data-testid="conversation-turn-1">
            <div data-message-author-role="user">
              <div class="whitespace-pre-wrap">Please build the Context Pack flow.</div>
            </div>
          </article>
          <article data-testid="conversation-turn-2">
            <div data-message-author-role="assistant">
              <div class="markdown">
                <p>Use a short handoff plus transcript background.</p>
                <ul><li>Preserve raw turns</li><li>Query on demand</li></ul>
              </div>
            </div>
          </article>
        </main>
      </body>`,
      () => {
        const transcript = captureRenderedChatGptTranscript();

        expect(transcript.turns).toHaveLength(2);
        expect(transcript.turns[0]).toMatchObject({ id: "T001", role: "user" });
        expect(transcript.turns[1]).toMatchObject({ id: "T002", role: "assistant" });
        expect(transcript.markdown).toContain("## T001 user");
        expect(transcript.markdown).toContain("Please build the Context Pack flow.");
        expect(transcript.markdown).toContain("- Preserve raw turns");
        expect(transcript.markdown).not.toContain("Old sidebar conversation");
      }
    );
  });

  it("preserves code blocks, links, blockquotes, and tables", () => {
    withDom(
      `<main>
        <article data-testid="conversation-turn-1">
          <div data-message-author-role="assistant">
            <div class="markdown">
              <p>Run <code>npm test</code>.</p>
              <pre><code class="language-ts">const ok: boolean = true;</code></pre>
              <blockquote><p>Keep original wording.</p></blockquote>
              <p><a href="https://example.com">Example</a></p>
              <table><tr><th>File</th><th>Status</th></tr><tr><td>manifest.yaml</td><td>required</td></tr></table>
            </div>
          </div>
        </article>
      </main>`,
      () => {
        const transcript = captureRenderedChatGptTranscript();

        expect(transcript.markdown).toContain("Run `npm test`.");
        expect(transcript.markdown).toContain("```ts\nconst ok: boolean = true;\n```");
        expect(transcript.markdown).toContain("> Keep original wording.");
        expect(transcript.markdown).toContain("[Example](https://example.com)");
        expect(transcript.markdown).toContain("| File | Status |");
        expect(transcript.markdown).toContain("| manifest.yaml | required |");
      }
    );
  });

  it("excludes composer, action buttons, and NOOS panel content", () => {
    withDom(
      `<main>
        <article data-testid="conversation-turn-1">
          <div data-message-author-role="assistant">
            <div class="markdown">
              <p>Actual answer.</p>
              <button>Copy</button>
            </div>
          </div>
        </article>
        <form><textarea>Draft prompt should not be captured</textarea></form>
        <div id="noos-shuttle-root">NOOS panel should not be captured</div>
      </main>`,
      () => {
        const transcript = captureRenderedChatGptTranscript();

        expect(transcript.markdown).toContain("Actual answer.");
        expect(transcript.markdown).not.toContain("Copy");
        expect(transcript.markdown).not.toContain("Draft prompt");
        expect(transcript.markdown).not.toContain("NOOS panel");
      }
    );
  });

  it("preserves pre-wrap line breaks and strips expand/collapse controls", () => {
    withDom(
      `<main>
        <article data-testid="conversation-turn-1">
          <div data-message-author-role="user">
            <div class="whitespace-pre-wrap">First paragraph.

Second paragraph.
- existing bullet
展开收起</div>
          </div>
        </article>
      </main>`,
      () => {
        const transcript = captureRenderedChatGptTranscript();

        expect(transcript.markdown).toContain("First paragraph.\nSecond paragraph.\n- existing bullet");
        expect(transcript.markdown).not.toContain("展开收起");
      }
    );
  });

  it("ignores hidden edited branches and near-duplicate rendered turns", () => {
    withDom(
      `<main>
        <article data-testid="conversation-turn-1" style="display: none">
          <div data-message-author-role="user">
            <div class="whitespace-pre-wrap">Hidden old draft.</div>
          </div>
        </article>
        <article data-testid="conversation-turn-2">
          <div data-message-author-role="user">
            <div class="whitespace-pre-wrap">Current edited message with extra context.</div>
          </div>
        </article>
        <article data-testid="conversation-turn-3">
          <div data-message-author-role="user">
            <div class="whitespace-pre-wrap">Current edited message.</div>
          </div>
        </article>
        <article data-testid="conversation-turn-4">
          <div data-message-author-role="assistant">
            <div class="markdown"><p>Assistant answer.</p></div>
          </div>
        </article>
      </main>`,
      () => {
        const transcript = captureRenderedChatGptTranscript();

        expect(transcript.turns).toHaveLength(2);
        expect(transcript.turns[0]).toMatchObject({ id: "T001", role: "user" });
        expect(transcript.turns[0].markdown).toBe("Current edited message.");
        expect(transcript.markdown).not.toContain("Hidden old draft");
      }
    );
  });

  it("captures image references in message content", () => {
    withDom(
      `<main>
        <article data-testid="conversation-turn-1">
          <div data-message-author-role="user">
            <div class="whitespace-pre-wrap">
              <p>See this screenshot.</p>
              <img alt="NOOS shuttle floating button" src="blob:https://chatgpt.com/example-image" />
            </div>
          </div>
        </article>
      </main>`,
      () => {
        const transcript = captureRenderedChatGptTranscript();

        expect(transcript.markdown).toContain("See this screenshot.");
        expect(transcript.markdown).toContain("![NOOS shuttle floating button](blob:https://chatgpt.com/example-image)");
      }
    );
  });
});
