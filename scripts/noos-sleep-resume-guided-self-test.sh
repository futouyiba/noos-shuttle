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
noos_home="$tmpdir/noos-home"
mkdir -p "$project" "$noos_home"

if ! "$ROOT_DIR/scripts/noos-sleep-resume-guided-test.sh" --help > "$tmpdir/help.out" 2>&1; then
  fail "guided help failed"
  cat "$tmpdir/help.out"
  exit 1
fi

if ! rg -q -- '--skip-preflight.*existing' "$tmpdir/help.out"; then
  fail "guided help does not describe preflight session requirement"
  cat "$tmpdir/help.out"
  exit 1
fi

if ! rg -q -- '--skip-readiness.*non-mutating readiness' "$tmpdir/help.out"; then
  fail "guided help does not describe readiness skip"
  cat "$tmpdir/help.out"
  exit 1
fi

if ! rg -q 'Run sleep status and objective audit' "$tmpdir/help.out"; then
  fail "guided help does not describe objective audit"
  cat "$tmpdir/help.out"
  exit 1
fi

if ! rg -q -- '--wait-mode <mode>.*pmset' "$tmpdir/help.out"; then
  fail "guided help does not describe pmset wait mode"
  cat "$tmpdir/help.out"
  exit 1
fi

if ! rg -q 'Sleep -> Wake/DarkWake pair is observed' "$tmpdir/help.out"; then
  fail "guided help does not describe automatic wake detection"
  cat "$tmpdir/help.out"
  exit 1
fi

set +e
NOOS_HOME="$noos_home" "$ROOT_DIR/scripts/noos-sleep-resume-guided-test.sh" \
  --wiki-project "$project" \
  --skip-preflight \
  --skip-wait \
  > "$tmpdir/missing-session.out" 2>&1
missing_session_status=$?
set -e

if [[ "$missing_session_status" != "2" ]]; then
  fail "guided skip-preflight missing-session case exited $missing_session_status instead of 2"
  cat "$tmpdir/missing-session.out"
  exit 1
fi

if ! rg -q 'Missing preflight validation session' "$tmpdir/missing-session.out"; then
  fail "guided missing-session case did not explain the preflight requirement"
  cat "$tmpdir/missing-session.out"
  exit 1
fi

if ! rg -q 'npm run sleep:guided -- --wiki-project <path>' "$tmpdir/missing-session.out"; then
  fail "guided missing-session case did not recommend the guided flow"
  cat "$tmpdir/missing-session.out"
  exit 1
fi

set +e
NOOS_HOME="$noos_home" "$ROOT_DIR/scripts/noos-sleep-resume-guided-test.sh" \
  --wiki-project "$project" \
  --wait-mode invalid \
  > "$tmpdir/invalid-wait-mode.out" 2>&1
invalid_wait_mode_status=$?
set -e

if [[ "$invalid_wait_mode_status" != "2" ]]; then
  fail "guided invalid wait mode exited $invalid_wait_mode_status instead of 2"
  cat "$tmpdir/invalid-wait-mode.out"
  exit 1
fi

if ! rg -q 'Unknown wait mode: invalid' "$tmpdir/invalid-wait-mode.out"; then
  fail "guided invalid wait mode did not explain the failure"
  cat "$tmpdir/invalid-wait-mode.out"
  exit 1
fi

if ! rg -Fq '"$ROOT_DIR/scripts/noos-sleep-resume-audit.sh"' "$ROOT_DIR/scripts/noos-sleep-resume-guided-test.sh"; then
  fail "guided wrapper does not run the objective audit"
  exit 1
fi

if ! rg -Fq 'wait_for_pmset_wake' "$ROOT_DIR/scripts/noos-sleep-resume-guided-test.sh"; then
  fail "guided wrapper does not include pmset wake waiting"
  exit 1
fi

pass "guided wrapper rejects skip-preflight without session, validates wait mode, and includes objective audit"
