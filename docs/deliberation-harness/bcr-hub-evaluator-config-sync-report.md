# BCR Evaluator Config — NOOS Hub Settings & Sync Report (v0)

> Working report for the Hub-side evaluator configuration UI and the pull-based sync lane. Working paper, not a contract. Companions: `bcr-auto-x5-evaluator-report.md` (AUTO ×5, merged `83971f7`), `bcr-minimum-usable-loop-report.md`.

## 1. Decision

The Hub needed a settings surface for the BCR continuation evaluator (DeepSeek key/model). The Hub↔extension bridge is unidirectional (the extension calls Hub's `127.0.0.1:17642`; the Hub cannot reach the MV3 service worker), so "a settings box in the Hub" has two architectures. The Human chose **B: Hub edits + extension pulls** over Hub-proxy execution:

- The Hub owns one editing surface and stores the config in its existing user config file (`~/.noos/config.json` → `bcrEvaluator.{apiKey, model}`).
- The extension pulls, re-validates, and lands the config into its own `chrome.storage.local` (`noosBcrEvaluatorConfig`) via an **explicit user click** — never automatically. "Last sync wins" is therefore always user-timed, and the extension keeps working standalone (Hub need not run during AUTO rounds).
- Declined for now: Hub-proxy execution (path A) — larger Rust surface and a Hub-must-run dependency; revisit if key-centralization becomes a requirement.

Boundary unchanged: the Hub gains **no** run-truth mutation authority. Runs, SubmissionOperations, and the conservative gate stay in the extension coordinator; the Hub only stores environment credentials.

## 2. Hub side (`apps/noos-hub`)

- `src/pages/config.ts`: `ConfigData` gains `bcrEvaluator`; new "BCR 自动评估（Shuttle 扩展）" config section — a `secretRow` variant (masked display `sk-…last4`, password edit input) for `bcrEvaluator.apiKey`, an editable row for `bcrEvaluator.model` (placeholder `deepseek-chat`), and a readonly row stating the activation semantics. All rows ride the existing generic `write_config` dotted-key machinery — no new Tauri commands.
- `src/main.ts`: `saveConfigValue` masks the API-key row after save (no plaintext echo into the settings list) and keeps the in-memory `bcrEvaluator` cache branch consistent.
- `src-tauri/src/main.rs`: new authorized pull endpoint `GET /v1/bcr/evaluator-config` (same `is_authorized_handoff_write` Bearer-token gate as the vault/focus GETs). The endpoint fixes `baseUrl` to `https://api.deepseek.com` by construction (the single allowlisted host, mirroring `BCR_EVALUATOR_ALLOWED_HOST` in the extension) and serves `configured: true` only when both fields are non-empty; the key travels only over the paired localhost bridge and is re-validated extension-side before storage. Pure projection `bcr_evaluator_config_payload_from` is unit-tested (empty/partial/complete + trimmed fields).

## 3. Extension side

- `NOOS_CONTINUATION_EVAL_SYNC` lane (same provider-sender gate as the other BCR lanes) → `handleContinuationEvalSync` via the existing `fetchHubJsonWithRepair` (pair/re-pair included):
  - transport/pairing failure or error-shaped payload (`{ok:false, errorCode}` — the Hub helper family reports unreachability as payloads, not exceptions) → `{ok:false, error:"hub_unreachable"}`;
  - Hub not configured → `{ok:true, synced:false, reason:"hub_not_configured"}`;
  - served config off the allowlist → `{ok:true, synced:false, reason:"hub_config_invalid"}` (local store untouched);
  - valid → normalized and written locally → `{ok:true, synced:true, model}`.
- Shuttle settings panel gains a 「从 NOOS Hub 同步」 button (en/zh copy); feedback lands in the panel header message. The evaluator-config storage key remains owned by the background — the content script still never touches it.

## 4. Tests and verification

- `tests/background-continuation-run.test.ts` sync-lane case: unreachable (simulated — a real Hub may be live on 127.0.0.1:17642 on dev machines, so it is stubbed, never assumed), hub-not-configured, successful sync landing exactly the normalized config, and allowlist-refusal leaving the previous local config intact. The URL-aware fetch stub also serves `/pair`, exercising the real re-pair path.
- Hub: `npm run hub:web:build` green; `cargo test bcr_evaluator` green; my Rust region is `cargo fmt --check` clean.
- Root: `npm run typecheck` clean; release-parity suite 38 files / 485 tests green; `npm run build` exactly two entry files; content-ui-smoke 28/28.

## 5. Known notes / limits

1. Pre-existing `cargo fmt --check` drift exists in main's carrier-focus region (13 hunks, PR #47 lineage, untouched here); only this change's Rust region is fmt-clean. Flagged for a follow-up formatting commit.
2. The worktree build needed `resources/noos-shuttle-extension` (gitignored, generated) copied from the main checkout for the Tauri build script; not committed.
3. Sync is click-triggered only by design (automatic pulls would silently override a locally-set key). The Hub settings page states the activation step.
4. `HUB_LIVE_PROJECTION_PENDING` (live BCR run-state projection to the Hub console) is unchanged and still open.

## 6. Deliverables

- Branch `bcr/hub-evaluator-config-sync` (from `origin/main`); exact head recorded on the PR.
- Modified: `apps/noos-hub/src/pages/config.ts`, `apps/noos-hub/src/main.ts`, `apps/noos-hub/src-tauri/src/main.rs`, `src/background/service-worker.ts`, `src/content/index.ts`, `src/shared/i18n.ts`, `tests/background-continuation-run.test.ts`; new: this report.
