#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NOOS_HOME="${NOOS_HOME:-$HOME/.noos}"
RUN_DIR="$NOOS_HOME/run"
LOG_DIR="$NOOS_HOME/logs"
PID_FILE="$RUN_DIR/llm-wiki.pid"
LOG_FILE="$LOG_DIR/llm-wiki-launch.log"
WIKI_DIR="$ROOT_DIR/apps/llm-wiki"
APP_PATH="$WIKI_DIR/src-tauri/target/release/bundle/macos/LLM Wiki.app"
APP_BINARY="$APP_PATH/Contents/MacOS/llm-wiki"

usage() {
  cat <<'EOF'
Usage: scripts/llm-wiki-launch.sh [start|status|stop|restart|logs]

Commands:
  start    Build and launch LLM Wiki in the background.
  status   Show whether LLM Wiki is running.
  stop     Stop LLM Wiki if it is running.
  restart  Stop, then start LLM Wiki.
  logs     Print launcher log output.
EOF
}

pid_is_running() {
  local pid="${1:-}"
  [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1
}

find_wiki_pid() {
  pgrep -f "$APP_PATH/Contents/MacOS/llm-wiki|$WIKI_DIR/src-tauri/target/debug/llm-wiki|$WIKI_DIR/node_modules/.bin/tauri dev|target/debug/llm-wiki" | head -n 1 || true
}

find_conflicting_wiki_pids() {
  (pgrep -f "LLM Wiki.app/Contents/MacOS/llm-wiki|/llm-wiki$" || true) \
    | while read -r candidate; do
      [[ -n "$candidate" ]] || continue
      local command
      command="$(ps -p "$candidate" -o command= 2>/dev/null || true)"
      [[ -n "$command" ]] || continue
      case "$command" in
        *"$APP_PATH/Contents/MacOS/llm-wiki"*|*"$WIKI_DIR/src-tauri/target/debug/llm-wiki"*)
          ;;
        *)
          echo "$candidate"
          ;;
      esac
    done
}

read_pid() {
  if [[ -f "$PID_FILE" ]]; then
    tr -d '[:space:]' < "$PID_FILE"
  fi
}

ensure_dirs() {
  mkdir -p "$RUN_DIR" "$LOG_DIR"
}

wiki_bundle_needs_rebuild() {
  if [[ ! -x "$APP_BINARY" ]]; then
    return 0
  fi

  local newer
  newer="$(find \
    "$WIKI_DIR/src" \
    "$WIKI_DIR/src-tauri/src" \
    "$WIKI_DIR/src-tauri/Cargo.toml" \
    "$WIKI_DIR/src-tauri/tauri.conf.json" \
    "$WIKI_DIR/package.json" \
    -newer "$APP_BINARY" \
    -print \
    -quit)"
  [[ -n "$newer" ]]
}

launch_app() {
  echo "Opening LLM Wiki..." >&2
  open -na "$APP_PATH"
  local pid
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    sleep 1
    pid="$(find_wiki_pid)"
    if pid_is_running "$pid"; then
      echo "$pid"
      return 0
    fi
  done
  echo ""
}

status() {
  local pid
  pid="$(read_pid)"
  if ! pid_is_running "$pid"; then
    pid="$(find_wiki_pid)"
  fi

  if pid_is_running "$pid"; then
    echo "$pid" > "$PID_FILE"
    echo "LLM Wiki is running: pid=$pid"
    echo "CPU: $(ps -p "$pid" -o %cpu= 2>/dev/null | awk '{ printf "%.0f\n", $1 }')%"
    echo "Log: $LOG_FILE"
  else
    echo "LLM Wiki is not running."
    rm -f "$PID_FILE"
  fi

  local conflicts
  conflicts="$(find_conflicting_wiki_pids | paste -sd ' ' -)"
  if [[ -n "$conflicts" ]]; then
    echo "Conflicting LLM Wiki process(es) outside this repo: $conflicts" >&2
  fi
}

start() {
  ensure_dirs

  local pid
  pid="$(read_pid)"
  if pid_is_running "$pid"; then
    echo "LLM Wiki is already running: pid=$pid"
    echo "Log: $LOG_FILE"
    return 0
  fi

  pid="$(find_wiki_pid)"
  if pid_is_running "$pid"; then
    echo "$pid" > "$PID_FILE"
    echo "LLM Wiki is already running: pid=$pid"
    echo "Log: $LOG_FILE"
    return 0
  fi

  local conflicts
  conflicts="$(find_conflicting_wiki_pids | paste -sd ' ' -)"
  if [[ -n "$conflicts" ]]; then
    echo "Refusing to launch while another LLM Wiki app is running: $conflicts" >&2
    echo "Run 'npm run wiki:stop' or close the other LLM Wiki app, then retry." >&2
    exit 1
  fi

  if wiki_bundle_needs_rebuild; then
    echo "Building LLM Wiki app bundle..."
    npm --prefix "$WIKI_DIR" run tauri build >> "$LOG_FILE" 2>&1
  fi

  pid="$(launch_app)"
  if pid_is_running "$pid"; then
    echo "$pid" > "$PID_FILE"
    echo "LLM Wiki started: pid=$pid"
    echo "Log: $LOG_FILE"
  else
    echo "LLM Wiki failed to stay running. Log: $LOG_FILE" >&2
    exit 1
  fi
}

stop() {
  local pid
  pid="$(read_pid)"
  if ! pid_is_running "$pid"; then
    pid="$(find_wiki_pid)"
  fi
  if ! pid_is_running "$pid"; then
    echo "LLM Wiki is not running."
    rm -f "$PID_FILE"
    return 0
  fi

  kill "$pid" >/dev/null 2>&1 || true
  pkill -P "$pid" >/dev/null 2>&1 || true
  pkill -f "$APP_PATH/Contents/MacOS/llm-wiki" >/dev/null 2>&1 || true
  pkill -f "/Applications/LLM Wiki.app/Contents/MacOS/llm-wiki" >/dev/null 2>&1 || true
  pkill -f "$WIKI_DIR/src-tauri/target/debug/llm-wiki" >/dev/null 2>&1 || true
  pkill -f "$WIKI_DIR/node_modules/.bin/tauri dev" >/dev/null 2>&1 || true
  for _ in 1 2 3 4 5; do
    if ! pid_is_running "$pid"; then
      rm -f "$PID_FILE"
      echo "LLM Wiki stopped."
      return 0
    fi
    sleep 1
  done

  echo "LLM Wiki did not stop after SIGTERM: pid=$pid" >&2
  exit 1
}

show_logs() {
  if [[ -f "$LOG_FILE" ]]; then
    tail -n 80 "$LOG_FILE"
  else
    echo "No LLM Wiki launcher log yet: $LOG_FILE"
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
