# NOOS Shuttle v0 Design Breakdown

Source handoff: `noos-shuttle-v0-codex-handoff.md`

## 1. Product Boundary

NOOS Shuttle v0 is a lightweight browser extension that moves context from a ChatGPT web conversation into a portable markdown handoff file for downstream coding agents.

The v0 scope is intentionally narrow:

- Floating action button on ChatGPT pages
- Prompt injection for generating a structured NOOS Thread
- Marker-based capture of the generated markdown block
- Preview of captured thread
- Copy to clipboard
- Download as markdown
- GitHub save through an adapter interface, initially implemented as a placeholder or minimal integration

Non-goals for v0:

- No default sidebar
- No multi-agent orchestration
- No cloud account system
- No plugin-side summarization
- No automated control of other AI tools
- No complex queue or wiki construction

## 2. Architecture Proposal

Use a Chrome-compatible extension with a content-script-first architecture.

```text
ChatGPT page
  |
  | content script
  | - floating button / popover UI
  | - ChatGPT input detection
  | - prompt insertion
  | - DOM scan for NOOS markers
  |
  v
extension runtime
  |
  | background service worker
  | - extension messages
  | - download coordination
  | - future GitHub auth/save flow
  |
  v
storage adapters
  - ClipboardAdapter
  - DownloadAdapter
  - GitHubAdapter
```

The content script owns page interaction because it must read and write ChatGPT DOM state. The background worker owns privileged extension operations and future network/auth work. Storage targets share one adapter contract so GitHub never becomes the product's hard dependency.

## 3. Browser Extension Directory Structure

```text
noos-shuttle/
  manifest.json
  package.json
  tsconfig.json
  vite.config.ts
  src/
    background/
      service-worker.ts
    content/
      index.ts
      chatgpt-dom.ts
      thread-capture.ts
      prompt-injection.ts
    ui/
      FloatingButton.tsx
      ShuttlePopover.tsx
      ThreadPreview.tsx
      SettingsPanel.tsx
      styles.css
    core/
      noos-thread.ts
      prompt-templates.ts
      filename.ts
      errors.ts
    storage/
      StorageAdapter.ts
      ClipboardAdapter.ts
      DownloadAdapter.ts
      GitHubAdapter.ts
    shared/
      messages.ts
      config.ts
  public/
    icons/
  tests/
    thread-capture.test.ts
    filename.test.ts
  docs/
    noos-thread-format.md
```

Recommended stack: TypeScript plus a minimal UI layer. React is acceptable for the popover if the extension already uses Vite/React; plain DOM is also viable for the earliest spike. The first working prototype should favor simple implementation over a broad component system.

## 4. Data Model

```ts
export type NoosThreadStatus = "active" | "done" | "draft";

export interface NoosThreadFrontmatter {
  type: "noos_thread";
  version: "0.1";
  source_app: "chatgpt" | string;
  target_agent: "codex" | "claude_code" | "opencode" | string;
  status: NoosThreadStatus;
  created_at: string;
  title: string;
  tags: string[];
  preferred_path?: string;
}

export interface NoosThread {
  id: string;
  title: string;
  rawMarkdown: string;
  frontmatter?: NoosThreadFrontmatter;
  bodyMarkdown: string;
  markerRange: {
    begin: number;
    end: number;
  };
  detectedAt: string;
}
```

Parsing rules:

- Primary detection uses exact markers:
  - `<!-- NOOS:THREAD:BEGIN -->`
  - `<!-- NOOS:THREAD:END -->`
- Multiple detected marker ranges should return multiple candidates.
- YAML parsing is helpful but not required for capture success.
- If frontmatter parse fails, keep `rawMarkdown` and show a recoverable warning.

## 5. Storage Adapter Abstraction

```ts
export interface SaveOptions {
  filename?: string;
  preferredPath?: string;
  repo?: string;
  branch?: string;
  overwrite?: boolean;
}

export interface SaveResult {
  ok: boolean;
  adapterId: string;
  location?: string;
  errorCode?: string;
  message?: string;
}

export interface StorageAdapter {
  id: string;
  name: string;
  saveThread(thread: NoosThread, options?: SaveOptions): Promise<SaveResult>;
}
```

Initial adapters:

- `ClipboardAdapter`: copies `thread.rawMarkdown` using `navigator.clipboard`.
- `DownloadAdapter`: creates a `.md` file from `thread.rawMarkdown` and triggers browser download.
- `GitHubAdapter`: defines the interface and settings shape first; real auth and repo write can follow after the local workflow is stable.

Fallback principle: if GitHub fails, the UI must keep Copy and Download available.

## 6. UI Interaction Plan

Default state:

- One small floating button pinned to the right side of the page.
- The button does not resize the page or occupy persistent layout width.
- Button state can reflect capture status: normal, detected, generating, saved, error.

Popover actions:

```text
Generate Thread
Capture Thread
Save / Deliver
Settings
```

Flow:

1. User clicks floating button.
2. Popover opens.
3. `Generate Thread` inserts the prompt template into ChatGPT input.
4. If auto-submit is enabled, submit the prompt; otherwise leave it ready for user review.
5. `Capture Thread` scans visible conversation content for NOOS markers.
6. If one thread is found, show preview and delivery actions.
7. If multiple threads are found, show a compact selection list.
8. `Save / Deliver` exposes Copy, Download, and GitHub.

Error states:

- No handoff detected: "No NOOS Thread detected. Try Generate Thread first."
- Multiple handoffs detected: show list and require selection.
- GitHub save failed: show Copy, Download, Retry GitHub, Settings.
- Input box not found: "Chat input box not found. The page layout may have changed."

## 7. v0 Implementation Checklist

Phase 0: repo setup

- [ ] Add extension scaffold
- [ ] Add TypeScript build
- [ ] Add lint/test scripts
- [ ] Add basic README with local install instructions

Phase 1: content script prototype

- [ ] Inject floating action button on ChatGPT pages
- [ ] Open compact popover
- [ ] Add Generate / Capture / Deliver / Settings actions
- [ ] Detect ChatGPT input box
- [ ] Insert handoff prompt
- [ ] Support manual-submit default

Phase 2: thread capture

- [ ] Scan page text/markdown-like message content
- [ ] Detect exact begin/end markers
- [ ] Return zero, one, or many `NoosThread` candidates
- [ ] Parse title and optional YAML frontmatter
- [ ] Show preview before saving

Phase 3: delivery

- [ ] Copy captured thread to clipboard
- [ ] Download captured thread as `.md`
- [ ] Generate safe filename from title/date
- [ ] Add `StorageAdapter` contract
- [ ] Add placeholder `GitHubAdapter`
- [ ] Preserve Copy/Download fallback when GitHub is unavailable

Phase 4: hardening

- [ ] Add unit tests for marker capture
- [ ] Add unit tests for filename generation
- [ ] Test on current ChatGPT page layout
- [ ] Add user-facing error messages
- [ ] Document known limitations

## 8. Open Questions And Risks

- ChatGPT DOM changes frequently. The input detector should use several strategies and fail with a clear message.
- Capturing rendered markdown from ChatGPT may lose exact code fence formatting if reading plain text only. The capture implementation should test both DOM text extraction and clipboard-like markdown extraction paths.
- Auto-submit may surprise users. Default should be off unless the user explicitly enables it.
- GitHub auth is the highest-friction delivery target. It should be delayed until copy/download is solid.
- Browser extension permissions should stay minimal at first: ChatGPT host permission, clipboard write, downloads, storage.
- The name and exact icon language should remain flexible until the first prototype is usable.

## 9. Immediate Next Step

Start with the local extension prototype:

1. Create `noos-shuttle/manifest.json`.
2. Add a content script that injects the floating button and popover.
3. Implement prompt insertion with manual-submit default.
4. Implement marker-based capture and preview.
5. Implement Clipboard and Download adapters.
6. Leave GitHub as an interface plus settings placeholder.
