# NOOS Hub Local Write Channel

## Problem

The browser extension needs to save handoffs into the NOOS local filesystem, but Chrome extensions cannot silently write arbitrary files to `~/.noos`.

The current v0 bridge writes to:

```text
~/Downloads/NOOS/vault/handoffs/active/
```

That is useful as a fallback, but it is not the final product experience. The user expectation is `Save 2 Vault` meaning "save into NOOS", not "download a file and let Hub import it later".

## Recommended Direction

NOOS Hub should expose a local write channel owned by the desktop app:

```text
Browser Shuttle extension
  -> localhost NOOS Hub write endpoint
  -> ~/.noos/vault/handoffs/active/
  -> optional Hub-driven Git sync
```

This keeps the browser extension small and keeps filesystem authority inside Hub.

## Transport Choice

Use a localhost HTTP endpoint first, with Native Messaging as a later fallback for managed or locked-down browser environments.

### Why Localhost HTTP First

- Works with Chrome extension `fetch`.
- Works while Hub is running as a desktop app or background helper.
- Easy to debug with curl.
- Allows a clear health endpoint for the extension.
- Can later support other browser extensions and local tools.

### Why Not Native Messaging First

Native Messaging is powerful, but it requires installing a browser-specific host manifest. That increases first-run setup complexity and makes the install story harder on Windows and macOS. It should remain a fallback for environments where localhost is blocked.

## Security Model

The local write endpoint must not be an unauthenticated open port.

Hub creates a machine-local browser write token:

```text
~/.noos/runtime/shuttle-token.json
```

Suggested shape:

```json
{
  "version": 1,
  "token": "<random 256-bit token>",
  "created_at": "2026-05-06T00:00:00Z"
}
```

The extension obtains the token automatically when Hub is running:

1. Browser Shuttle checks `GET /health`.
2. If it has no local token, it calls `GET /pair`.
3. Hub returns the machine-local token over `127.0.0.1`.
4. Browser Shuttle stores the token in `chrome.storage.local`.
5. Future writes use `Authorization: Bearer <token>`.

Requests include:

```http
POST http://127.0.0.1:<port>/v1/ingest
Authorization: Bearer <token>
Content-Type: application/json
```

Payload:

```json
{
  "protocol_version": 1,
  "request_id": "uuid",
  "idempotency_key": "sha256-source-url-type-content",
  "object_type": "handoff",
  "source": {
    "app": "browser-shuttle",
    "url": "https://chatgpt.com/...",
    "captured_at": "2026-05-21T10:30:00+08:00"
  },
  "suggested": {
    "lookup_key": "optional-semantic-key",
    "filename": "2026-05-21-example.md",
    "status": "active"
  },
  "content": {
    "media_type": "text/markdown",
    "text": "<NOOS handoff markdown>"
  }
}
```

The same endpoint accepts NOOS Crystal writes:

```json
{
  "protocol_version": 1,
  "object_type": "crystal",
  "suggested": {
    "filename": "2026-05-21-discussion-snapshot.md",
    "status": "active"
  },
  "content": {
    "media_type": "text/markdown",
    "text": "<NOOS crystal markdown>"
  }
}
```

`POST /v1/handoffs` remains a compatibility shim for older Browser Shuttle builds. The compatibility shape still accepts `kind`, `filename`, and `content`, then internally normalizes into `/v1/ingest`.

Context Pack file requests use `kind: "context_pack_file"` and a safe relative `filename` such as:

```json
{
  "kind": "context_pack_file",
  "filename": "2026-05-25-chatgpt-context/manifest.yaml",
  "content": "type: noos_context_pack\n..."
}
```

Hub writes those files under:

```text
~/.noos/vault/context-packs/
```

Browser fallback writes the same relative structure under:

```text
~/Downloads/NOOS/vault/context-packs/
```

Hub validates:

- token matches
- request origin is allowed when available
- content contains NOOS begin/end markers
- filename is sanitized, but Hub derives the canonical lookup key and final filename
- write path stays inside the matching artifact vault, such as `~/.noos/vault/handoffs/active/`, `~/.noos/vault/crystals/active/`, or `~/.noos/vault/context-packs/`
- object metadata is written into `~/.noos/vault/index/keys.json` and `objects.json`
- every indexed object includes `object_id`, `lookup_key`, `path`, `type`, `source`, and `created_at`
- repeated writes with the same `idempotency_key` return the original receipt instead of writing another file
- `content_hash` is recorded as object metadata for audit/change detection; duplicate receipt behavior is keyed by the stable `object_id` derived from `idempotency_key` or content identity

## Risks and Product Traps

The final local write channel has several sharp edges:

- Local port exposure: even a localhost-only service can be called by other local software and sometimes by web pages through browser-mediated requests. Hub must authenticate every write.
- Token lifecycle: browser write tokens can be lost when the user changes Chrome profiles, reinstalls the extension, migrates machines, or runs dev and release builds side by side.
- Local trust boundary: local software running as the same OS user can theoretically request a token from `127.0.0.1`. This is an explicit local-first product tradeoff; sensitive boundaries rely on OS account isolation, not a manual pairing ritual.
- Hub availability: the browser extension can be active while Hub is closed. The extension must keep a recovery path rather than pretending the handoff reached the real vault.
- Version drift: old Hub plus new extension, or new Hub plus old extension, can disagree on protocol shape. `/health` must report protocol version.
- Path safety: the extension must never be allowed to choose arbitrary filesystem paths. It may suggest a filename; Hub decides the final path.
- Duplicate writes: users may click save several times or collect multiple revisions. Hub should use sanitized filenames, idempotency-derived `object_id` checks, recorded content hashes, and atomic writes.
- Privacy boundary: handoffs can contain private project context. Git sync must remain a separate explicit action, and logs should not print full handoff bodies.
- Cross-platform install: Native Messaging registration and filesystem conventions differ across macOS, Windows, and Linux. Localhost HTTP is easier to ship first.
- Corporate browser policy: some managed machines may block localhost, extension host permissions, downloads, or Native Messaging.
- UX ambiguity: users need to know whether a handoff is in the real local vault, only in the browser mirror, or synced to Git.

## UX Behavior

The extension should use a three-step save strategy:

1. Try Hub local write endpoint.
2. If Hub is not running, show `Open NOOS Hub` and keep the handoff in the panel.
3. If the user chooses fallback, write to `Downloads/NOOS/vault/handoffs/active/`.

The default should not silently fall back to Downloads forever. Downloads is a recovery bridge, not the primary vault.

## Phase 1: Downloads Mirror Bridge

The first implementation stage keeps the browser extension within Chrome's built-in permissions:

```text
Browser Shuttle
  -> chrome.downloads
  -> ~/Downloads/NOOS/vault/handoffs/active/
  -> Hub action: Import Browser Mirror
  -> ~/.noos/vault/handoffs/active/
```

This stage intentionally does not open a localhost write endpoint yet. It improves the current bridge by making the boundary explicit:

- `Save 2 Vault` in the extension saves to the browser-writable mirror.
- The extension UI labels this as a mirror that Hub can import.
- Hub exposes `Import Browser Mirror` as a local-only action.
- `Sync Handoff to Git` remains separate and can import from the local vault as part of its workflow.
- Release packages include the standalone `scripts/noos-import-browser-vault.sh` helper.

This gives users a predictable local file path today while preserving the final architecture where Hub owns direct writes to `~/.noos`.

## Hub Responsibilities

Hub owns:

- creating the local vault directories
- issuing and resetting the Browser Shuttle local write token
- receiving handoffs
- validating and writing handoff files
- showing recent handoffs
- retrying failed writes
- Git sync as a separate user action

The browser extension owns:

- generating and capturing handoffs
- previewing validation warnings
- sending a save request to Hub
- fallback download only when Hub is unavailable

## Minimal v1 Plan

1. Add a Hub background listener on `127.0.0.1` with a random available port.
2. Persist the port and token under `~/.noos/runtime/`.
3. Add Browser Shuttle connection status and reset in Hub.
4. Add extension settings for local Hub connection status.
5. Change `NoosVaultAdapter` to try Hub HTTP first, Downloads mirror second.
6. Keep `Sync Handoff to Git` as an explicit Hub button.

This gives a smooth default path while preserving a clear safety boundary: only Hub writes to the NOOS filesystem.

## v0.2 Alpha Implementation

The first direct-write implementation uses a deliberately small local protocol:

```text
GET  http://127.0.0.1:17642/health
GET  http://127.0.0.1:17642/pair
POST http://127.0.0.1:17642/v1/ingest
```

The browser extension tries the Hub endpoint first. If Hub is unavailable, it falls back to:

```text
~/Downloads/NOOS/vault/handoffs/active/
```

Hub writes successful handoff requests directly to:

```text
~/.noos/vault/handoffs/active/
```

Crystal requests with `object_type: "crystal"` are written directly to:

```text
~/.noos/vault/crystals/active/
```

Implemented checks:

- Listen only on `127.0.0.1`.
- Accept `POST /v1/ingest` and compatibility endpoints.
- Reject non-extension origins when an `Origin` header is present.
- Validate NOOS begin/end markers before writing.
- Sanitize filenames, derive a stable lookup key, and force `.md`.
- Keep writes inside the matching NOOS Vault artifact directory.
- Write through a temporary file and then rename.
- Generate a unique filename when a target already exists.
- Update `vault/index/keys.json`, `objects.json`, `graph.json`, and `backlinks.json`.

Known gaps:

- Port discovery is fixed to `17642`; future Hub should persist runtime port data under `~/.noos/runtime/`.
- Extension status UI does not yet show "Hub connected" separately from "Downloads fallback".
- CORS still allows broad local response headers; request-level origin checks are the real guard in this alpha.

## v0.2 Browser Connection Token

The direct-write endpoint now has a minimal automatic connection token flow:

```text
Browser Shuttle
  -> POST /v1/ingest without token
  -> receive 401 unauthorized
  -> GET /pair from localhost
  -> store token in chrome.storage.local
  -> retry POST /v1/ingest with Authorization: Bearer <token>
```

`/pair` returns the local token when Hub is running on `127.0.0.1`. This removes the manual pairing step for the common same-machine browser-plus-Hub case.

Implemented token checks:

- `POST /v1/ingest` requires `Authorization: Bearer <token>`.
- Hub stores the token under `~/.noos/runtime/shuttle-token.json`.
- Browser Shuttle stores the token in `chrome.storage.local`.
- Hub `/health` reports whether a token exists, but does not return the token.

Remaining hardening:

- Add token rotation and richer disconnect UI.
- Bind token metadata to the expected extension id where possible.
- Move from fixed port to runtime discovery.

## Extension Status UI

Browser Shuttle displays the active vault route in its panel:

- Hub direct write connected.
- Hub is running but the browser connection needs repair.
- Hub is unavailable; saves use the Browser Vault Mirror.
- Checking route while the background service worker probes Hub.

The status is refreshed when the panel opens, when the user clicks refresh, and after a vault save. This keeps the user-facing language aligned with the actual storage path used for the latest operation.
