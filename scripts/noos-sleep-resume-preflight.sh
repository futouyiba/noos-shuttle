#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NOOS_HOME="${NOOS_HOME:-$HOME/.noos}"
REPORT_DIR="$NOOS_HOME/reports"
SESSION_FILE="$REPORT_DIR/noos-sleep-resume-current-session.txt"
WIKI_PROJECT=""
ALLOW_MISSING=0
HEALTH_URL="${NOOS_HUB_HEALTH_URL:-http://127.0.0.1:17642/health}"
WATCHER_TIMEOUT="${NOOS_WIKI_PRE_SLEEP_WATCHER_TIMEOUT:-20}"
CPU_LIMIT="${NOOS_PRE_SLEEP_CPU_LIMIT:-25}"

usage() {
  cat <<'EOF'
Usage: scripts/noos-sleep-resume-preflight.sh [options]

Captures the before-sleep baseline for a real NOOS sleep/resume validation.

Options:
  --wiki-project <path>  LLM Wiki project directory expected for watcher validation.
  --allow-missing        Write the report even if Hub or Wiki is not running.

Environment:
  NOOS_PRE_SLEEP_HUB_PID   Optional Hub pid override for controlled testing.
  NOOS_PRE_SLEEP_WIKI_PID  Optional LLM Wiki pid override for controlled testing.
  NOOS_HUB_HEALTH_URL      Optional Hub health URL override for controlled testing.
  NOOS_PRE_SLEEP_CPU_LIMIT CPU percent threshold for Hub and Wiki before sleep.
  NOOS_WIKI_PRE_SLEEP_WATCHER_TIMEOUT
                            Seconds to wait for pre-sleep file-snapshot evidence.
EOF
}

ok() {
  printf "ok      %s\n" "$1"
}

warn() {
  printf "warn    %s\n" "$1"
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

find_wiki_pid() {
  pgrep -f "$ROOT_DIR/apps/llm-wiki/src-tauri/target/release/bundle/macos/LLM Wiki.app/Contents/MacOS/llm-wiki|$ROOT_DIR/apps/llm-wiki/src-tauri/target/debug/llm-wiki|$ROOT_DIR/apps/llm-wiki/node_modules/.bin/tauri dev|target/debug/llm-wiki" | head -n 1 || true
}

cpu_percent() {
  local pid="$1"
  ps -p "$pid" -o %cpu= 2>/dev/null | awk '{ printf "%.1f\n", $1 }'
}

mtime_epoch() {
  local path="$1"
  if stat -f '%m' "$path" >/dev/null 2>&1; then
    stat -f '%m' "$path"
  else
    stat -c '%Y' "$path"
  fi
}

health_check() {
  curl --max-time 3 -fsS "$HEALTH_URL"
}

cpu_within_limit() {
  local cpu="$1"
  awk -v value="$cpu" -v limit="$CPU_LIMIT" 'BEGIN { exit !(value <= limit) }'
}

canonical_dir() {
  local path="$1"
  if [[ -d "$path" ]]; then
    (cd "$path" && pwd -P)
  else
    printf "%s\n" "$path"
  fi
}

write_project_probe() {
  local project="$1"
  local stamp probe_dir probe_path
  stamp="$(date -u '+%Y%m%dT%H%M%SZ')"
  probe_dir="$project/raw/sources/noos/pre-sleep-probes"
  probe_path="$probe_dir/$stamp.md"
  mkdir -p "$probe_dir"
  {
    echo "# LLM Wiki Pre-Sleep Probe"
    echo
    echo "- created_at: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    echo "- source: scripts/noos-sleep-resume-preflight.sh"
    echo "- purpose: verify source watcher or explicit rescan is healthy before macOS sleep"
  } > "$probe_path"
  echo "$probe_path"
}

snapshot_mentions_probe() {
  local project="$1"
  local probe_path="$2"
  local snapshot="$project/.llm-wiki/file-snapshot.json"
  local probe_name probe_mtime snapshot_mtime
  probe_name="$(basename "$probe_path")"
  [[ -f "$snapshot" ]] || return 1
  rg -q --fixed-strings "$probe_name" "$snapshot" || return 1
  probe_mtime="$(mtime_epoch "$probe_path")"
  snapshot_mtime="$(mtime_epoch "$snapshot")"
  (( snapshot_mtime >= probe_mtime ))
}

queue_mentions_probe() {
  local project="$1"
  local probe_path="$2"
  local queue="$project/.llm-wiki/file-change-queue.json"
  local probe_name probe_mtime queue_mtime
  probe_name="$(basename "$probe_path")"
  [[ -f "$queue" ]] || return 1
  rg -q --fixed-strings "$probe_name" "$queue" || return 1
  probe_mtime="$(mtime_epoch "$probe_path")"
  queue_mtime="$(mtime_epoch "$queue")"
  (( queue_mtime >= probe_mtime ))
}

watcher_mentions_probe() {
  local project="$1"
  local probe_path="$2"
  snapshot_mentions_probe "$project" "$probe_path" || queue_mentions_probe "$project" "$probe_path"
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
    --allow-missing)
      ALLOW_MISSING=1
      shift
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

if [[ -n "$WIKI_PROJECT" ]]; then
  WIKI_PROJECT="$(canonical_dir "$WIKI_PROJECT")"
fi

mkdir -p "$REPORT_DIR"
timestamp="$(date -u '+%Y%m%dT%H%M%SZ')"
session_id="sleep-resume-$timestamp-$$"
report="$REPORT_DIR/noos-sleep-resume-preflight-$timestamp.txt"
{
  echo "Validation session: $session_id"
  echo "Preflight report: $report"
  if [[ -n "$WIKI_PROJECT" ]]; then
    echo "Wiki watcher project path: $WIKI_PROJECT"
  fi
} > "$SESSION_FILE"
exec > >(tee "$report") 2>&1

echo "NOOS Sleep / Resume Preflight"
echo "Report: $report"
echo "Validation session: $session_id"
echo "Time: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "Epoch: $(date '+%s')"
if [[ -n "${NOOS_PRE_SLEEP_HUB_PID:-}" || -n "${NOOS_PRE_SLEEP_WIKI_PID:-}" || -n "${NOOS_PRE_SLEEP_CPU_LIMIT:-}" || -n "${NOOS_WIKI_PRE_SLEEP_WATCHER_TIMEOUT:-}" || "$HEALTH_URL" != "http://127.0.0.1:17642/health" ]]; then
  echo "Controlled overrides: yes"
else
  echo "Controlled overrides: no"
fi
if [[ -n "$WIKI_PROJECT" ]]; then
  echo "Wiki watcher project: yes"
  echo "Wiki watcher project path: $WIKI_PROJECT"
else
  echo "Wiki watcher project: no"
fi
echo

exit_code=0

hub_pid="${NOOS_PRE_SLEEP_HUB_PID:-}"
if [[ -z "$hub_pid" ]]; then
  hub_pid="$(find_hub_pid)"
fi

if pid_is_running "$hub_pid"; then
  hub_cpu="$(cpu_percent "$hub_pid")"
  ok "NOOS Hub running before sleep: pid=$hub_pid cpu=${hub_cpu}%"
  echo "Hub PID before sleep: $hub_pid"
  if cpu_within_limit "$hub_cpu"; then
    ok "Hub CPU baseline settled before sleep: ${hub_cpu}% <= ${CPU_LIMIT}%"
  else
    fail "Hub CPU baseline too high before sleep: ${hub_cpu}% > ${CPU_LIMIT}%"
    exit_code=1
  fi
  health_body="$(health_check || true)"
  if [[ -n "$health_body" ]]; then
    ok "Hub health endpoint responds before sleep: $HEALTH_URL"
  else
    fail "Hub health endpoint failed before sleep: $HEALTH_URL"
    exit_code=1
  fi
else
  fail "NOOS Hub is not running before sleep"
  exit_code=1
fi

wiki_pid="${NOOS_PRE_SLEEP_WIKI_PID:-}"
if [[ -z "$wiki_pid" ]]; then
  wiki_pid="$(find_wiki_pid)"
fi

if pid_is_running "$wiki_pid"; then
  wiki_cpu="$(cpu_percent "$wiki_pid")"
  ok "LLM Wiki running before sleep: pid=$wiki_pid cpu=${wiki_cpu}%"
  echo "LLM Wiki PID before sleep: $wiki_pid"
  if cpu_within_limit "$wiki_cpu"; then
    ok "LLM Wiki CPU baseline settled before sleep: ${wiki_cpu}% <= ${CPU_LIMIT}%"
  else
    fail "LLM Wiki CPU baseline too high before sleep: ${wiki_cpu}% > ${CPU_LIMIT}%"
    exit_code=1
  fi
else
  fail "LLM Wiki is not running before sleep"
  exit_code=1
fi

if [[ -n "$WIKI_PROJECT" ]]; then
  if [[ -d "$WIKI_PROJECT" ]]; then
    ok "Wiki project exists: $WIKI_PROJECT"
    if [[ -f "$WIKI_PROJECT/.llm-wiki/file-snapshot.json" ]]; then
      ok "Wiki file snapshot exists: $WIKI_PROJECT/.llm-wiki/file-snapshot.json"
    else
      fail "Wiki file snapshot does not exist yet; open this project in LLM Wiki with source watch enabled, then rerun preflight."
      exit_code=1
    fi

    probe_path="$(write_project_probe "$WIKI_PROJECT")"
    ok "Pre-sleep source watcher probe created: $probe_path"

    found=0
    for ((i = 0; i <= WATCHER_TIMEOUT; i++)); do
      if watcher_mentions_probe "$WIKI_PROJECT" "$probe_path"; then
        found=1
        break
      fi
      sleep 1
    done

    if [[ "$found" == "1" ]]; then
      ok "Wiki watcher state includes fresh pre-sleep probe"
    else
      fail "Wiki watcher state did not include pre-sleep probe within ${WATCHER_TIMEOUT}s"
      fail "Open this project in LLM Wiki with source watch enabled, then rerun preflight."
      exit_code=1
    fi
  else
    fail "Wiki project does not exist: $WIKI_PROJECT"
    exit_code=1
  fi
else
  warn "No --wiki-project provided; post-wake Wiki watcher evidence will be process-only unless a project is supplied later."
fi

echo
echo "After waking from macOS sleep, run:"
if [[ -n "$WIKI_PROJECT" ]]; then
  printf "  npm run sleep:acceptance -- --wiki-project %q\n" "$WIKI_PROJECT"
else
  echo "  npm run sleep:acceptance"
fi

echo
if [[ "$exit_code" == "0" ]]; then
  ok "Preflight passed"
elif [[ "$ALLOW_MISSING" == "1" ]]; then
  warn "Preflight had missing prerequisites, but --allow-missing was set"
  exit_code=0
else
  fail "Preflight failed"
fi

exit "$exit_code"
