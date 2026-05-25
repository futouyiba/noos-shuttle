#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NOOS_HOME="${NOOS_HOME:-$HOME/.noos}"
REPORT_DIR="$NOOS_HOME/reports"
SESSION_FILE="$REPORT_DIR/noos-sleep-resume-current-session.txt"
WIKI_PROJECT=""
SKIP_PREFLIGHT=0
SKIP_READINESS=0
SKIP_WAIT=0
WAIT_MODE="${NOOS_SLEEP_GUIDED_WAIT_MODE:-pmset}"
WAIT_TIMEOUT_SECS="${NOOS_SLEEP_GUIDED_WAIT_TIMEOUT_SECS:-43200}"
WAIT_POLL_SECS="${NOOS_SLEEP_GUIDED_WAIT_POLL_SECS:-10}"

usage() {
  cat <<'EOF'
Usage: scripts/noos-sleep-resume-guided-test.sh --wiki-project <path> [options]

Guides a manual real macOS sleep/resume validation:
  1. Check readiness without creating a validation session.
  2. Run sleep preflight.
  3. Wait while the user sleeps and wakes the Mac.
  4. Run sleep acceptance.
  5. Run sleep status and objective audit.

This script does not force macOS to sleep. Put the machine to sleep manually
after preflight. By default it watches pmset logs and continues after a real
Sleep -> Wake/DarkWake pair is observed.

Options:
  --wiki-project <path>  LLM Wiki project directory for watcher evidence.
  --skip-readiness       Do not run the non-mutating readiness precheck.
  --skip-preflight       Start at post-wake acceptance using an existing
                         preflight validation session.
  --skip-wait            Do not wait before post-wake acceptance.
  --wait-mode <mode>     pmset, enter, or none. Default: pmset.
  --wait-timeout-secs N  Maximum seconds to wait in pmset mode. Default: 43200.
  --wait-poll-secs N     Seconds between pmset checks. Default: 10.
EOF
}

current_session_preflight_report() {
  if [[ -f "$SESSION_FILE" ]]; then
    awk -F': ' '/^Preflight report: / { print $2; exit }' "$SESSION_FILE"
  fi
}

report_epoch() {
  local path="$1"
  awk '/^Epoch: [0-9]+$/ { print $2; exit }' "$path"
}

sleep_wake_log() {
  if [[ -n "${NOOS_SLEEP_GUIDED_PMSET_LOG_FILE:-}" && "${NOOS_SLEEP_GUIDED_SELF_TEST:-0}" == "1" ]]; then
    cat "$NOOS_SLEEP_GUIDED_PMSET_LOG_FILE"
  else
    pmset -g log
  fi
}

sleep_wake_after_epoch() {
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

validate_positive_int() {
  local name="$1"
  local value="$2"
  if [[ ! "$value" =~ ^[0-9]+$ || "$value" == "0" ]]; then
    echo "$name must be a positive integer: $value" >&2
    exit 2
  fi
}

wait_for_pmset_wake() {
  local preflight_report preflight_epoch started_at elapsed now sleep_wake_lines
  preflight_report="$(current_session_preflight_report)"
  if [[ -z "$preflight_report" || ! -f "$preflight_report" ]]; then
    echo "Missing preflight report for pmset wait: ${preflight_report:-missing}" >&2
    exit 2
  fi

  preflight_epoch="$(report_epoch "$preflight_report")"
  if [[ -z "$preflight_epoch" ]]; then
    echo "Preflight report is missing epoch metadata: $preflight_report" >&2
    exit 2
  fi

  if [[ "$(uname -s)" != "Darwin" && "${NOOS_SLEEP_GUIDED_SELF_TEST:-0}" != "1" ]]; then
    echo "pmset wait mode requires macOS. Use --wait-mode enter or --skip-wait on this platform." >&2
    exit 2
  fi

  validate_positive_int "--wait-timeout-secs" "$WAIT_TIMEOUT_SECS"
  validate_positive_int "--wait-poll-secs" "$WAIT_POLL_SECS"

  cat <<EOF

Preflight is complete.

Now put macOS to sleep and wake it again. This script will automatically
continue after it sees a Sleep -> Wake/DarkWake pair in pmset logs.

Post-wake commands:
  npm run sleep:acceptance -- --wiki-project $(printf '%q' "$WIKI_PROJECT")
  npm run sleep:status
  npm run sleep:audit

EOF

  started_at="$(date '+%s')"
  while true; do
    now="$(date '+%s')"
    if sleep_wake_lines="$(sleep_wake_after_epoch "$preflight_epoch" "$now")"; then
      printf '%s\n' "$sleep_wake_lines" | awk -F'\t' '$1 == "sleep" { printf "ok      observed sleep event: %s\n", $2 }'
      printf '%s\n' "$sleep_wake_lines" | awk -F'\t' '$1 == "wake" { printf "ok      observed wake event: %s\n", $2 }'
      return 0
    fi

    elapsed="$(( now - started_at ))"
    if (( elapsed >= WAIT_TIMEOUT_SECS )); then
      echo "Timed out after ${WAIT_TIMEOUT_SECS}s waiting for macOS Sleep -> Wake/DarkWake evidence." >&2
      exit 1
    fi
    sleep "$WAIT_POLL_SECS"
  done
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
    --skip-preflight)
      SKIP_PREFLIGHT=1
      shift
      ;;
    --skip-readiness)
      SKIP_READINESS=1
      shift
      ;;
    --skip-wait)
      SKIP_WAIT=1
      WAIT_MODE="none"
      shift
      ;;
    --wait-mode)
      WAIT_MODE="${2:-}"
      if [[ -z "$WAIT_MODE" ]]; then
        echo "Missing value for --wait-mode" >&2
        exit 2
      fi
      shift 2
      ;;
    --wait-timeout-secs)
      WAIT_TIMEOUT_SECS="${2:-}"
      if [[ -z "$WAIT_TIMEOUT_SECS" ]]; then
        echo "Missing value for --wait-timeout-secs" >&2
        exit 2
      fi
      shift 2
      ;;
    --wait-poll-secs)
      WAIT_POLL_SECS="${2:-}"
      if [[ -z "$WAIT_POLL_SECS" ]]; then
        echo "Missing value for --wait-poll-secs" >&2
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

case "$WAIT_MODE" in
  pmset|enter|none)
    ;;
  *)
    echo "Unknown wait mode: $WAIT_MODE" >&2
    usage >&2
    exit 2
    ;;
esac

if [[ "$SKIP_PREFLIGHT" == "0" && "$SKIP_READINESS" == "0" ]]; then
  "$ROOT_DIR/scripts/noos-sleep-resume-readiness.sh" --wiki-project "$WIKI_PROJECT"
fi

if [[ "$SKIP_PREFLIGHT" == "0" ]]; then
  "$ROOT_DIR/scripts/noos-sleep-resume-preflight.sh" --wiki-project "$WIKI_PROJECT"
elif [[ ! -f "$SESSION_FILE" ]]; then
  echo "Missing preflight validation session: $SESSION_FILE" >&2
  echo "Run npm run sleep:guided -- --wiki-project <path>, or run npm run sleep:preflight -- --wiki-project <path> before --skip-preflight." >&2
  exit 2
fi

if [[ "$SKIP_WAIT" == "0" && "$WAIT_MODE" == "enter" ]]; then
  cat <<EOF

Preflight is complete.

Now put macOS to sleep, wake it again, then return here and press Enter.
The script will run:
  npm run sleep:acceptance -- --wiki-project $(printf '%q' "$WIKI_PROJECT")
  npm run sleep:status
  npm run sleep:audit

EOF
  read -r _
elif [[ "$SKIP_WAIT" == "0" && "$WAIT_MODE" == "pmset" ]]; then
  wait_for_pmset_wake
fi

"$ROOT_DIR/scripts/noos-sleep-resume-acceptance.sh" --wiki-project "$WIKI_PROJECT"
"$ROOT_DIR/scripts/noos-sleep-resume-status.sh"
"$ROOT_DIR/scripts/noos-sleep-resume-audit.sh"
