#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NOOS_HOME="${NOOS_HOME:-$HOME/.noos}"
WATCHDOG_PID_FILE="$NOOS_HOME/run/noos-hub-watchdog.pid"
WIKI_PROJECT=""
HEALTH_URL="${NOOS_HUB_HEALTH_URL:-http://127.0.0.1:17642/health}"
CPU_LIMIT="${NOOS_PRE_SLEEP_CPU_LIMIT:-25}"
SELF_TEST="${NOOS_SLEEP_READY_SELF_TEST:-0}"

usage() {
  cat <<'EOF'
Usage: scripts/noos-sleep-resume-readiness.sh --wiki-project <path>

Checks whether the current machine state is ready to start a real NOOS
sleep/resume validation. This command does not create a validation session,
write preflight reports, or create Wiki watcher probe files.

Environment:
  NOOS_SLEEP_READY_SELF_TEST=1  Allows controlled process and URL overrides for self-tests only.
EOF
}

ok() {
  printf "ok      %s\n" "$1"
}

fail() {
  printf "fail    %s\n" "$1"
}

pid_is_running() {
  local pid="${1:-}"
  [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1
}

find_hub_pid() {
  pgrep -f "$ROOT_DIR/apps/noos-hub/src-tauri/target/release/bundle/macos/NOOS Hub.app/Contents/MacOS/noos-hub|$ROOT_DIR/apps/noos-hub/src-tauri/target/debug/noos-hub|target/debug/noos-hub" | head -n 1 || true
}

read_watchdog_pid() {
  if [[ -f "$WATCHDOG_PID_FILE" ]]; then
    tr -d '[:space:]' < "$WATCHDOG_PID_FILE"
  fi
}

find_wiki_pid() {
  pgrep -f "$ROOT_DIR/apps/llm-wiki/src-tauri/target/release/bundle/macos/LLM Wiki.app/Contents/MacOS/llm-wiki|$ROOT_DIR/apps/llm-wiki/src-tauri/target/debug/llm-wiki|$ROOT_DIR/apps/llm-wiki/node_modules/.bin/tauri dev|target/debug/llm-wiki" | head -n 1 || true
}

cpu_percent() {
  local pid="$1"
  ps -p "$pid" -o %cpu= 2>/dev/null | awk '{ printf "%.1f\n", $1 }'
}

cpu_within_limit() {
  local cpu="$1"
  awk -v value="$cpu" -v limit="$CPU_LIMIT" 'BEGIN { exit !(value <= limit) }'
}

health_check() {
  curl --max-time 3 -fsS "$HEALTH_URL"
}

canonical_dir() {
  local path="$1"
  if [[ -d "$path" ]]; then
    (cd "$path" && pwd -P)
  else
    printf "%s\n" "$path"
  fi
}

controlled_overrides_present() {
  [[ -n "${NOOS_PRE_SLEEP_HUB_PID:-}" ]] && return 0
  [[ -n "${NOOS_PRE_SLEEP_WIKI_PID:-}" ]] && return 0
  [[ -n "${NOOS_PRE_SLEEP_CPU_LIMIT:-}" ]] && return 0
  [[ -n "${NOOS_WIKI_PRE_SLEEP_WATCHER_TIMEOUT:-}" ]] && return 0
  [[ "$HEALTH_URL" != "http://127.0.0.1:17642/health" ]] && return 0
  return 1
}

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

if [[ -z "$WIKI_PROJECT" ]]; then
  echo "Missing required --wiki-project <path>" >&2
  usage >&2
  exit 2
fi

WIKI_PROJECT="$(canonical_dir "$WIKI_PROJECT")"

echo "NOOS Sleep / Resume Readiness"
echo "Wiki project: $WIKI_PROJECT"
echo "Hub health URL: $HEALTH_URL"
echo

exit_code=0

if controlled_overrides_present; then
  if [[ "$SELF_TEST" == "1" ]]; then
    ok "Controlled overrides allowed for readiness self-test"
  else
    fail "Controlled overrides are set; unset NOOS_PRE_SLEEP_* / NOOS_WIKI_PRE_SLEEP_* / NOOS_HUB_HEALTH_URL before real readiness checks"
    exit_code=1
  fi
else
  ok "No controlled validation overrides are set"
fi

hub_pid="${NOOS_PRE_SLEEP_HUB_PID:-}"
if [[ -z "$hub_pid" ]]; then
  hub_pid="$(find_hub_pid)"
fi

if pid_is_running "$hub_pid"; then
  hub_cpu="$(cpu_percent "$hub_pid")"
  ok "NOOS Hub process is running: pid=$hub_pid cpu=${hub_cpu}%"
  if cpu_within_limit "$hub_cpu"; then
    ok "NOOS Hub CPU is within pre-sleep limit: ${hub_cpu}% <= ${CPU_LIMIT}%"
  else
    fail "NOOS Hub CPU is above pre-sleep limit: ${hub_cpu}% > ${CPU_LIMIT}%"
    exit_code=1
  fi
else
  fail "NOOS Hub process was not found"
  exit_code=1
fi

health_body="$(health_check || true)"
if [[ -n "$health_body" ]]; then
  ok "NOOS Hub health endpoint responds: $HEALTH_URL"
else
  fail "NOOS Hub health endpoint failed: $HEALTH_URL"
  exit_code=1
fi

watchdog_pid="$(read_watchdog_pid)"
if pid_is_running "$watchdog_pid"; then
  ok "NOOS Hub watchdog is running: pid=$watchdog_pid"
else
  fail "NOOS Hub watchdog is not running; run npm run hub:launch to start the launcher watchdog before sleep validation"
  exit_code=1
fi

wiki_pid="${NOOS_PRE_SLEEP_WIKI_PID:-}"
if [[ -z "$wiki_pid" ]]; then
  wiki_pid="$(find_wiki_pid)"
fi

if pid_is_running "$wiki_pid"; then
  wiki_cpu="$(cpu_percent "$wiki_pid")"
  ok "LLM Wiki process is running: pid=$wiki_pid cpu=${wiki_cpu}%"
  if cpu_within_limit "$wiki_cpu"; then
    ok "LLM Wiki CPU is within pre-sleep limit: ${wiki_cpu}% <= ${CPU_LIMIT}%"
  else
    fail "LLM Wiki CPU is above pre-sleep limit: ${wiki_cpu}% > ${CPU_LIMIT}%"
    exit_code=1
  fi
else
  fail "LLM Wiki process was not found"
  exit_code=1
fi

if [[ -d "$WIKI_PROJECT" ]]; then
  ok "Wiki project exists: $WIKI_PROJECT"
else
  fail "Wiki project does not exist: $WIKI_PROJECT"
  exit_code=1
fi

if [[ -f "$WIKI_PROJECT/.llm-wiki/file-snapshot.json" ]]; then
  ok "Wiki file snapshot exists: $WIKI_PROJECT/.llm-wiki/file-snapshot.json"
else
  fail "Wiki file snapshot is missing; open this project in LLM Wiki with source watch enabled before sleep validation"
  exit_code=1
fi

echo
if [[ "$exit_code" == "0" ]]; then
  ok "Sleep/resume readiness passed"
  echo "Next command:"
  printf "  npm run sleep:guided -- --wiki-project %q\n" "$WIKI_PROJECT"
else
  fail "Sleep/resume readiness failed"
  echo "Next setup commands:"
  echo "  npm --prefix apps/noos-hub install"
  echo "  npm --prefix apps/llm-wiki install"
  echo "  npm run hub:launch"
  echo "  npm run wiki:launch"
  printf "  # Open/select Wiki project: %q\n" "$WIKI_PROJECT"
  printf "  npm run sleep:readiness -- --wiki-project %q\n" "$WIKI_PROJECT"
fi

exit "$exit_code"
