#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NOOS_HOME="${NOOS_HOME:-$HOME/.noos}"
RUN_DIR="$NOOS_HOME/run"
LOG_DIR="$NOOS_HOME/logs"
PID_FILE="$RUN_DIR/noos-hub.pid"
WATCHDOG_PID_FILE="$RUN_DIR/noos-hub-watchdog.pid"
LOG_FILE="$LOG_DIR/noos-hub.log"
HUB_DIR="$ROOT_DIR/apps/noos-hub"
APP_PATH="$ROOT_DIR/apps/noos-hub/src-tauri/target/release/bundle/macos/NOOS Hub.app"
APP_BINARY="$APP_PATH/Contents/MacOS/noos-hub"
HEALTH_URL="http://127.0.0.1:17642/health"
WATCHDOG_INTERVAL_SECONDS="${NOOS_HUB_WATCHDOG_INTERVAL_SECONDS:-60}"
WATCHDOG_HIGH_CPU_PERCENT="${NOOS_HUB_WATCHDOG_HIGH_CPU_PERCENT:-80}"
WATCHDOG_FAILURE_LIMIT="${NOOS_HUB_WATCHDOG_FAILURE_LIMIT:-2}"

usage() {
  cat <<'EOF'
Usage: scripts/noos-hub-launch.sh [start|status|stop|restart|logs|watchdog]

Commands:
  start     Build and launch NOOS Hub in the background.
  status    Show whether the background NOOS Hub process is running.
  stop      Stop the background NOOS Hub process started by this launcher.
  restart   Stop, then start NOOS Hub.
  logs      Print the NOOS Hub launcher log.
  watchdog  Internal command used by start. Monitors health and restarts Hub.
EOF
}

pid_is_running() {
  local pid="${1:-}"
  [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1
}

find_hub_pid() {
  pgrep -f "$APP_PATH/Contents/MacOS/noos-hub|$ROOT_DIR/apps/noos-hub/src-tauri/target/debug/noos-hub|$ROOT_DIR/apps/noos-hub/node_modules/.bin/tauri dev|target/debug/noos-hub" | head -n 1 || true
}

read_pid() {
  if [[ -f "$PID_FILE" ]]; then
    tr -d '[:space:]' < "$PID_FILE"
  fi
}

read_watchdog_pid() {
  if [[ -f "$WATCHDOG_PID_FILE" ]]; then
    tr -d '[:space:]' < "$WATCHDOG_PID_FILE"
  fi
}

ensure_dirs() {
  mkdir -p "$RUN_DIR" "$LOG_DIR"
}

hub_bundle_needs_rebuild() {
  if [[ ! -x "$APP_BINARY" ]]; then
    return 0
  fi

  local newer
  newer="$(find \
    "$HUB_DIR/src" \
    "$HUB_DIR/src-tauri/src" \
    "$HUB_DIR/src-tauri/Cargo.toml" \
    "$HUB_DIR/src-tauri/tauri.conf.json" \
    "$HUB_DIR/package.json" \
    -newer "$APP_BINARY" \
    -print \
    -quit)"
  [[ -n "$newer" ]]
}

launch_app() {
  echo "Opening NOOS Hub..." >&2
  open -na "$APP_PATH"
  local pid
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    sleep 1
    pid="$(find_hub_pid)"
    if pid_is_running "$pid"; then
      echo "$pid"
      return 0
    fi
  done
  echo ""
}

hub_health_ok() {
  curl --max-time 3 -fsS "$HEALTH_URL" >/dev/null 2>&1
}

hub_cpu_percent() {
  local pid="${1:-}"
  if ! pid_is_running "$pid"; then
    echo "0"
    return 0
  fi
  ps -p "$pid" -o %cpu= 2>/dev/null | awk '{ printf "%.0f\n", $1 }' || echo "0"
}

start_watchdog() {
  local watchdog_pid
  watchdog_pid="$(read_watchdog_pid)"
  if pid_is_running "$watchdog_pid"; then
    return 0
  fi

  nohup "$0" watchdog >> "$LOG_FILE" 2>&1 &
  echo "$!" > "$WATCHDOG_PID_FILE"
}

stop_watchdog() {
  local watchdog_pid
  watchdog_pid="$(read_watchdog_pid)"
  if pid_is_running "$watchdog_pid"; then
    kill "$watchdog_pid" >/dev/null 2>&1 || true
  fi
  rm -f "$WATCHDOG_PID_FILE"
}

status() {
  local pid
  pid="$(read_pid)"
  if ! pid_is_running "$pid"; then
    pid="$(find_hub_pid)"
  fi

  if pid_is_running "$pid"; then
    echo "$pid" > "$PID_FILE"
    echo "NOOS Hub is running: pid=$pid"
    echo "Health: $(hub_health_ok && echo ok || echo failed)"
    echo "CPU: $(hub_cpu_percent "$pid")%"
    local watchdog_pid
    watchdog_pid="$(read_watchdog_pid)"
    if pid_is_running "$watchdog_pid"; then
      echo "Watchdog is running: pid=$watchdog_pid"
    else
      echo "Watchdog is not running."
    fi
    echo "Log: $LOG_FILE"
  else
    echo "NOOS Hub is not running."
    rm -f "$PID_FILE"
  fi
}

start() {
  ensure_dirs

  local pid
  pid="$(read_pid)"
  if pid_is_running "$pid"; then
    start_watchdog
    echo "NOOS Hub is already running: pid=$pid"
    echo "Log: $LOG_FILE"
    return 0
  fi

  if hub_bundle_needs_rebuild; then
    echo "Building NOOS Hub app bundle..."
    npm run hub:bundle
  fi

  pid="$(launch_app)"
  if pid_is_running "$pid"; then
    echo "$pid" > "$PID_FILE"
    start_watchdog
    echo "NOOS Hub started: pid=$pid"
    echo "Log: $LOG_FILE"
  else
    echo "NOOS Hub failed to stay running. Log: $LOG_FILE" >&2
    exit 1
  fi
}

stop() {
  stop_watchdog

  local pid
  pid="$(read_pid)"
  if ! pid_is_running "$pid"; then
    pid="$(find_hub_pid)"
  fi
  if ! pid_is_running "$pid"; then
    echo "NOOS Hub is not running."
    rm -f "$PID_FILE"
    return 0
  fi

  kill "$pid"
  pkill -P "$pid" >/dev/null 2>&1 || true
  pkill -f "$APP_PATH/Contents/MacOS/noos-hub" >/dev/null 2>&1 || true
  pkill -f "$ROOT_DIR/apps/noos-hub/src-tauri/target/debug/noos-hub" >/dev/null 2>&1 || true
  pkill -f "$ROOT_DIR/apps/noos-hub/node_modules/.bin/vite --host 127.0.0.1 --port 1430" >/dev/null 2>&1 || true
  for _ in 1 2 3 4 5; do
    if ! pid_is_running "$pid"; then
      rm -f "$PID_FILE"
      echo "NOOS Hub stopped."
      return 0
    fi
    sleep 1
  done

  echo "NOOS Hub did not stop after SIGTERM: pid=$pid" >&2
  exit 1
}

watchdog() {
  set +e
  ensure_dirs
  echo "NOOS Hub watchdog started at $(date -u '+%Y-%m-%dT%H:%M:%SZ')"

  local failure_count=0
  while true; do
    local pid
    pid="$(read_pid)"
    if ! pid_is_running "$pid"; then
      pid="$(find_hub_pid)"
    fi

    if ! pid_is_running "$pid"; then
      echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Hub missing; relaunching."
      pid="$(launch_app)"
      if pid_is_running "$pid"; then
        echo "$pid" > "$PID_FILE"
      fi
      failure_count=0
      sleep "$WATCHDOG_INTERVAL_SECONDS"
      continue
    fi

    local cpu
    cpu="$(hub_cpu_percent "$pid")"
    if hub_health_ok && (( cpu < WATCHDOG_HIGH_CPU_PERCENT )); then
      failure_count=0
    else
      failure_count=$((failure_count + 1))
      echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Hub unhealthy: pid=$pid cpu=${cpu}% failures=$failure_count"
    fi

    if (( failure_count >= WATCHDOG_FAILURE_LIMIT )); then
      echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Restarting unhealthy NOOS Hub: pid=$pid"
      kill "$pid" >/dev/null 2>&1 || true
      pkill -P "$pid" >/dev/null 2>&1 || true
      sleep 2
      pid="$(launch_app)"
      if pid_is_running "$pid"; then
        echo "$pid" > "$PID_FILE"
        echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] NOOS Hub relaunched: pid=$pid"
      else
        rm -f "$PID_FILE"
        echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] NOOS Hub relaunch failed."
      fi
      failure_count=0
    fi

    sleep "$WATCHDOG_INTERVAL_SECONDS"
  done
}

show_logs() {
  if [[ -f "$LOG_FILE" ]]; then
    tail -n 80 "$LOG_FILE"
  else
    echo "No NOOS Hub log yet: $LOG_FILE"
  fi
}

command="${1:-start}"
case "$command" in
  start)
    start
    ;;
  status)
    status
    ;;
  stop)
    stop
    ;;
  restart)
    stop
    start
    ;;
  logs)
    show_logs
    ;;
  watchdog)
    watchdog
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    echo "Unknown command: $command" >&2
    usage >&2
    exit 1
    ;;
esac
