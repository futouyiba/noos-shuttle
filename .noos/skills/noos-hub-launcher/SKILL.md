---
name: noos-hub-launcher
description: Launch, inspect, stop, or restart the local NOOS Hub desktop app from Codex. Use when the user asks to open NOOS Hub, run NOOS Hub, view current hub status, check the Hub launcher log, or stop the Hub.
---

# NOOS Hub Launcher

Use the repository launcher script instead of hand-writing process management commands.

From the NOOS Shuttle repository root:

```sh
scripts/noos-hub-launch.sh start
scripts/noos-hub-launch.sh status
scripts/noos-hub-launch.sh logs
scripts/noos-hub-launch.sh stop
scripts/noos-hub-launch.sh restart
```

Preferred npm aliases:

```sh
npm run hub:launch
npm run hub:status
npm run hub:logs
npm run hub:stop
```

Notes:

- `hub:launch` is a full deploy: it stops the Hub owning local port 17642 (any install location), rebuilds the `.app` bundle when this checkout is ahead, installs it to `/Applications/NOOS Hub.app`, opens it, verifies the served build commit matches this checkout, then re-arms the watchdog.
- `hub:stop` stops by port ownership (port release is the completion signal), so it can stop instances it never launched (Spotlight/Dock opens).
- The launcher writes its pid to `$NOOS_HOME/run/noos-hub.pid` (default `~/.noos/run/`).
- Runtime logs go to `$NOOS_HOME/logs/noos-hub.log`.
- Isolated dev/test instances must set `NOOS_HOME`, `NOOS_HUB_PORT`, and `NOOS_HUB_INSTALL_APP` together (see repo AGENTS.md) — never share port 17642 or `/Applications` with the dogfood channel.
- If the user asks for a Codex App button, explain that Codex currently exposes skills/plugins but not a public persistent topbar-button registration API; this skill is the reusable command surface for the eventual button.
