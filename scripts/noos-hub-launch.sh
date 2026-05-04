#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NOOS_HOME="${NOOS_HOME:-$HOME/.noos}"
RUN_DIR="$NOOS_HOME/run"
LOG_DIR="$NOOS_HOME/logs"
PID_FILE="$RUN_DIR/noos-hub.pid"
LOG_FILE="$LOG_DIR/noos-hub.log"
HUB_DIR="$ROOT_DIR/apps/noos-hub"
APP_PATH="$ROOT_DIR/apps/noos-hub/src-tauri/target/release/bundle/macos/NOOS Hub.app"

usage() {
  cat <<'EOF'
Usage: scripts/noos-hub-launch.sh [start|status|stop|restart|logs]

Commands:
  start     Build and launch NOOS Hub in the background.
  status    Show whether the background NOOS Hub process is running.
  stop      Stop the background NOOS Hub process started by this launcher.
  restart   Stop, then start NOOS Hub.
  logs      Print the NOOS Hub launcher log.
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

ensure_dirs() {
  mkdir -p "$RUN_DIR" "$LOG_DIR"
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
    echo "NOOS Hub is already running: pid=$pid"
    echo "Log: $LOG_FILE"
    return 0
  fi

  if [[ ! -d "$APP_PATH" ]]; then
    echo "Building NOOS Hub app bundle..."
    npm run hub:bundle
  fi

  echo "Opening NOOS Hub..."
  open -na "$APP_PATH"
  sleep 2
  pid="$(find_hub_pid)"
  if pid_is_running "$pid"; then
    echo "$pid" > "$PID_FILE"
    echo "NOOS Hub started: pid=$pid"
    echo "Log: $LOG_FILE"
  else
    echo "NOOS Hub failed to stay running. Log: $LOG_FILE" >&2
    exit 1
  fi
}

stop() {
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
  -h|--help|help)
    usage
    ;;
  *)
    echo "Unknown command: $command" >&2
    usage >&2
    exit 1
    ;;
esac
