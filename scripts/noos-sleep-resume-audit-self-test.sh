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

noos_home="$tmpdir/noos-home"
mkdir -p "$noos_home/reports"

set +e
NOOS_HOME="$noos_home" "$ROOT_DIR/scripts/noos-sleep-resume-audit.sh" > "$tmpdir/audit.out" 2>&1
audit_status=$?
set -e

if [[ "$audit_status" == "0" ]]; then
  fail "audit unexpectedly passed without sleep/resume reports"
  cat "$tmpdir/audit.out"
  exit 1
fi

if ! rg -q '^ok      LLM Wiki is under noos-shuttle git management$' "$tmpdir/audit.out"; then
  fail "audit did not report passing Wiki git-management gate"
  cat "$tmpdir/audit.out"
  exit 1
fi

if ! rg -q '^fail    Real sleep/resume evidence is incomplete$' "$tmpdir/audit.out"; then
  fail "audit did not report incomplete sleep/resume evidence"
  cat "$tmpdir/audit.out"
  exit 1
fi

if ! rg -q '^fail    Objective evidence is incomplete$' "$tmpdir/audit.out"; then
  fail "audit did not report incomplete objective evidence"
  cat "$tmpdir/audit.out"
  exit 1
fi

if ! rg -q 'npm run sleep:guided -- --wiki-project /path/to/wiki-project' "$tmpdir/audit.out"; then
  fail "audit did not print guided validation next step"
  cat "$tmpdir/audit.out"
  exit 1
fi

wiki_project="$tmpdir/wiki project"
mkdir -p "$wiki_project"
wiki_project="$(cd "$wiki_project" && pwd -P)"
cat > "$noos_home/reports/noos-sleep-resume-preflight-20260525T000000Z.txt" <<EOF
NOOS Sleep / Resume Preflight
Validation session: self-test-session
Epoch: 1800000000
Controlled overrides: no
Wiki watcher project: yes
Wiki watcher project path: $wiki_project
ok      Preflight passed
EOF

set +e
NOOS_HOME="$noos_home" "$ROOT_DIR/scripts/noos-sleep-resume-audit.sh" > "$tmpdir/audit-with-project.out" 2>&1
audit_with_project_status=$?
set -e

if [[ "$audit_with_project_status" == "0" ]]; then
  fail "audit unexpectedly passed without acceptance report"
  cat "$tmpdir/audit-with-project.out"
  exit 1
fi

printf -v wiki_project_arg "%q" "$wiki_project"
if ! rg -Fq "npm run sleep:guided -- --wiki-project $wiki_project_arg" "$tmpdir/audit-with-project.out"; then
  fail "audit did not recommend latest report Wiki project"
  cat "$tmpdir/audit-with-project.out"
  exit 1
fi

pass "audit reports passing Wiki gate and incomplete sleep evidence when reports are missing"
