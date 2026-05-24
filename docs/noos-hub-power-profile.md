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
