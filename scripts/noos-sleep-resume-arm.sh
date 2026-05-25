#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NOOS_HOME="${NOOS_HOME:-$HOME/.noos}"
RUN_DIR="$NOOS_HOME/run"
LOG_DIR="$NOOS_HOME/logs"
LABEL="${NOOS_SLEEP_ARM_LABEL:-com.noos.sleep-resume.guided}"
MODE="${NOOS_SLEEP_ARM_MODE:-terminal}"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
RUNNER="$RUN_DIR/noos-sleep-resume-guided-runner.sh"
LAUNCHER="$RUN_DIR/noos-sleep-resume-guided-launcher.applescript"
LOG_FILE="$LOG_DIR/noos-sleep-resume-guided.log"
WIKI_PROJECT=""

usage() {
  cat <<'EOF'
Usage: scripts/noos-sleep-resume-arm.sh [start|status|stop|logs] --wiki-project <path>

Commands:
  start    Run guided sleep/resume validation in a macOS LaunchAgent.
  status   Show LaunchAgent state and the latest runner log path.
  stop     Stop and unload the validation LaunchAgent.
  logs     Print the latest validation runner log.

The start command does not force macOS to sleep. It runs readiness and
preflight, then waits in the background until pmset logs show a real
Sleep -> Wake/DarkWake pair. After wake, it runs acceptance, status, and audit.

Environment:
  NOOS_SLEEP_ARM_SELF_TEST=1       Write generated files but do not call launchctl.
  NOOS_SLEEP_ARM_LABEL=<label>     Override the LaunchAgent label.
  NOOS_SLEEP_ARM_MODE=terminal     Run via Terminal, or direct for non-TCC paths.
EOF
}

xml_escape() {
  python3 -c '
import html
import sys
print(html.escape(sys.stdin.read(), quote=True), end="")
'
}

write_runner() {
  local wiki_project="$1"
  mkdir -p "$RUN_DIR" "$LOG_DIR"
  cat > "$RUNNER" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:\${PATH:-}"
exec > >(tee -a $(printf '%q' "$LOG_FILE")) 2>&1
LOCK_DIR=$(printf '%q' "$RUN_DIR/noos-sleep-resume-guided.lock")
if ! mkdir "\$LOCK_DIR" >/dev/null 2>&1; then
  echo "NOOS sleep/resume guided validation is already running; exiting duplicate runner."
  exit 0
fi
trap 'rm -rf "\$LOCK_DIR"' EXIT
echo "NOOS sleep/resume guided validation started: \$(date)"
cd $(printf '%q' "$ROOT_DIR")
$(printf '%q' "$ROOT_DIR/scripts/noos-sleep-resume-guided-test.sh") --wiki-project $(printf '%q' "$wiki_project")
echo "NOOS sleep/resume guided validation finished: \$(date)"
EOF
  chmod +x "$RUNNER"
}

write_terminal_launcher() {
  local escaped_runner
  escaped_runner="$(printf '%s' "$RUNNER" | sed 's/\\/\\\\/g; s/"/\\"/g')"
  cat > "$LAUNCHER" <<EOF
tell application "Terminal"
  activate
  do script "/bin/bash \"$escaped_runner\""
end tell
EOF
}

write_plist() {
  mkdir -p "$(dirname "$PLIST")"
  local program_arg escaped_log
  if [[ "$MODE" == "terminal" ]]; then
    program_arg="$LAUNCHER"
  else
    program_arg="$RUNNER"
  fi
  escaped_program_arg="$(printf '%s' "$program_arg" | xml_escape)"
  escaped_log="$(printf '%s' "$LOG_FILE" | xml_escape)"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
EOF
  if [[ "$MODE" == "terminal" ]]; then
    cat >> "$PLIST" <<EOF
    <string>/usr/bin/osascript</string>
    <string>$escaped_program_arg</string>
EOF
  else
    cat >> "$PLIST" <<EOF
    <string>/bin/bash</string>
    <string>$escaped_program_arg</string>
EOF
  fi
  cat >> "$PLIST" <<EOF
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$escaped_log</string>
  <key>StandardErrorPath</key>
  <string>$escaped_log</string>
</dict>
</plist>
EOF
}

launchctl_domain() {
  printf 'gui/%s\n' "$(id -u)"
}

stop_agent() {
  if [[ "${NOOS_SLEEP_ARM_SELF_TEST:-0}" == "1" ]]; then
    rm -f "$PLIST" "$RUNNER" "$LAUNCHER"
    echo "Sleep/resume validation LaunchAgent stopped."
    return 0
  fi

  launchctl bootout "$(launchctl_domain)" "$PLIST" >/dev/null 2>&1 || true
  launchctl remove "$LABEL" >/dev/null 2>&1 || true
  pkill -f "$RUNNER" >/dev/null 2>&1 || true
  pkill -f "noos-sleep-resume-guided-test.sh" >/dev/null 2>&1 || true
  rm -rf "$RUN_DIR/noos-sleep-resume-guided.lock"
  rm -f "$PLIST" "$RUNNER" "$LAUNCHER"
  echo "Sleep/resume validation LaunchAgent stopped."
}

start_agent() {
  local wiki_project="$1"
  if [[ -z "$wiki_project" ]]; then
    echo "Missing required --wiki-project <path>" >&2
    exit 2
  fi
  if [[ ! -d "$wiki_project" ]]; then
    echo "Wiki project does not exist: $wiki_project" >&2
    exit 2
  fi
  if [[ "$(uname -s)" != "Darwin" && "${NOOS_SLEEP_ARM_SELF_TEST:-0}" != "1" ]]; then
    echo "sleep:arm requires macOS LaunchAgent support." >&2
    exit 2
  fi
  case "$MODE" in
    terminal|direct)
      ;;
    *)
      echo "Unknown NOOS_SLEEP_ARM_MODE: $MODE" >&2
      exit 2
      ;;
  esac

  wiki_project="$(cd "$wiki_project" && pwd -P)"
  stop_agent >/dev/null
  write_runner "$wiki_project"
  if [[ "$MODE" == "terminal" ]]; then
    write_terminal_launcher
  fi
  write_plist

  : > "$LOG_FILE"
  if [[ "${NOOS_SLEEP_ARM_SELF_TEST:-0}" != "1" ]]; then
    launchctl bootstrap "$(launchctl_domain)" "$PLIST"
  fi

  echo "Sleep/resume validation armed."
  echo "LaunchAgent: $LABEL"
  echo "Mode: $MODE"
  echo "Wiki project: $wiki_project"
  echo "Log: $LOG_FILE"
  echo
  echo "Now put macOS to sleep and wake it again. The background runner will continue after wake."
}

status_agent() {
  echo "LaunchAgent: $LABEL"
  echo "Plist: $PLIST"
  echo "Runner: $RUNNER"
  echo "Launcher: $LAUNCHER"
  echo "Log: $LOG_FILE"
  echo "Mode: $MODE"
  if [[ -f "$PLIST" ]]; then
    echo "Plist exists: yes"
  else
    echo "Plist exists: no"
  fi
  pids="$(pgrep -f "$RUNNER|noos-sleep-resume-guided-test.sh" | paste -sd ' ' - || true)"
  if [[ -n "$pids" ]]; then
    echo "Runner process(es): $pids"
  else
    echo "Runner process(es): none"
  fi
  if [[ "${NOOS_SLEEP_ARM_SELF_TEST:-0}" != "1" ]] && [[ -f "$PLIST" ]]; then
    launchctl print "$(launchctl_domain)/$LABEL" 2>/dev/null || true
  fi
}

show_logs() {
  if [[ -f "$LOG_FILE" ]]; then
    tail -n 120 "$LOG_FILE"
  else
    echo "No validation log yet: $LOG_FILE"
  fi
}

command="${1:-start}"
case "$command" in
  start|status|stop|logs)
    shift || true
    ;;
  -h|--help|help)
    usage
    exit 0
    ;;
  *)
    echo "Unknown command: $command" >&2
    usage >&2
    exit 2
    ;;
esac

while [[ $# -gt 0 ]]; do
  case "$1" in
    --wiki-project)
      WIKI_PROJECT="${2:-}"
      if [[ -z "$WIKI_PROJECT" ]]; then
        echo "Missing value for --wiki-project" >&2
        exit 2
      fi
      shift 2
      ;;
    -h|--help|help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

case "$command" in
  start)
    start_agent "$WIKI_PROJECT"
    ;;
  status)
    status_agent
    ;;
  stop)
    stop_agent
    ;;
  logs)
    show_logs
    ;;
esac
