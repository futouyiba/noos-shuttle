#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

pass() {
  printf "ok      %s\n" "$1"
}

fail() {
  printf "fail    %s\n" "$1"
}

tmpdir="$(mktemp -d)"

cleanup() {
  rm -rf "$tmpdir"
}
trap cleanup EXIT

project="$tmpdir/wiki-project"
home="$tmpdir/home"
noos_home="$tmpdir/noos-home"
mkdir -p "$project" "$home" "$noos_home"

if ! HOME="$home" NOOS_HOME="$noos_home" "$ROOT_DIR/scripts/noos-sleep-resume-arm.sh" --help > "$tmpdir/help.out" 2>&1; then
  fail "sleep arm help failed"
  cat "$tmpdir/help.out"
  exit 1
fi

if ! rg -q 'Sleep -> Wake/DarkWake' "$tmpdir/help.out"; then
  fail "sleep arm help does not describe wake detection"
  cat "$tmpdir/help.out"
  exit 1
fi

if ! HOME="$home" NOOS_HOME="$noos_home" NOOS_SLEEP_ARM_SELF_TEST=1 \
  "$ROOT_DIR/scripts/noos-sleep-resume-arm.sh" start --wiki-project "$project" > "$tmpdir/start.out" 2>&1; then
  fail "sleep arm self-test start failed"
  cat "$tmpdir/start.out"
  exit 1
fi

plist="$home/Library/LaunchAgents/com.noos.sleep-resume.guided.plist"
runner="$noos_home/run/noos-sleep-resume-guided-runner.sh"
launcher="$noos_home/run/noos-sleep-resume-guided-launcher.applescript"

if [[ ! -f "$plist" ]]; then
  fail "sleep arm did not write plist"
  cat "$tmpdir/start.out"
  exit 1
fi

if [[ ! -x "$runner" ]]; then
  fail "sleep arm did not write executable runner"
  cat "$tmpdir/start.out"
  exit 1
fi

if [[ ! -f "$launcher" ]]; then
  fail "sleep arm did not write Terminal launcher"
  cat "$tmpdir/start.out"
  exit 1
fi

if ! rg -q -- '--wiki-project' "$runner"; then
  fail "sleep arm runner does not pass wiki project"
  cat "$runner"
  exit 1
fi

if ! rg -q 'noos-sleep-resume-guided-test.sh' "$runner"; then
  fail "sleep arm runner does not invoke guided validation"
  cat "$runner"
  exit 1
fi

if ! rg -q 'noos-sleep-resume-guided.lock' "$runner"; then
  fail "sleep arm runner does not guard duplicate runs"
  cat "$runner"
  exit 1
fi

if ! rg -q '/usr/bin/osascript' "$plist"; then
  fail "sleep arm plist does not use osascript launcher by default"
  cat "$plist"
  exit 1
fi

if ! HOME="$home" NOOS_HOME="$noos_home" NOOS_SLEEP_ARM_SELF_TEST=1 \
  "$ROOT_DIR/scripts/noos-sleep-resume-arm.sh" status > "$tmpdir/status.out" 2>&1; then
  fail "sleep arm self-test status failed"
  cat "$tmpdir/status.out"
  exit 1
fi

if ! rg -q 'Plist exists: yes' "$tmpdir/status.out"; then
  fail "sleep arm status did not report generated plist"
  cat "$tmpdir/status.out"
  exit 1
fi

if ! HOME="$home" NOOS_HOME="$noos_home" NOOS_SLEEP_ARM_SELF_TEST=1 \
  "$ROOT_DIR/scripts/noos-sleep-resume-arm.sh" stop > "$tmpdir/stop.out" 2>&1; then
  fail "sleep arm self-test stop failed"
  cat "$tmpdir/stop.out"
  exit 1
fi

if [[ -e "$plist" || -e "$runner" || -e "$launcher" ]]; then
  fail "sleep arm stop did not remove generated files"
  exit 1
fi

pass "sleep arm launch agent generation"
