# NOOS Hub Power Profile

NOOS Hub should behave like a quiet local control plane. It should not run a
continuous render loop, scan the Vault repeatedly, or keep development servers
alive during normal use.

## Expected Runtime

Daily use should launch the bundled desktop app:

```sh
npm run hub:launch
```

Avoid leaving this command running for daily use:

```sh
npm run hub:dev
```

`hub:dev` starts Tauri dev mode and a Vite dev server. That is useful while
editing the Hub UI, but it can show up as sustained energy usage in Activity
Monitor because file watchers and development tooling stay alive.

## Low Power Rules

- Hub health is cached briefly so repeated UI refreshes do not repeatedly run
  `git` checks or scan recent Vault files.
- Manual actions invalidate the health cache before the next refresh.
- The localhost write channel uses short read/write timeouts so half-open local
  connections cannot leave blocked request threads around indefinitely.
- The Hub UI does not use animation loops or automatic status polling.
- Browser Shuttle should call Hub health only when the panel is opened, when the
  user refreshes, or during an explicit Vault save.

## Sleep / Resume Recovery

NOOS Hub handles macOS sleep and wake as a recovery workflow, not as an
automatic exit.

Recovery can start from two signals:

- Frontend Tauri lifecycle events: `tauri://suspended` and `tauri://resumed`.
- A backend wall-clock gap guard, because the WebView can be frozen during a
  long sleep.

On resume, Hub enters a recovery state, invalidates cached health, probes
`http://127.0.0.1:17642/health`, and refreshes UI health after the local write
service responds. If probing fails, Hub attempts to start the local write
listener again and retries with bounded backoff. After repeated failures, Hub
marks relaunch as recommended so the external launcher watchdog can restart it.
Hub also samples its own process CPU after the local write service responds; if
CPU remains above `NOOS_HUB_SLEEP_CPU_LIMIT` (default `75`), it marks relaunch
as recommended instead of declaring recovery healthy.

The previous behavior of exiting immediately after every long sleep gap is no
longer the default. For unattended launcher-managed sessions, set
`NOOS_HUB_AUTO_RELAUNCH_AFTER_SLEEP=1` to let Hub spawn a replacement process
when bounded in-place recovery fails.

Useful test knobs:

```sh
NOOS_HUB_SLEEP_GAP_SECS=5 npm run hub:launch
```

```sh
NOOS_HUB_SLEEP_CPU_LIMIT=25 npm run hub:launch
```

The Tauri command `simulate_sleep_resume` exercises the same recovery path
without waiting for an overnight sleep cycle.

After a real macOS wake, collect product-level evidence with:

```sh
npm run hub:post-wake-check -- --write-probe
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

The check records a timestamped report under `$NOOS_HOME/reports/`, verifies
the Hub process is running, confirms `/health` responds, samples CPU settling,
and posts test handoff and crystal objects through Hub's authenticated
`/v1/ingest` endpoint. It then verifies that each returned Vault path exists and
is inside the current `$NOOS_HOME/vault`, and contains the expected NOOS marker.
It also verifies that `$NOOS_HOME/vault/index/keys.json` contains the returned
lookup key with the expected object type and path.
Passing this check after waking from sleep is the concrete evidence for Hub
health, low CPU, and Shuttle-style local Vault write availability. The write
probe intentionally has no direct filesystem fallback: if `/pair`,
`/v1/ingest`, Vault-path containment, Vault index verification, or on-disk
verification fails for either object type, the post-wake check fails.

For controlled script testing only, `NOOS_POST_WAKE_PID` can point the check at
a known local test process. Real post-wake validation should leave it unset so
the script discovers the Hub process from the launcher pid file or process list.

## Quick Diagnosis

Check whether a production Hub or dev process is running:

```sh
ps -axo pid,ppid,pcpu,pmem,etime,command | rg -i "noos-hub|NOOS Hub|tauri dev|vite"
```

Expected daily-use shape:

- One `noos-hub` app process.
- No long-running `tauri dev`.
- No long-running `vite` associated with NOOS Hub.

If `tauri dev` or `vite` is present and you are not actively developing Hub UI,
stop it and relaunch with:

```sh
npm run hub:stop
npm run hub:launch
```

## When High Energy Appears

Collect these facts before changing code:

1. Is the process `noos-hub`, `tauri dev`, `vite`, or another local app?
2. Is the Hub window open on a page with recent Vault files?
3. Is Browser Shuttle repeatedly refreshing the Vault panel?
4. Does CPU drop after closing the Hub window or stopping dev mode?
5. Does CPU drop after disconnecting Browser Shuttle from ChatGPT pages?

The most likely product fixes should preserve the local-first path:

- Reduce polling.
- Cache filesystem-heavy health checks.
- Bound local server request lifetime.
- Move expensive indexing into explicit actions.
- Keep model calls out of idle background behavior.
