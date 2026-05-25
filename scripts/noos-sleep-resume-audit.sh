#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NOOS_HOME="${NOOS_HOME:-$HOME/.noos}"
REPORT_DIR="$NOOS_HOME/reports"

usage() {
  cat <<'EOF'
Usage: scripts/noos-sleep-resume-audit.sh

Audits the full handoff objective:
  1. LLM Wiki is vendored into noos-shuttle git management.
  2. The latest sleep/resume reports prove a real macOS Sleep -> Wake/DarkWake
     validation with Hub and LLM Wiki evidence.

This command does not put macOS to sleep. It exits 0 only when both gates pass.
EOF
}

section() {
  printf "\n== %s ==\n" "$1"
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

wiki_project_path() {
  local path="$1"
  awk -F': ' '/^Wiki watcher project path: / { print $2; exit }' "$path"
}

shell_arg() {
  printf "%q" "$1"
}

recommended_wiki_project() {
  local report project
  for report in "$(latest_report noos-sleep-resume-acceptance)" "$(latest_report noos-sleep-resume-preflight)"; do
    [[ -n "$report" ]] || continue
    project="$(wiki_project_path "$report")"
    [[ -n "$project" ]] || continue
    canonical_existing_path "$project"
    return 0
  done
  printf "/path/to/wiki-project\n"
}

case "${1:-}" in
  -h|--help|help)
    usage
    exit 0
    ;;
  "")
    ;;
  *)
    echo "Unknown argument: $1" >&2
    usage >&2
    exit 2
    ;;
esac

exit_code=0

section "LLM Wiki Git Management"
if "$ROOT_DIR/scripts/noos-wiki-vendor-check.sh"; then
  wiki_status=0
else
  wiki_status=$?
  exit_code=1
fi

section "Sleep / Resume Evidence"
if "$ROOT_DIR/scripts/noos-sleep-resume-status.sh"; then
  sleep_status=0
else
  sleep_status=$?
  exit_code=1
fi

section "Objective Audit"
if [[ "$wiki_status" == "0" ]]; then
  printf "ok      LLM Wiki is under noos-shuttle git management\n"
else
  printf "fail    LLM Wiki git-management gate failed\n"
fi

if [[ "$sleep_status" == "0" ]]; then
  printf "ok      Real sleep/resume evidence is complete\n"
else
  printf "fail    Real sleep/resume evidence is incomplete\n"
fi

if [[ "$exit_code" == "0" ]]; then
  printf "ok      Objective evidence is complete\n"
else
  printf "fail    Objective evidence is incomplete\n"
  wiki_project_arg="$(shell_arg "$(recommended_wiki_project)")"
  printf "Next real validation flow:\n"
  printf "  npm run sleep:readiness -- --wiki-project %s\n" "$wiki_project_arg"
  printf "  npm run sleep:guided -- --wiki-project %s\n" "$wiki_project_arg"
fi

exit "$exit_code"
