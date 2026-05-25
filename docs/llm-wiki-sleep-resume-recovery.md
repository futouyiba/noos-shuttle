# LLM Wiki Sleep / Resume Recovery

## Source Integration

LLM Wiki is vendored into this repository under:

```text
apps/llm-wiki/
```

The source was copied from the local `llos-mem/llm_wiki` worktree without its
nested `.git`, `node_modules`, `dist`, Tauri `target`, or generated files. The
copied app is now managed by the `noos-shuttle` git repository.

Root helper scripts:

```sh
npm run wiki:vendor-check
npm run wiki:typecheck
npm run wiki:build
npm run wiki:test
npm run wiki:dev
```

## Recovery Behavior

LLM Wiki no longer exits immediately after a long backend wall-clock gap. The
backend records sleep recovery state and exposes commands for:

- `get_sleep_recovery_status`
- `mark_sleep_suspended`
- `recover_from_sleep`
- `mark_sleep_recovery_healthy`
- `mark_sleep_recovery_degraded`
- `simulate_sleep_resume`

The frontend listens for:

- `tauri://suspended`
- `tauri://resumed`

On resume, the frontend recovery path:

1. Marks backend recovery state.
2. Restarts the clipboard watcher without accumulating duplicate intervals.
3. Restores the ingest queue for the current project.
4. Reloads source-watch config.
5. Restarts the project file watcher if enabled.
6. Runs an explicit file-sync rescan so file events lost during sleep are caught.
7. Restarts scheduled import if enabled; `startScheduledImport` already stops
   any previous interval before starting a new one.
8. Refreshes the current project file tree and bumps the Wiki data version.
9. Marks the backend recovery state as healthy only after the frontend recovery
   steps complete; if any step fails, it marks the state degraded instead.
10. Recommends relaunch after a degraded recovery. If
    `LLM_WIKI_AUTO_RELAUNCH_AFTER_SLEEP=1` is set, LLM Wiki marks the state as
    `relaunching`, spawns a replacement process, and exits the current process.

This is intentionally model-free. Recovery does not require a provider key or
any remote API call.

## Test Hooks

Backend wall-clock threshold can be shortened for manual testing:

```sh
LLM_WIKI_SLEEP_GAP_SECS=5 npm run wiki:dev
```

Automatic relaunch after degraded recovery is opt-in:

```sh
LLM_WIKI_AUTO_RELAUNCH_AFTER_SLEEP=1 npm run wiki:dev
```

The Tauri command `simulate_sleep_resume` exercises the backend recovery state
path without waiting for a real sleep cycle. Full product validation still needs
a real macOS sleep/wake pass to confirm CPU settles and source watchers resume.

After a real macOS wake, collect process and watcher evidence with:

```sh
npm run wiki:post-wake-check -- --project /path/to/wiki-project
```

To collect both Hub and LLM Wiki evidence in one pass, run:

```sh
npm run sleep:acceptance -- --wiki-project /path/to/wiki-project
```

The unified command writes an aggregate report under `$NOOS_HOME/reports/` and
also preserves the separate Hub and Wiki check reports. Before it runs Hub and
Wiki post-wake probes, it verifies that macOS logged an ordered
Sleep -> Wake/DarkWake event pair after the paired preflight report.

Before creating a validation session, run a readiness check:

```sh
npm run sleep:readiness -- --wiki-project /path/to/wiki-project
```

The readiness check verifies the real Hub and LLM Wiki processes are running,
Hub `/health` responds, Hub/Wiki CPU are below the pre-sleep threshold, the Wiki
project exists, and the Wiki file snapshot exists. It does not write a
preflight report or create watcher probe files. It also rejects controlled
validation overrides unless `NOOS_SLEEP_READY_SELF_TEST=1` is set by the
self-test. If readiness fails because Hub or LLM Wiki is not running, it prints
the setup commands to install app-local dependencies, launch Hub, start Wiki,
open the project, and re-run readiness before attempting a real sleep
validation.

For a complete real sleep/wake validation, run a preflight before sleeping:

```sh
npm run sleep:preflight -- --wiki-project /path/to/wiki-project
```

The preflight writes a before-sleep report under `$NOOS_HOME/reports/`, records
a validation session id for pairing with the post-wake acceptance report,
confirms Hub and LLM Wiki are running with CPU below the pre-sleep threshold,
checks that Hub `/health` responds, checks that the Wiki project exists, writes
a pre-sleep source probe, verifies the Wiki file snapshot sees that probe after
the probe was written, and prints the exact post-wake acceptance command to run
after macOS wakes.

To audit whether the latest reports prove completion, run:

```sh
npm run sleep:status
```

To audit the full handoff objective in one command, including the LLM Wiki git
management gate and the real sleep/resume evidence gate, run:

```sh
npm run sleep:audit
```

The status command exits successfully only when the latest preflight passed, the
latest acceptance passed, and the acceptance report is newer than the preflight
report. On macOS it also requires an ordered system Sleep -> Wake/DarkWake event
pair between the two reports, so controlled or no-sleep test runs cannot satisfy
the completion gate. It also requires the validation session id to match between
the preflight and acceptance reports, so reports from separate validation rounds
cannot be accidentally combined. It also requires the reports to include
before-sleep Hub health, Hub PID, Hub CPU, Wiki PID, Wiki CPU, and Wiki watcher
baselines, a Wiki watcher project, both Hub and Wiki checks, the Hub write
probe, and the Wiki watcher probe; skipped checks or process-only Wiki checks
are rejected as incomplete evidence. The canonical Wiki project path must also
match between preflight and acceptance. The acceptance report must include the
actual post-wake Hub health success line, after-wake Hub and Wiki PID metadata,
Hub/Wiki CPU settled lines with explicit Hub and LLM Wiki labels, Hub handoff
and crystal write-probe file verification lines, and the fresh Wiki
file-snapshot success lines
(`ok      Wiki file snapshot includes fresh pre-sleep probe` and
`ok      File snapshot includes fresh post-wake probe`), not just metadata
saying the probes were requested.
The Hub write-probe helper verifies the returned files are inside the current
`$NOOS_HOME/vault` and indexed under `$NOOS_HOME/vault/index/keys.json` before
accepting them as post-wake Vault evidence.

`NOOS_SLEEP_STATUS_SELF_TEST=1 NOOS_SLEEP_STATUS_SKIP_WAKE_CHECK=1` exists only
for `npm run sleep:status:self-test`; do not use it for product validation.
The preflight report is marked as controlled when before-sleep validation
variables such as `NOOS_PRE_SLEEP_HUB_PID`, `NOOS_PRE_SLEEP_WIKI_PID`,
`NOOS_PRE_SLEEP_CPU_LIMIT`, `NOOS_WIKI_PRE_SLEEP_WATCHER_TIMEOUT`, or
`NOOS_HUB_HEALTH_URL` are set.
The unified acceptance report is also marked as controlled when post-wake
validation variables such as `NOOS_POST_WAKE_CPU_LIMIT`,
`NOOS_POST_WAKE_SAMPLES`, `NOOS_POST_WAKE_SAMPLE_DELAY`,
`NOOS_WIKI_POST_WAKE_CPU_LIMIT`, `NOOS_WIKI_POST_WAKE_SAMPLES`,
`NOOS_WIKI_POST_WAKE_SAMPLE_DELAY`, `NOOS_WIKI_POST_WAKE_WATCHER_TIMEOUT`,
`NOOS_SLEEP_ACCEPTANCE_SELF_TEST`, or `NOOS_SLEEP_ACCEPTANCE_PMSET_LOG_FILE`
are set; `npm run sleep:status` rejects those reports for product acceptance.
Run the self-test after changing the status gate:

```sh
npm run sleep:self-test
```

The suite above runs the individual checks below:

```sh
npm run wiki:vendor-check
npm run wiki:vendor-check:self-test
npm run hub:post-wake-check:self-test
npm run wiki:post-wake-check:self-test
npm run sleep:preflight:self-test
npm run sleep:status:self-test
npm run sleep:audit:self-test
npm run sleep:acceptance:self-test
npm run sleep:guided:self-test
```

For the least manual flow, run the guided wrapper:

```sh
npm run sleep:guided -- --wiki-project /path/to/wiki-project
```

It runs readiness, then preflight, waits while you manually sleep and wake
macOS, then runs acceptance, status, and the objective audit. It does not force
the machine to sleep. By default it watches `pmset` logs and automatically
continues after it sees a Sleep -> Wake/DarkWake pair after the preflight; use
`--wait-mode enter` if you prefer the older press-Enter flow.

If the validation should keep running outside the current shell or Codex
session, arm the guided flow as a user LaunchAgent:

```sh
npm run sleep:arm -- --wiki-project /path/to/wiki-project
npm run sleep:arm:status
npm run sleep:arm:logs
```

The arm command writes a runner under `$NOOS_HOME/run/` and logs to
`$NOOS_HOME/logs/noos-sleep-resume-guided.log`. It still does not force sleep;
it only keeps the readiness -> preflight -> wait -> acceptance -> status ->
audit sequence alive while macOS sleeps and wakes. Stop an armed run with
`npm run sleep:arm:stop`.

The command writes a timestamped report under `$NOOS_HOME/reports/`, samples
the LLM Wiki process CPU, writes a source probe to
`raw/sources/noos/post-wake-probes/`, and waits for
`.llm-wiki/file-snapshot.json` or `.llm-wiki/file-change-queue.json` to mention
the probe after the probe was written. Passing this check proves the process
settled and the source watcher or explicit post-wake rescan observed the new
source file, even if ingestion has only queued the file and has not completed
the snapshot update yet. The direct Wiki post-wake check also canonicalizes the
project path before writing the probe, so symlinked project paths resolve to the
same physical project directory used by the unified sleep/resume reports.

For controlled script testing only, `NOOS_WIKI_POST_WAKE_PID` can point the
check at a known local test process. Real post-wake validation should leave it
unset so the script discovers the LLM Wiki process from the process list.

## Verification

Current checked commands:

```sh
cargo fmt --manifest-path apps/llm-wiki/src-tauri/Cargo.toml
cargo check --manifest-path apps/llm-wiki/src-tauri/Cargo.toml
npm --prefix apps/llm-wiki run build
npm --prefix apps/llm-wiki run test:mocks
npm --prefix apps/llm-wiki audit --omit=dev
```

Rust check is clean. The copied dependency lockfile has also been refreshed so
`npm audit --omit=dev` reports zero vulnerabilities.
