#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NOOS_HOME="${NOOS_HOME:-$HOME/.noos}"
REPORT_DIR="$NOOS_HOME/reports"
CPU_LIMIT="${NOOS_WIKI_POST_WAKE_CPU_LIMIT:-25}"
SAMPLES="${NOOS_WIKI_POST_WAKE_SAMPLES:-5}"
SAMPLE_DELAY="${NOOS_WIKI_POST_WAKE_SAMPLE_DELAY:-2}"
PID_OVERRIDE="${NOOS_WIKI_POST_WAKE_PID:-}"
PROJECT_PATH=""
WATCHER_TIMEOUT="${NOOS_WIKI_POST_WAKE_WATCHER_TIMEOUT:-20}"

usage() {
  cat <<'EOF'
Usage: scripts/llm-wiki-post-wake-check.sh [--project <path>]

Checks the LLM Wiki process and CPU settling after a macOS wake. With
--project, it also writes a source-watch probe file and waits for the project's
.llm-wiki/file-snapshot.json to mention the probe.

Options:
  --project <path>  LLM Wiki project directory to probe.

Environment:
  NOOS_WIKI_POST_WAKE_CPU_LIMIT        CPU percent threshold for average sample.
  NOOS_WIKI_POST_WAKE_SAMPLES          Number of CPU samples to collect.
  NOOS_WIKI_POST_WAKE_SAMPLE_DELAY     Seconds between CPU samples.
  NOOS_WIKI_POST_WAKE_PID              Optional pid override for controlled testing.
  NOOS_WIKI_POST_WAKE_WATCHER_TIMEOUT  Seconds to wait for file-snapshot evidence.
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
  probe_dir="$project/raw/sources/noos/post-wake-probes"
  probe_path="$probe_dir/$stamp.md"
  mkdir -p "$probe_dir"
  {
    echo "# LLM Wiki Post-Wake Probe"
    echo
    echo "- created_at: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    echo "- source: scripts/llm-wiki-post-wake-check.sh"
    echo "- purpose: verify source watcher or explicit post-wake rescan sees new source files"
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
    --project)
      PROJECT_PATH="${2:-}"
      if [[ -z "$PROJECT_PATH" ]]; then
        echo "Missing value for --project" >&2
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

if [[ -n "$PROJECT_PATH" ]]; then
  PROJECT_PATH="$(canonical_dir "$PROJECT_PATH")"
fi

mkdir -p "$REPORT_DIR"
report="$REPORT_DIR/llm-wiki-post-wake-$(date -u '+%Y%m%dT%H%M%SZ').txt"
exec > >(tee "$report") 2>&1

echo "LLM Wiki Post-Wake Check"
echo "Report: $report"
echo "Time: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo

exit_code=0

pid="$PID_OVERRIDE"
if [[ -z "$pid" ]]; then
  pid="$(find_wiki_pid)"
fi

if pid_is_running "$pid"; then
  ok "LLM Wiki process running: pid=$pid"
  echo "LLM Wiki PID after wake: $pid"
else
  fail "LLM Wiki process not found"
  exit 1
fi

echo
echo "CPU samples:"
cpu_sum="0"
for ((i = 1; i <= SAMPLES; i++)); do
  cpu="$(cpu_percent "$pid")"
  if [[ -z "$cpu" ]]; then
    fail "Could not read CPU for pid=$pid"
    exit_code=1
    break
  fi
  printf "  sample %d/%d: %s%%\n" "$i" "$SAMPLES" "$cpu"
  cpu_sum="$(awk -v a="$cpu_sum" -v b="$cpu" 'BEGIN { printf "%.1f", a + b }')"
  if (( i < SAMPLES )); then
    sleep "$SAMPLE_DELAY"
  fi
done

cpu_avg="$(awk -v sum="$cpu_sum" -v count="$SAMPLES" 'BEGIN { printf "%.1f", sum / count }')"
if awk -v avg="$cpu_avg" -v limit="$CPU_LIMIT" 'BEGIN { exit !(avg <= limit) }'; then
  ok "Average CPU settled: ${cpu_avg}% <= ${CPU_LIMIT}%"
  ok "LLM Wiki CPU settled after wake: ${cpu_avg}% <= ${CPU_LIMIT}%"
else
  fail "Average CPU too high: ${cpu_avg}% > ${CPU_LIMIT}%"
  exit_code=1
fi

if [[ -n "$PROJECT_PATH" ]]; then
  echo
  if [[ ! -d "$PROJECT_PATH" ]]; then
    fail "Project path does not exist: $PROJECT_PATH"
    exit 1
  fi

  probe_path="$(write_project_probe "$PROJECT_PATH")"
  ok "Source watcher probe created: $probe_path"

  found=0
  for ((i = 0; i <= WATCHER_TIMEOUT; i++)); do
    if watcher_mentions_probe "$PROJECT_PATH" "$probe_path"; then
      found=1
      break
    fi
    sleep 1
  done

  if [[ "$found" == "1" ]]; then
    ok "File watcher state includes fresh post-wake probe"
  else
    fail "File watcher state did not include probe within ${WATCHER_TIMEOUT}s"
    fail "Open this project in LLM Wiki with source watch enabled, then rerun after wake."
    exit_code=1
  fi
else
  echo
  warn "Project watcher probe skipped. Re-run with --project <path> to verify source watcher recovery."
fi

echo
if [[ "$exit_code" == "0" ]]; then
  ok "LLM Wiki post-wake check passed"
else
  fail "LLM Wiki post-wake check failed"
fi

exit "$exit_code"
