#!/usr/bin/env bash
set -euo pipefail

NOOS_HOME="${NOOS_HOME:-$HOME/.noos}"
REPORT_DIR="$NOOS_HOME/reports"

usage() {
  cat <<'EOF'
Usage: scripts/noos-sleep-resume-status.sh [--wiki-project PATH]

Audits the latest sleep/resume preflight and acceptance reports. Exits 0 only
when the latest preflight passed, the latest acceptance passed, and the
acceptance report is newer than the preflight report. On macOS, it also
requires an ordered system Sleep -> Wake/DarkWake event pair between the two
reports.

--wiki-project is accepted for command-flow compatibility with readiness,
preflight, guided, and acceptance commands. Status verifies the project recorded
in the latest reports, so the argument is intentionally ignored.
EOF
}

latest_report() {
  local prefix="$1"
  find "$REPORT_DIR" -maxdepth 1 -type f -name "$prefix"-'*.txt' -print 2>/dev/null \
    | awk -v prefix="$prefix" '
      {
        name = $0
        sub(/^.*\//, "", name)
        pattern = "^" prefix "-[0-9]{8}T[0-9]{6}Z[.]txt$"
        if (name ~ pattern) {
          print $0
        }
      }
    ' \
    | sort \
    | tail -n 1 || true
}

canonical_existing_path() {
  local path="$1"
  [[ -n "$path" ]] || return 0
  python3 -c '
import os
import sys

path = sys.argv[1]
if os.path.exists(path):
    print(os.path.realpath(path))
else:
    print(path)
' "$path"
}

mtime_epoch() {
  local path="$1"
  if stat -f '%m' "$path" >/dev/null 2>&1; then
    stat -f '%m' "$path"
  else
    stat -c '%Y' "$path"
  fi
}

report_epoch() {
  local path="$1"
  awk '/^Epoch: [0-9]+$/ { print $2; exit }' "$path"
}

validation_session() {
  local path="$1"
  awk -F': ' '/^Validation session: / { print $2; exit }' "$path"
}

preflight_report_path() {
  local path="$1"
  awk -F': ' '/^Preflight report: / { print $2; exit }' "$path"
}

wiki_project_path() {
  local path="$1"
  awk -F': ' '/^Wiki watcher project path: / { print $2; exit }' "$path"
}

report_pid() {
  local path="$1"
  local label="$2"
  awk -F': ' -v label="$label" '$1 == label { print $2; exit }' "$path"
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

sleep_wake_log() {
  if [[ -n "${NOOS_SLEEP_STATUS_PMSET_LOG_FILE:-}" && "${NOOS_SLEEP_STATUS_SELF_TEST:-0}" == "1" ]]; then
    cat "$NOOS_SLEEP_STATUS_PMSET_LOG_FILE"
  else
    pmset -g log
  fi
}

ok() {
  printf "ok      %s\n" "$1"
}

fail() {
  printf "fail    %s\n" "$1"
}

shell_arg() {
  printf "%q" "$1"
}

recommended_wiki_project() {
  if [[ -n "$acceptance_wiki_project" ]]; then
    printf "%s\n" "$acceptance_wiki_project"
  elif [[ -n "$preflight_wiki_project" ]]; then
    printf "%s\n" "$preflight_wiki_project"
  else
    printf "/path/to/wiki-project\n"
  fi
}

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    -h|--help|help)
      usage
      exit 0
      ;;
    --wiki-project)
      if [[ -z "${2:-}" ]]; then
        echo "Missing value for --wiki-project" >&2
        usage >&2
        exit 2
      fi
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

echo "NOOS Sleep / Resume Status"
echo "Report dir: $REPORT_DIR"
echo

preflight="$(latest_report noos-sleep-resume-preflight)"
acceptance="$(latest_report noos-sleep-resume-acceptance)"
if [[ -n "$preflight" ]]; then
  preflight="$(canonical_existing_path "$preflight")"
fi
if [[ -n "$acceptance" ]]; then
  acceptance="$(canonical_existing_path "$acceptance")"
fi
exit_code=0
preflight_epoch=""
acceptance_epoch=""
preflight_session=""
acceptance_session=""
preflight_wiki_project=""
acceptance_wiki_project=""
acceptance_preflight_report=""
preflight_hub_pid=""
preflight_wiki_pid=""
acceptance_hub_pid=""
acceptance_wiki_pid=""

if [[ -z "$preflight" ]]; then
  fail "No preflight report found"
  exit_code=1
else
  echo "Latest preflight: $preflight"
  if rg -q '^ok      Preflight passed$' "$preflight"; then
    ok "Latest preflight passed"
  else
    fail "Latest preflight did not pass"
    exit_code=1
  fi
  if rg -q '^Controlled overrides: no$' "$preflight"; then
    ok "Latest preflight used real process discovery"
  elif rg -q '^Controlled overrides: yes$' "$preflight"; then
    fail "Latest preflight used controlled overrides"
    exit_code=1
  else
    fail "Latest preflight is missing controlled override metadata"
    exit_code=1
  fi
  if rg -q '^ok      Hub health endpoint responds before sleep:' "$preflight"; then
    ok "Latest preflight contains Hub health baseline evidence"
  else
    fail "Latest preflight is missing Hub health baseline evidence"
    exit_code=1
  fi
  preflight_hub_pid="$(report_pid "$preflight" "Hub PID before sleep")"
  if [[ "$preflight_hub_pid" =~ ^[0-9]+$ ]]; then
    ok "Latest preflight has Hub PID before sleep: $preflight_hub_pid"
  else
    fail "Latest preflight is missing Hub PID before-sleep metadata"
    exit_code=1
  fi
  if rg -q '^ok      Hub CPU baseline settled before sleep:' "$preflight"; then
    ok "Latest preflight contains Hub CPU baseline evidence"
  else
    fail "Latest preflight is missing Hub CPU baseline evidence"
    exit_code=1
  fi
  preflight_wiki_pid="$(report_pid "$preflight" "LLM Wiki PID before sleep")"
  if [[ "$preflight_wiki_pid" =~ ^[0-9]+$ ]]; then
    ok "Latest preflight has LLM Wiki PID before sleep: $preflight_wiki_pid"
  else
    fail "Latest preflight is missing LLM Wiki PID before-sleep metadata"
    exit_code=1
  fi
  if rg -q '^ok      LLM Wiki CPU baseline settled before sleep:' "$preflight"; then
    ok "Latest preflight contains LLM Wiki CPU baseline evidence"
  else
    fail "Latest preflight is missing LLM Wiki CPU baseline evidence"
    exit_code=1
  fi
  if rg -q '^Wiki watcher project: yes$' "$preflight"; then
    ok "Latest preflight included Wiki watcher project"
    if rg -q '^ok      Wiki (file snapshot|watcher state) includes fresh pre-sleep probe$' "$preflight"; then
      ok "Latest preflight contains fresh Wiki watcher baseline evidence"
    else
      fail "Latest preflight is missing fresh Wiki watcher baseline evidence"
      exit_code=1
    fi
    preflight_wiki_project="$(wiki_project_path "$preflight")"
    if [[ -n "$preflight_wiki_project" ]]; then
      preflight_wiki_project="$(canonical_existing_path "$preflight_wiki_project")"
      ok "Latest preflight has Wiki watcher project path: $preflight_wiki_project"
    else
      fail "Latest preflight is missing Wiki watcher project path"
      exit_code=1
    fi
  elif rg -q '^Wiki watcher project: no$' "$preflight"; then
    fail "Latest preflight did not include Wiki watcher project"
    exit_code=1
  else
    fail "Latest preflight is missing Wiki watcher project metadata"
    exit_code=1
  fi
  preflight_epoch="$(report_epoch "$preflight")"
  if [[ -n "$preflight_epoch" ]]; then
    ok "Latest preflight has epoch metadata: $preflight_epoch"
  else
    fail "Latest preflight is missing epoch metadata"
    exit_code=1
  fi
  preflight_session="$(validation_session "$preflight")"
  if [[ -n "$preflight_session" && "$preflight_session" != "missing" ]]; then
    ok "Latest preflight has validation session: $preflight_session"
  else
    fail "Latest preflight is missing validation session metadata"
    exit_code=1
  fi
fi

if [[ -z "$acceptance" ]]; then
  fail "No acceptance report found"
  exit_code=1
else
  echo "Latest acceptance: $acceptance"
  if rg -q '^NOOS sleep/resume acceptance passed\.$' "$acceptance"; then
    ok "Latest acceptance passed"
  else
    fail "Latest acceptance did not pass"
    exit_code=1
  fi
  if rg -q '^Controlled overrides: no$' "$acceptance"; then
    ok "Latest acceptance used real process discovery"
  elif rg -q '^Controlled overrides: yes$' "$acceptance"; then
    fail "Latest acceptance used controlled overrides"
    exit_code=1
  else
    fail "Latest acceptance is missing controlled override metadata"
    exit_code=1
  fi
  if rg -q '^Skipped checks: no$' "$acceptance"; then
    ok "Latest acceptance did not skip Hub or Wiki checks"
  elif rg -q '^Skipped checks: yes$' "$acceptance"; then
    fail "Latest acceptance skipped required Hub or Wiki checks"
    exit_code=1
  else
    fail "Latest acceptance is missing skipped-check metadata"
    exit_code=1
  fi
  if rg -q '^ok      Hub health endpoint responds:' "$acceptance"; then
    ok "Latest acceptance contains Hub health success evidence"
  else
    fail "Latest acceptance is missing Hub health success evidence"
    exit_code=1
  fi
  acceptance_hub_pid="$(report_pid "$acceptance" "Hub PID after wake")"
  if [[ "$acceptance_hub_pid" =~ ^[0-9]+$ ]]; then
    ok "Latest acceptance has Hub PID after wake: $acceptance_hub_pid"
  else
    fail "Latest acceptance is missing Hub PID after-wake metadata"
    exit_code=1
  fi
  if rg -q '^ok      Hub CPU settled after wake:' "$acceptance"; then
    ok "Latest acceptance contains Hub CPU settled evidence"
  else
    fail "Latest acceptance is missing Hub CPU settled evidence"
    exit_code=1
  fi
  acceptance_wiki_pid="$(report_pid "$acceptance" "LLM Wiki PID after wake")"
  if [[ "$acceptance_wiki_pid" =~ ^[0-9]+$ ]]; then
    ok "Latest acceptance has LLM Wiki PID after wake: $acceptance_wiki_pid"
  else
    fail "Latest acceptance is missing LLM Wiki PID after-wake metadata"
    exit_code=1
  fi
  if rg -q '^ok      LLM Wiki CPU settled after wake:' "$acceptance"; then
    ok "Latest acceptance contains LLM Wiki CPU settled evidence"
  else
    fail "Latest acceptance is missing LLM Wiki CPU settled evidence"
    exit_code=1
  fi
  if rg -q '^Hub write probe: yes$' "$acceptance"; then
    ok "Latest acceptance included Hub write probe"
    if rg -q '^ok      Hub local handoff write probe accepted and verified:' "$acceptance"; then
      ok "Latest acceptance contains Hub handoff write-probe file evidence"
    else
      fail "Latest acceptance is missing Hub handoff write-probe file evidence"
      exit_code=1
    fi
    if rg -q '^ok      Hub local crystal write probe accepted and verified:' "$acceptance"; then
      ok "Latest acceptance contains Hub crystal write-probe file evidence"
    else
      fail "Latest acceptance is missing Hub crystal write-probe file evidence"
      exit_code=1
    fi
  elif rg -q '^Hub write probe: no$' "$acceptance"; then
    fail "Latest acceptance did not include Hub write probe"
    exit_code=1
  else
    fail "Latest acceptance is missing Hub write probe metadata"
    exit_code=1
  fi
  if rg -q '^Wiki watcher probe: yes$' "$acceptance"; then
    ok "Latest acceptance included Wiki watcher probe"
    if rg -q '^ok      File (snapshot|watcher state) includes fresh post-wake probe$' "$acceptance"; then
      ok "Latest acceptance contains fresh Wiki watcher success evidence"
    else
      fail "Latest acceptance is missing fresh Wiki watcher success evidence"
      exit_code=1
    fi
    acceptance_wiki_project="$(wiki_project_path "$acceptance")"
    if [[ -n "$acceptance_wiki_project" ]]; then
      acceptance_wiki_project="$(canonical_existing_path "$acceptance_wiki_project")"
      ok "Latest acceptance has Wiki watcher project path: $acceptance_wiki_project"
    else
      fail "Latest acceptance is missing Wiki watcher project path"
      exit_code=1
    fi
  elif rg -q '^Wiki watcher probe: no$' "$acceptance"; then
    fail "Latest acceptance did not include Wiki watcher probe"
    exit_code=1
  else
    fail "Latest acceptance is missing Wiki watcher probe metadata"
    exit_code=1
  fi
  acceptance_epoch="$(report_epoch "$acceptance")"
  if [[ -n "$acceptance_epoch" ]]; then
    ok "Latest acceptance has epoch metadata: $acceptance_epoch"
  else
    fail "Latest acceptance is missing epoch metadata"
    exit_code=1
  fi
  acceptance_session="$(validation_session "$acceptance")"
  if [[ -n "$acceptance_session" && "$acceptance_session" != "missing" ]]; then
    ok "Latest acceptance has validation session: $acceptance_session"
  else
    fail "Latest acceptance is missing validation session metadata"
    exit_code=1
  fi
  acceptance_preflight_report="$(preflight_report_path "$acceptance")"
  if [[ -n "$acceptance_preflight_report" ]]; then
    acceptance_preflight_report="$(canonical_existing_path "$acceptance_preflight_report")"
    ok "Latest acceptance references preflight report: $acceptance_preflight_report"
    if [[ -f "$acceptance_preflight_report" ]]; then
      ok "Latest acceptance preflight report reference exists"
    else
      fail "Latest acceptance preflight report reference does not exist"
      exit_code=1
    fi
  else
    fail "Latest acceptance is missing preflight report reference"
    exit_code=1
  fi
fi

if [[ -n "$preflight" && -n "$acceptance_preflight_report" ]]; then
  if [[ "$acceptance_preflight_report" == "$preflight" ]]; then
    ok "Acceptance preflight report reference matches latest preflight"
  else
    fail "Acceptance preflight report reference does not match latest preflight"
    echo "  latest preflight: $preflight"
    echo "  acceptance ref:   $acceptance_preflight_report"
    exit_code=1
  fi
fi

if [[ -n "$preflight_session" && -n "$acceptance_session" && "$preflight_session" != "missing" && "$acceptance_session" != "missing" ]]; then
  if [[ "$acceptance_session" == "$preflight_session" ]]; then
    ok "Validation session matches between preflight and acceptance"
  else
    fail "Validation session changed between preflight and acceptance"
    echo "  preflight:  $preflight_session"
    echo "  acceptance: $acceptance_session"
    exit_code=1
  fi
fi

if [[ -n "$preflight_wiki_project" && -n "$acceptance_wiki_project" ]]; then
  if [[ "$acceptance_wiki_project" == "$preflight_wiki_project" ]]; then
    ok "Wiki watcher project path matches between preflight and acceptance"
  else
    fail "Wiki watcher project path changed between preflight and acceptance"
    echo "  preflight:  $preflight_wiki_project"
    echo "  acceptance: $acceptance_wiki_project"
    exit_code=1
  fi
fi

if [[ -n "$preflight_hub_pid" && -n "$acceptance_hub_pid" ]]; then
  if [[ "$acceptance_hub_pid" == "$preflight_hub_pid" ]]; then
    ok "Hub process persisted across sleep/wake: pid=$acceptance_hub_pid"
  else
    ok "Hub process changed across sleep/wake, indicating relaunch/replacement: before=$preflight_hub_pid after=$acceptance_hub_pid"
  fi
fi

if [[ -n "$preflight_wiki_pid" && -n "$acceptance_wiki_pid" ]]; then
  if [[ "$acceptance_wiki_pid" == "$preflight_wiki_pid" ]]; then
    ok "LLM Wiki process persisted across sleep/wake: pid=$acceptance_wiki_pid"
  else
    ok "LLM Wiki process changed across sleep/wake, indicating relaunch/replacement: before=$preflight_wiki_pid after=$acceptance_wiki_pid"
  fi
fi

if [[ -n "$preflight" && -n "$acceptance" ]]; then
  preflight_order="${preflight_epoch:-$(mtime_epoch "$preflight")}"
  acceptance_order="${acceptance_epoch:-$(mtime_epoch "$acceptance")}"
  if (( acceptance_order > preflight_order )); then
    ok "Acceptance report is newer than preflight report"
  else
    fail "Acceptance report is not newer than preflight report"
    exit_code=1
  fi
fi

if [[ -n "$preflight_epoch" && -n "$acceptance_epoch" ]]; then
  if [[ "${NOOS_SLEEP_STATUS_SKIP_WAKE_CHECK:-0}" == "1" && "${NOOS_SLEEP_STATUS_SELF_TEST:-0}" == "1" ]]; then
    ok "macOS sleep/wake event check skipped for controlled self-test"
  elif [[ -n "${NOOS_SLEEP_STATUS_PMSET_LOG_FILE:-}" && "${NOOS_SLEEP_STATUS_SELF_TEST:-0}" == "1" ]] || { [[ "$(uname -s)" == "Darwin" ]] && command -v pmset >/dev/null 2>&1; }; then
    if sleep_wake_lines="$(sleep_wake_between_reports "$preflight_epoch" "$acceptance_epoch")"; then
      sleep_line="$(printf '%s\n' "$sleep_wake_lines" | awk -F'\t' '$1 == "sleep" { print $2; exit }')"
      wake_line="$(printf '%s\n' "$sleep_wake_lines" | awk -F'\t' '$1 == "wake" { print $2; exit }')"
      ok "macOS sleep event found between preflight and acceptance: $sleep_line"
      ok "macOS wake event found after sleep before acceptance: $wake_line"
    else
      fail "No ordered macOS Sleep -> Wake/DarkWake event pair found between preflight and acceptance"
      exit_code=1
    fi
  else
    fail "Cannot verify macOS sleep/wake events on this platform"
    exit_code=1
  fi
fi

echo
if [[ "$exit_code" == "0" ]]; then
  ok "Sleep/resume evidence is complete"
else
  fail "Sleep/resume evidence is incomplete"
  wiki_project_arg="$(shell_arg "$(recommended_wiki_project)")"
  echo "Recommended real validation flow:"
  echo "  npm run sleep:readiness -- --wiki-project $wiki_project_arg"
  echo "  npm run sleep:guided -- --wiki-project $wiki_project_arg"
  echo "Manual advanced flow:"
  echo "  npm run sleep:preflight -- --wiki-project $wiki_project_arg"
  echo "  # Sleep and wake macOS manually."
  echo "  npm run sleep:acceptance -- --wiki-project $wiki_project_arg"
fi

exit "$exit_code"
