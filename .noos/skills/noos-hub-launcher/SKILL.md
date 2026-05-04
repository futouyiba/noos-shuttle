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

- `hub:launch` builds the Hub `.app` bundle when missing, then opens it through macOS `open`.
- The launcher writes its pid to `~/.noos/run/noos-hub.pid`.
- Runtime logs go to `~/.noos/logs/noos-hub.log`.
- If the user asks for a Codex App button, explain that Codex currently exposes skills/plugins but not a public persistent topbar-button registration API; this skill is the reusable command surface for the eventual button.
