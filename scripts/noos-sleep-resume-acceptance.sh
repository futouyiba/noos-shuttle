#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NOOS_HOME="${NOOS_HOME:-$HOME/.noos}"
REPORT_DIR="$NOOS_HOME/reports"
SESSION_FILE="$REPORT_DIR/noos-sleep-resume-current-session.txt"
WIKI_PROJECT=""
SKIP_HUB=0
SKIP_WIKI=0
HUB_WRITE_PROBE=1

usage() {
  cat <<'EOF'
Usage: scripts/noos-sleep-resume-acceptance.sh [options]

Runs the post-wake acceptance checks for NOOS Hub and LLM Wiki.

Options:
  --wiki-project <path>  LLM Wiki project directory for watcher evidence.
  --skip-hub             Skip the Hub post-wake check.
  --skip-wiki            Skip the LLM Wiki post-wake check.
  --no-hub-write-probe   Do not POST the Hub /v1/ingest write probe.

Environment:
  Pass through NOOS_POST_WAKE_* and NOOS_WIKI_POST_WAKE_* variables to tune the
  underlying checks.
EOF
}

section() {
  printf "\n== %s ==\n" "$1"
}

canonical_dir() {
  local path="$1"
  if [[ -d "$path" ]]; then
    (cd "$path" && pwd -P)
  else
    printf "%s\n" "$path"
  fi
}

current_validation_session() {
  if [[ -f "$SESSION_FILE" ]]; then
    awk -F': ' '/^Validation session: / { print $2; exit }' "$SESSION_FILE"
  fi
}

current_session_preflight_report() {
  if [[ -f "$SESSION_FILE" ]]; then
    awk -F': ' '/^Preflight report: / { print $2; exit }' "$SESSION_FILE"
  fi
}

current_session_wiki_project() {
  if [[ -f "$SESSION_FILE" ]]; then
    awk -F': ' '/^Wiki watcher project path: / { print $2; exit }' "$SESSION_FILE"
  fi
}

report_validation_session() {
  local path="$1"
  awk -F': ' '/^Validation session: / { print $2; exit }' "$path"
}

report_wiki_project() {
  local path="$1"
  awk -F': ' '/^Wiki watcher project path: / { print $2; exit }' "$path"
}

report_epoch() {
  local path="$1"
  awk '/^Epoch: [0-9]+$/ { print $2; exit }' "$path"
}

sleep_wake_log() {
  if [[ -n "${NOOS_SLEEP_ACCEPTANCE_PMSET_LOG_FILE:-}" && "${NOOS_SLEEP_ACCEPTANCE_SELF_TEST:-0}" == "1" ]]; then
    cat "$NOOS_SLEEP_ACCEPTANCE_PMSET_LOG_FILE"
  else
    pmset -g log
  fi
}

sleep_wake_between_reports() {
  local start_epoch="$1"
  local end_epoch="$2"
  sleep_wake_log | python3 -c '
import datetime as dt
import re
import sys
import time

start = int(sys.argv[1])
end = int(sys.argv[2])
sleep_line = None
sleep_epoch = None
matched_sleep_line = None
matched_wake_line = None

event_pattern = re.compile(r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?: [+-]\d{4})?\s+(Sleep|Wake|DarkWake)\s{2,}")
date_pattern = re.compile(r"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})")

for line in sys.stdin:
    if "Sleep/Wakes since boot" in line:
        continue
    event_match = event_pattern.match(line)
    if not event_match:
        continue
    match = date_pattern.match(line)
    if not match:
        continue
    try:
        event_dt = dt.datetime.strptime(match.group(1), "%Y-%m-%d %H:%M:%S")
    except ValueError:
        continue
    event_epoch = int(time.mktime(event_dt.timetuple()))
    if not (start < event_epoch <= end):
        continue

    event_name = event_match.group(1)
    if event_name == "Sleep":
        sleep_line = line.rstrip()
        sleep_epoch = event_epoch
    elif sleep_epoch is not None and event_epoch > sleep_epoch:
        matched_sleep_line = sleep_line
        matched_wake_line = line.rstrip()

if matched_sleep_line and matched_wake_line:
    print(f"sleep\t{matched_sleep_line}")
    print(f"wake\t{matched_wake_line}")
    sys.exit(0)
sys.exit(1)
' "$start_epoch" "$end_epoch"
}

has_controlled_overrides() {
  [[ -n "${NOOS_POST_WAKE_PID:-}" ]] && return 0
  [[ -n "${NOOS_WIKI_POST_WAKE_PID:-}" ]] && return 0
  [[ -n "${NOOS_POST_WAKE_CPU_LIMIT:-}" ]] && return 0
  [[ -n "${NOOS_POST_WAKE_SAMPLES:-}" ]] && return 0
  [[ -n "${NOOS_POST_WAKE_SAMPLE_DELAY:-}" ]] && return 0
  [[ -n "${NOOS_WIKI_POST_WAKE_CPU_LIMIT:-}" ]] && return 0
  [[ -n "${NOOS_WIKI_POST_WAKE_SAMPLES:-}" ]] && return 0
  [[ -n "${NOOS_WIKI_POST_WAKE_SAMPLE_DELAY:-}" ]] && return 0
  [[ -n "${NOOS_WIKI_POST_WAKE_WATCHER_TIMEOUT:-}" ]] && return 0
  [[ -n "${NOOS_SLEEP_ACCEPTANCE_SELF_TEST:-}" ]] && return 0
  [[ -n "${NOOS_SLEEP_ACCEPTANCE_PMSET_LOG_FILE:-}" ]] && return 0
  [[ "${NOOS_HUB_HEALTH_URL:-http://127.0.0.1:17642/health}" != "http://127.0.0.1:17642/health" ]] && return 0
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
    --skip-hub)
      SKIP_HUB=1
      shift
      ;;
    --skip-wiki)
      SKIP_WIKI=1
      shift
      ;;
    --no-hub-write-probe)
      HUB_WRITE_PROBE=0
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

if [[ "$SKIP_HUB" == "1" && "$SKIP_WIKI" == "1" ]]; then
  echo "Both checks are skipped; nothing to do." >&2
  exit 2
fi

exit_code=0

mkdir -p "$REPORT_DIR"
report="$REPORT_DIR/noos-sleep-resume-acceptance-$(date -u '+%Y%m%dT%H%M%SZ').txt"
acceptance_epoch="$(date '+%s')"
validation_session="$(current_validation_session)"
session_preflight_report="$(current_session_preflight_report)"
session_wiki_project="$(current_session_wiki_project)"
if [[ -n "$session_wiki_project" ]]; then
  session_wiki_project="$(canonical_dir "$session_wiki_project")"
fi
exec > >(tee "$report") 2>&1

section "NOOS Sleep / Resume Acceptance"
echo "Report: $report"
if [[ -n "$validation_session" ]]; then
  echo "Validation session: $validation_session"
else
  echo "Validation session: missing"
fi
if [[ -n "$session_preflight_report" ]]; then
  echo "Preflight report: $session_preflight_report"
else
  echo "Preflight report: missing"
fi
if [[ -n "$session_wiki_project" ]]; then
  echo "Preflight Wiki watcher project path: $session_wiki_project"
else
  echo "Preflight Wiki watcher project path: missing"
fi
echo "Time: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "Epoch: $acceptance_epoch"
if has_controlled_overrides; then
  echo "Controlled overrides: yes"
else
  echo "Controlled overrides: no"
fi
if [[ "$SKIP_HUB" == "1" || "$SKIP_WIKI" == "1" ]]; then
  echo "Skipped checks: yes"
else
  echo "Skipped checks: no"
fi
if [[ "$SKIP_HUB" == "0" && "$HUB_WRITE_PROBE" == "1" ]]; then
  echo "Hub write probe: yes"
else
  echo "Hub write probe: no"
fi
if [[ "$SKIP_WIKI" == "0" && -n "$WIKI_PROJECT" ]]; then
  echo "Wiki watcher probe: yes"
  echo "Wiki watcher project path: $WIKI_PROJECT"
else
  echo "Wiki watcher probe: no"
fi

if [[ -z "$validation_session" ]]; then
  section "Preflight Session"
  echo "fail    Missing validation session."
  echo "Run npm run sleep:guided -- --wiki-project <path>, or run npm run sleep:preflight -- --wiki-project <path> before manual post-wake acceptance."
  section "Result"
  echo "NOOS sleep/resume acceptance failed."
  exit 1
fi

if [[ -z "$session_preflight_report" || ! -f "$session_preflight_report" ]]; then
  section "Preflight Session"
  echo "fail    Missing preflight report from validation session."
  echo "Run npm run sleep:guided -- --wiki-project <path>, or run npm run sleep:preflight -- --wiki-project <path> before manual post-wake acceptance."
  section "Result"
  echo "NOOS sleep/resume acceptance failed."
  exit 1
fi

if ! rg -q '^ok      Preflight passed$' "$session_preflight_report"; then
  section "Preflight Session"
  echo "fail    Preflight report from validation session did not pass: $session_preflight_report"
  section "Result"
  echo "NOOS sleep/resume acceptance failed."
  exit 1
fi

preflight_report_session="$(report_validation_session "$session_preflight_report")"
if [[ "$preflight_report_session" != "$validation_session" ]]; then
  section "Preflight Session"
  echo "fail    Preflight report validation session does not match current session"
  echo "  session file:     $validation_session"
  echo "  preflight report: ${preflight_report_session:-missing}"
  section "Result"
  echo "NOOS sleep/resume acceptance failed."
  exit 1
fi

preflight_report_wiki_project="$(report_wiki_project "$session_preflight_report")"
if [[ -n "$preflight_report_wiki_project" ]]; then
  preflight_report_wiki_project="$(canonical_dir "$preflight_report_wiki_project")"
fi

if [[ -n "$session_wiki_project" && "$preflight_report_wiki_project" != "$session_wiki_project" ]]; then
  section "Preflight Session"
  echo "fail    Preflight report Wiki project does not match current session"
  echo "  session file:     $session_wiki_project"
  echo "  preflight report: ${preflight_report_wiki_project:-missing}"
  section "Result"
  echo "NOOS sleep/resume acceptance failed."
  exit 1
fi

if [[ -n "$WIKI_PROJECT" && -n "$session_wiki_project" && "$WIKI_PROJECT" != "$session_wiki_project" ]]; then
  section "Preflight Session"
  echo "fail    Wiki project differs from preflight session"
  echo "  preflight:  $session_wiki_project"
  echo "  acceptance: $WIKI_PROJECT"
  section "Result"
  echo "NOOS sleep/resume acceptance failed."
  exit 1
fi

preflight_epoch="$(report_epoch "$session_preflight_report")"
if [[ -z "$preflight_epoch" ]]; then
  section "macOS Sleep/Wake Evidence"
  echo "fail    Preflight report is missing epoch metadata: $session_preflight_report"
  section "Result"
  echo "NOOS sleep/resume acceptance failed."
  exit 1
fi

section "macOS Sleep/Wake Evidence"
if [[ -n "${NOOS_SLEEP_ACCEPTANCE_PMSET_LOG_FILE:-}" && "${NOOS_SLEEP_ACCEPTANCE_SELF_TEST:-0}" == "1" ]] || { [[ "$(uname -s)" == "Darwin" ]] && command -v pmset >/dev/null 2>&1; }; then
  if sleep_wake_lines="$(sleep_wake_between_reports "$preflight_epoch" "$acceptance_epoch")"; then
    sleep_line="$(printf '%s\n' "$sleep_wake_lines" | awk -F'\t' '$1 == "sleep" { print $2; exit }')"
    wake_line="$(printf '%s\n' "$sleep_wake_lines" | awk -F'\t' '$1 == "wake" { print $2; exit }')"
    echo "ok      macOS sleep event found after preflight: $sleep_line"
    echo "ok      macOS wake event found before acceptance: $wake_line"
  else
    echo "fail    No ordered macOS Sleep -> Wake/DarkWake event pair found between preflight and acceptance"
    section "Result"
    echo "NOOS sleep/resume acceptance failed."
    exit 1
  fi
else
  echo "fail    Cannot verify macOS sleep/wake events on this platform"
  section "Result"
  echo "NOOS sleep/resume acceptance failed."
  exit 1
fi

if [[ "$SKIP_HUB" == "0" ]]; then
  section "NOOS Hub"
  hub_args=()
  if [[ "$HUB_WRITE_PROBE" == "1" ]]; then
    hub_args+=(--write-probe)
  fi
  if ! "$ROOT_DIR/scripts/noos-post-wake-check.sh" "${hub_args[@]}"; then
    exit_code=1
  fi
else
  section "NOOS Hub"
  echo "skipped"
fi

if [[ "$SKIP_WIKI" == "0" ]]; then
  section "LLM Wiki"
  wiki_args=()
  if [[ -n "$WIKI_PROJECT" ]]; then
    wiki_args+=(--project "$WIKI_PROJECT")
  fi
  if ! "$ROOT_DIR/scripts/llm-wiki-post-wake-check.sh" "${wiki_args[@]}"; then
    exit_code=1
  fi
else
  section "LLM Wiki"
  echo "skipped"
fi

section "Result"
if [[ "$exit_code" == "0" ]]; then
  echo "NOOS sleep/resume acceptance passed."
else
  echo "NOOS sleep/resume acceptance failed."
fi

exit "$exit_code"
