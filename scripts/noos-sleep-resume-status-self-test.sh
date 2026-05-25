#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

pass() {
  printf "ok      %s\n" "$1"
}

fail() {
  printf "fail    %s\n" "$1"
}

run_expected_failure() {
  local name="$1"
  local expected_pattern="$2"
  local tmp_home
  tmp_home="$(mktemp -d)"
  mkdir -p "$tmp_home/reports"

  "$ROOT_DIR/scripts/noos-sleep-resume-status-self-test.sh" "case:$name" "$tmp_home"

  set +e
  NOOS_HOME="$tmp_home" "$ROOT_DIR/scripts/noos-sleep-resume-status.sh" > "$tmp_home/status.out" 2>&1
  local exit_status=$?
  set -e

  if [[ "$exit_status" == "0" ]]; then
    fail "$name unexpectedly passed"
    cat "$tmp_home/status.out"
    rm -rf "$tmp_home"
    exit 1
  fi

  if ! rg -q "$expected_pattern" "$tmp_home/status.out"; then
    fail "$name did not report expected failure"
    echo "Expected pattern: $expected_pattern"
    cat "$tmp_home/status.out"
    rm -rf "$tmp_home"
    exit 1
  fi

  if ! rg -q "npm run sleep:readiness -- --wiki-project " "$tmp_home/status.out"; then
    fail "$name did not recommend readiness before validation"
    cat "$tmp_home/status.out"
    rm -rf "$tmp_home"
    exit 1
  fi

  if ! rg -q "npm run sleep:guided -- --wiki-project " "$tmp_home/status.out"; then
    fail "$name did not recommend the guided validation flow"
    cat "$tmp_home/status.out"
    rm -rf "$tmp_home"
    exit 1
  fi

  rm -rf "$tmp_home"
  pass "$name"
}

run_expected_success() {
  local name="$1"
  local expected_pattern="$2"
  shift 2
  local -a status_args=("$@")
  local tmp_home
  tmp_home="$(mktemp -d)"
  mkdir -p "$tmp_home/reports"

  "$ROOT_DIR/scripts/noos-sleep-resume-status-self-test.sh" "case:$name" "$tmp_home"

  if ! NOOS_HOME="$tmp_home" NOOS_SLEEP_STATUS_SELF_TEST=1 NOOS_SLEEP_STATUS_SKIP_WAKE_CHECK=1 "$ROOT_DIR/scripts/noos-sleep-resume-status.sh" ${status_args[@]+"${status_args[@]}"} > "$tmp_home/status.out" 2>&1; then
    fail "$name unexpectedly failed"
    cat "$tmp_home/status.out"
    rm -rf "$tmp_home"
    exit 1
  fi

  if ! rg -q "$expected_pattern" "$tmp_home/status.out"; then
    fail "$name did not report expected success"
    echo "Expected pattern: $expected_pattern"
    cat "$tmp_home/status.out"
    rm -rf "$tmp_home"
    exit 1
  fi

  if ! rg -q "macOS sleep/wake event check skipped for controlled self-test" "$tmp_home/status.out"; then
    fail "$name did not report controlled sleep/wake-check skip"
    cat "$tmp_home/status.out"
    rm -rf "$tmp_home"
    exit 1
  fi

  rm -rf "$tmp_home"
  pass "$name"
}

run_expected_success_with_pmset_log() {
  local name="$1"
  local expected_pattern="$2"
  local label="${3:-$name}"
  local tmp_home
  tmp_home="$(mktemp -d)"
  mkdir -p "$tmp_home/reports"

  "$ROOT_DIR/scripts/noos-sleep-resume-status-self-test.sh" "case:$name" "$tmp_home"

  cat > "$tmp_home/pmset.log" <<'EOF'
2027-01-15 16:00:10 +0800 Sleep                 Entering Sleep state
2027-01-15 16:00:30 +0800 Wake                  Wake from Normal Sleep
EOF

  if ! NOOS_HOME="$tmp_home" NOOS_SLEEP_STATUS_SELF_TEST=1 NOOS_SLEEP_STATUS_PMSET_LOG_FILE="$tmp_home/pmset.log" "$ROOT_DIR/scripts/noos-sleep-resume-status.sh" > "$tmp_home/status.out" 2>&1; then
    fail "$label unexpectedly failed"
    cat "$tmp_home/status.out"
    rm -rf "$tmp_home"
    exit 1
  fi

  if ! rg -q "$expected_pattern" "$tmp_home/status.out"; then
    fail "$label did not report expected success"
    echo "Expected pattern: $expected_pattern"
    cat "$tmp_home/status.out"
    rm -rf "$tmp_home"
    exit 1
  fi

  if ! rg -q "macOS sleep event found between preflight and acceptance" "$tmp_home/status.out"; then
    fail "$label did not report parsed sleep event"
    cat "$tmp_home/status.out"
    rm -rf "$tmp_home"
    exit 1
  fi

  if ! rg -q "macOS wake event found after sleep before acceptance" "$tmp_home/status.out"; then
    fail "$label did not report parsed wake event"
    cat "$tmp_home/status.out"
    rm -rf "$tmp_home"
    exit 1
  fi

  rm -rf "$tmp_home"
  pass "$label"
}

run_expected_failure_with_pmset_log() {
  local name="$1"
  local expected_pattern="$2"
  local tmp_home
  tmp_home="$(mktemp -d)"
  mkdir -p "$tmp_home/reports"

  "$ROOT_DIR/scripts/noos-sleep-resume-status-self-test.sh" "case:complete-except-real-wake" "$tmp_home"

  cat > "$tmp_home/pmset.log" <<'EOF'
2027-01-15 16:02:00 +0800 Sleep                 Entering Sleep state after acceptance
2027-01-15 16:02:20 +0800 Wake                  Wake after acceptance
EOF

  set +e
  NOOS_HOME="$tmp_home" NOOS_SLEEP_STATUS_SELF_TEST=1 NOOS_SLEEP_STATUS_PMSET_LOG_FILE="$tmp_home/pmset.log" "$ROOT_DIR/scripts/noos-sleep-resume-status.sh" > "$tmp_home/status.out" 2>&1
  local exit_status=$?
  set -e

  if [[ "$exit_status" == "0" ]]; then
    fail "$name unexpectedly passed"
    cat "$tmp_home/status.out"
    rm -rf "$tmp_home"
    exit 1
  fi

  if ! rg -q "$expected_pattern" "$tmp_home/status.out"; then
    fail "$name did not report expected sleep/wake-check failure"
    echo "Expected pattern: $expected_pattern"
    cat "$tmp_home/status.out"
    rm -rf "$tmp_home"
    exit 1
  fi

  rm -rf "$tmp_home"
  pass "$name"
}

run_expected_failure_with_self_test_only() {
  local name="$1"
  local expected_pattern="$2"
  local label="$name-self-test-only-rejected"
  local tmp_home
  tmp_home="$(mktemp -d)"
  mkdir -p "$tmp_home/reports"

  "$ROOT_DIR/scripts/noos-sleep-resume-status-self-test.sh" "case:$name" "$tmp_home"

  set +e
  NOOS_HOME="$tmp_home" NOOS_SLEEP_STATUS_SELF_TEST=1 "$ROOT_DIR/scripts/noos-sleep-resume-status.sh" > "$tmp_home/status.out" 2>&1
  local exit_status=$?
  set -e

  if [[ "$exit_status" == "0" ]]; then
    fail "$label unexpectedly passed"
    cat "$tmp_home/status.out"
    rm -rf "$tmp_home"
    exit 1
  fi

  if ! rg -q "$expected_pattern" "$tmp_home/status.out"; then
    fail "$label did not report expected sleep/wake-check failure"
    echo "Expected pattern: $expected_pattern"
    cat "$tmp_home/status.out"
    rm -rf "$tmp_home"
    exit 1
  fi

  rm -rf "$tmp_home"
  pass "$label"
}

run_expected_failure_with_skip_only() {
  local name="$1"
  local expected_pattern="$2"
  local label="$name-skip-only-rejected"
  local tmp_home
  tmp_home="$(mktemp -d)"
  mkdir -p "$tmp_home/reports"

  "$ROOT_DIR/scripts/noos-sleep-resume-status-self-test.sh" "case:$name" "$tmp_home"

  set +e
  NOOS_HOME="$tmp_home" NOOS_SLEEP_STATUS_SKIP_WAKE_CHECK=1 "$ROOT_DIR/scripts/noos-sleep-resume-status.sh" > "$tmp_home/status.out" 2>&1
  local exit_status=$?
  set -e

  if [[ "$exit_status" == "0" ]]; then
    fail "$label unexpectedly passed"
    cat "$tmp_home/status.out"
    rm -rf "$tmp_home"
    exit 1
  fi

  if ! rg -q "$expected_pattern" "$tmp_home/status.out"; then
    fail "$label did not report expected sleep/wake-check failure"
    echo "Expected pattern: $expected_pattern"
    cat "$tmp_home/status.out"
    rm -rf "$tmp_home"
    exit 1
  fi

  rm -rf "$tmp_home"
  pass "$label"
}

run_expected_failure_recommends_report_project() {
  local name="recommend-report-wiki-project"
  local tmp_home
  tmp_home="$(mktemp -d)"
  mkdir -p "$tmp_home/reports"

  "$ROOT_DIR/scripts/noos-sleep-resume-status-self-test.sh" "case:complete-except-real-wake" "$tmp_home"

  set +e
  NOOS_HOME="$tmp_home" NOOS_SLEEP_STATUS_SELF_TEST=1 "$ROOT_DIR/scripts/noos-sleep-resume-status.sh" > "$tmp_home/status.out" 2>&1
  local exit_status=$?
  set -e

  if [[ "$exit_status" == "0" ]]; then
    fail "$name unexpectedly passed"
    cat "$tmp_home/status.out"
    rm -rf "$tmp_home"
    exit 1
  fi

  if ! rg -q "npm run sleep:guided -- --wiki-project /tmp/wiki-a" "$tmp_home/status.out"; then
    fail "$name did not recommend the report Wiki project"
    cat "$tmp_home/status.out"
    rm -rf "$tmp_home"
    exit 1
  fi

  rm -rf "$tmp_home"
  pass "$name"
}

write_acceptance_complete() {
  local path="$1"
  local wiki_project="$2"
  local session="${3:-self-test-session}"
  local report_dir preflight_report
  report_dir="$(dirname "$path")"
  preflight_report="$(ls -t "$report_dir"/noos-sleep-resume-preflight-*.txt 2>/dev/null | head -n 1 || true)"
  cat > "$path" <<EOF
NOOS Sleep / Resume Acceptance
Validation session: $session
Preflight report: $preflight_report
Epoch: 1800000060
Controlled overrides: no
Skipped checks: no
ok      Hub health endpoint responds: http://127.0.0.1:17642/health
Hub PID after wake: 12345
ok      Hub CPU settled after wake: 1.0% <= 25%
LLM Wiki PID after wake: 22345
ok      LLM Wiki CPU settled after wake: 1.0% <= 25%
Hub write probe: yes
ok      Hub local handoff write probe accepted and verified: /tmp/handoff.md
ok      Hub local crystal write probe accepted and verified: /tmp/crystal.md
Wiki watcher probe: yes
Wiki watcher project path: $wiki_project
ok      File watcher state includes fresh post-wake probe
NOOS sleep/resume acceptance passed.
EOF
}

write_preflight_complete() {
  local path="$1"
  local wiki_project="$2"
  local session="${3:-self-test-session}"
  cat > "$path" <<EOF
NOOS Sleep / Resume Preflight
Validation session: $session
Epoch: 1800000000
Controlled overrides: no
ok      Hub health endpoint responds before sleep: http://127.0.0.1:17642/health
Hub PID before sleep: 12345
ok      Hub CPU baseline settled before sleep: 1.0% <= 25%
LLM Wiki PID before sleep: 22345
ok      LLM Wiki CPU baseline settled before sleep: 1.0% <= 25%
Wiki watcher project: yes
Wiki watcher project path: $wiki_project
ok      Wiki watcher state includes fresh pre-sleep probe
ok      Preflight passed
EOF
}

case "${1:-}" in
  case:missing-preflight-cpu)
    reports="$2/reports"
    cat > "$reports/noos-sleep-resume-preflight-20260525T000000Z.txt" <<'EOF'
NOOS Sleep / Resume Preflight
Validation session: self-test-session
Epoch: 1800000000
Controlled overrides: no
ok      Hub health endpoint responds before sleep: http://127.0.0.1:17642/health
Hub PID before sleep: 12345
LLM Wiki PID before sleep: 22345
Wiki watcher project: yes
Wiki watcher project path: /tmp/wiki-a
ok      Wiki watcher state includes fresh pre-sleep probe
ok      Preflight passed
EOF
    write_acceptance_complete "$reports/noos-sleep-resume-acceptance-20260525T000100Z.txt" "/tmp/wiki-a"
    ;;
  case:missing-acceptance-success)
    reports="$2/reports"
    write_preflight_complete "$reports/noos-sleep-resume-preflight-20260525T000000Z.txt" "/tmp/wiki-a"
    cat > "$reports/noos-sleep-resume-acceptance-20260525T000100Z.txt" <<'EOF'
NOOS Sleep / Resume Acceptance
Validation session: self-test-session
Epoch: 1800000060
Controlled overrides: no
Skipped checks: no
Hub write probe: yes
Wiki watcher probe: yes
Wiki watcher project path: /tmp/wiki-a
NOOS sleep/resume acceptance passed.
EOF
    ;;
  case:missing-preflight-hub-pid)
    reports="$2/reports"
    write_preflight_complete "$reports/noos-sleep-resume-preflight-20260525T000000Z.txt" "/tmp/wiki-a"
    write_acceptance_complete "$reports/noos-sleep-resume-acceptance-20260525T000100Z.txt" "/tmp/wiki-a"
    perl -ni -e 'print unless /^Hub PID before sleep: /' "$reports/noos-sleep-resume-preflight-20260525T000000Z.txt"
    ;;
  case:missing-acceptance-wiki-pid)
    reports="$2/reports"
    write_preflight_complete "$reports/noos-sleep-resume-preflight-20260525T000000Z.txt" "/tmp/wiki-a"
    write_acceptance_complete "$reports/noos-sleep-resume-acceptance-20260525T000100Z.txt" "/tmp/wiki-a"
    perl -ni -e 'print unless /^LLM Wiki PID after wake: /' "$reports/noos-sleep-resume-acceptance-20260525T000100Z.txt"
    ;;
  case:process-replacement)
    reports="$2/reports"
    write_preflight_complete "$reports/noos-sleep-resume-preflight-20260525T000000Z.txt" "/tmp/wiki-a"
    write_acceptance_complete "$reports/noos-sleep-resume-acceptance-20260525T000100Z.txt" "/tmp/wiki-a"
    perl -0pi -e 's/Hub PID after wake: 12345/Hub PID after wake: 12346/' "$reports/noos-sleep-resume-acceptance-20260525T000100Z.txt"
    perl -0pi -e 's/LLM Wiki PID after wake: 22345/LLM Wiki PID after wake: 22346/' "$reports/noos-sleep-resume-acceptance-20260525T000100Z.txt"
    ;;
  case:mismatched-session)
    reports="$2/reports"
    write_preflight_complete "$reports/noos-sleep-resume-preflight-20260525T000000Z.txt" "/tmp/wiki-a" "self-test-session-a"
    write_acceptance_complete "$reports/noos-sleep-resume-acceptance-20260525T000100Z.txt" "/tmp/wiki-a" "self-test-session-b"
    ;;
  case:missing-crystal-write-probe)
    reports="$2/reports"
    write_preflight_complete "$reports/noos-sleep-resume-preflight-20260525T000000Z.txt" "/tmp/wiki-a"
    write_acceptance_complete "$reports/noos-sleep-resume-acceptance-20260525T000100Z.txt" "/tmp/wiki-a"
    perl -ni -e 'print unless /^ok      Hub local crystal write probe accepted and verified: /' "$reports/noos-sleep-resume-acceptance-20260525T000100Z.txt"
    ;;
  case:mismatched-wiki-project)
    reports="$2/reports"
    write_preflight_complete "$reports/noos-sleep-resume-preflight-20260525T000000Z.txt" "/tmp/wiki-a"
    write_acceptance_complete "$reports/noos-sleep-resume-acceptance-20260525T000100Z.txt" "/tmp/wiki-b"
    ;;
  case:missing-acceptance-preflight-reference)
    reports="$2/reports"
    write_preflight_complete "$reports/noos-sleep-resume-preflight-20260525T000000Z.txt" "/tmp/wiki-a"
    write_acceptance_complete "$reports/noos-sleep-resume-acceptance-20260525T000100Z.txt" "/tmp/wiki-a"
    perl -ni -e 'print unless /^Preflight report: /' "$reports/noos-sleep-resume-acceptance-20260525T000100Z.txt"
    ;;
  case:stale-preflight-watcher-line)
    reports="$2/reports"
    write_preflight_complete "$reports/noos-sleep-resume-preflight-20260525T000000Z.txt" "/tmp/wiki-a"
    write_acceptance_complete "$reports/noos-sleep-resume-acceptance-20260525T000100Z.txt" "/tmp/wiki-a"
    perl -0pi -e 's/Wiki watcher state includes fresh pre-sleep probe/Wiki file snapshot includes pre-sleep probe/' "$reports/noos-sleep-resume-preflight-20260525T000000Z.txt"
    ;;
  case:stale-acceptance-watcher-line)
    reports="$2/reports"
    write_preflight_complete "$reports/noos-sleep-resume-preflight-20260525T000000Z.txt" "/tmp/wiki-a"
    write_acceptance_complete "$reports/noos-sleep-resume-acceptance-20260525T000100Z.txt" "/tmp/wiki-a"
    perl -0pi -e 's/File watcher state includes fresh post-wake probe/File snapshot includes post-wake probe/' "$reports/noos-sleep-resume-acceptance-20260525T000100Z.txt"
    ;;
  case:controlled-acceptance)
    reports="$2/reports"
    write_preflight_complete "$reports/noos-sleep-resume-preflight-20260525T000000Z.txt" "/tmp/wiki-a"
    write_acceptance_complete "$reports/noos-sleep-resume-acceptance-20260525T000100Z.txt" "/tmp/wiki-a"
    perl -0pi -e 's/Controlled overrides: no/Controlled overrides: yes/' "$reports/noos-sleep-resume-acceptance-20260525T000100Z.txt"
    ;;
  case:controlled-preflight)
    reports="$2/reports"
    write_preflight_complete "$reports/noos-sleep-resume-preflight-20260525T000000Z.txt" "/tmp/wiki-a"
    write_acceptance_complete "$reports/noos-sleep-resume-acceptance-20260525T000100Z.txt" "/tmp/wiki-a"
    perl -0pi -e 's/Controlled overrides: no/Controlled overrides: yes/' "$reports/noos-sleep-resume-preflight-20260525T000000Z.txt"
    ;;
  case:acceptance-not-newer)
    reports="$2/reports"
    write_preflight_complete "$reports/noos-sleep-resume-preflight-20260525T000000Z.txt" "/tmp/wiki-a"
    write_acceptance_complete "$reports/noos-sleep-resume-acceptance-20260525T000100Z.txt" "/tmp/wiki-a"
    perl -0pi -e 's/Epoch: 1800000060/Epoch: 1800000000/' "$reports/noos-sleep-resume-acceptance-20260525T000100Z.txt"
    ;;
  case:complete-except-real-wake)
    reports="$2/reports"
    write_preflight_complete "$reports/noos-sleep-resume-preflight-20260525T000000Z.txt" "/tmp/wiki-a"
    write_acceptance_complete "$reports/noos-sleep-resume-acceptance-20260525T000100Z.txt" "/tmp/wiki-a"
    ;;
  case:equivalent-canonical-paths)
    reports="$2/reports"
    mkdir -p "$2/wiki-real" "$2/links"
    ln -s "$2/wiki-real" "$2/wiki-link"
    write_preflight_complete "$reports/noos-sleep-resume-preflight-20260525T000000Z.txt" "$2/wiki-real"
    write_acceptance_complete "$reports/noos-sleep-resume-acceptance-20260525T000100Z.txt" "$2/wiki-link"
    ln -s "$reports/noos-sleep-resume-preflight-20260525T000000Z.txt" "$2/links/preflight-link.txt"
    PREFLIGHT_LINK="$2/links/preflight-link.txt" perl -0pi -e 's/^Preflight report: .*/Preflight report: $ENV{PREFLIGHT_LINK}/m' "$reports/noos-sleep-resume-acceptance-20260525T000100Z.txt"
    ;;
  case:latest-by-filename-not-mtime)
    reports="$2/reports"
    write_preflight_complete "$reports/noos-sleep-resume-preflight-20260525T000000Z.txt" "/tmp/wiki-a"
    write_acceptance_complete "$reports/noos-sleep-resume-acceptance-20260525T000100Z.txt" "/tmp/wiki-a"
    cat > "$reports/noos-sleep-resume-preflight-20260524T235959Z.txt" <<'EOF'
NOOS Sleep / Resume Preflight
Validation session: stale-session
Epoch: 1799999999
Controlled overrides: no
NOOS stale touched preflight report.
EOF
    cat > "$reports/noos-sleep-resume-acceptance-20260524T235959Z.txt" <<'EOF'
NOOS Sleep / Resume Acceptance
Validation session: stale-session
Epoch: 1799999999
Controlled overrides: no
Skipped checks: no
NOOS stale touched acceptance report.
EOF
    touch "$reports/noos-sleep-resume-preflight-20260524T235959Z.txt" "$reports/noos-sleep-resume-acceptance-20260524T235959Z.txt"
    ;;
  case:ignore-invalid-report-filenames)
    reports="$2/reports"
    write_preflight_complete "$reports/noos-sleep-resume-preflight-20260525T000000Z.txt" "/tmp/wiki-a"
    write_acceptance_complete "$reports/noos-sleep-resume-acceptance-20260525T000100Z.txt" "/tmp/wiki-a"
    cat > "$reports/noos-sleep-resume-preflight-zzzzzzzz.txt" <<'EOF'
NOOS Sleep / Resume Preflight
Validation session: invalid-name-session
Epoch: 1900000000
Controlled overrides: no
NOOS invalid filename preflight report.
EOF
    cat > "$reports/noos-sleep-resume-acceptance-zzzzzzzz.txt" <<'EOF'
NOOS Sleep / Resume Acceptance
Validation session: invalid-name-session
Epoch: 1900000001
Controlled overrides: no
Skipped checks: no
NOOS invalid filename acceptance report.
EOF
    ;;
  "")
    run_expected_failure "missing-preflight-cpu" "Latest preflight is missing Hub CPU baseline evidence"
    run_expected_failure "missing-acceptance-success" "Latest acceptance is missing Hub health success evidence"
    run_expected_failure "missing-preflight-hub-pid" "Latest preflight is missing Hub PID before-sleep metadata"
    run_expected_failure "missing-acceptance-wiki-pid" "Latest acceptance is missing LLM Wiki PID after-wake metadata"
    run_expected_failure "mismatched-session" "Validation session changed between preflight and acceptance"
    run_expected_failure "missing-crystal-write-probe" "Latest acceptance is missing Hub crystal write-probe file evidence"
    run_expected_failure "mismatched-wiki-project" "Wiki watcher project path changed between preflight and acceptance"
    run_expected_failure "missing-acceptance-preflight-reference" "Latest acceptance is missing preflight report reference"
    run_expected_failure "stale-preflight-watcher-line" "Latest preflight is missing fresh Wiki watcher baseline evidence"
    run_expected_failure "stale-acceptance-watcher-line" "Latest acceptance is missing fresh Wiki watcher success evidence"
    run_expected_failure "controlled-preflight" "Latest preflight used controlled overrides"
    run_expected_failure "controlled-acceptance" "Latest acceptance used controlled overrides"
    run_expected_failure "acceptance-not-newer" "Acceptance report is not newer than preflight report"
    run_expected_failure_with_skip_only "complete-except-real-wake" "No ordered macOS Sleep -> Wake/DarkWake event pair found between preflight and acceptance|Cannot verify macOS sleep/wake events"
    run_expected_failure_with_self_test_only "complete-except-real-wake" "No ordered macOS Sleep -> Wake/DarkWake event pair found between preflight and acceptance|Cannot verify macOS sleep/wake events"
    run_expected_failure_recommends_report_project
    run_expected_success "complete-except-real-wake" "Sleep/resume evidence is complete"
    run_expected_success "complete-except-real-wake" "Sleep/resume evidence is complete" --wiki-project /tmp/wiki-a
    run_expected_success "equivalent-canonical-paths" "Sleep/resume evidence is complete"
    run_expected_success "process-replacement" "Hub process changed across sleep/wake, indicating relaunch/replacement"
    run_expected_success "latest-by-filename-not-mtime" "Sleep/resume evidence is complete"
    run_expected_success "ignore-invalid-report-filenames" "Sleep/resume evidence is complete"
    run_expected_success_with_pmset_log "complete-except-real-wake" "Sleep/resume evidence is complete" "complete-with-pmset-log"
    run_expected_failure_with_pmset_log "pmset-log-outside-window" "No ordered macOS Sleep -> Wake/DarkWake event pair found between preflight and acceptance"
    ;;
  *)
    echo "Unknown self-test case: $1" >&2
    exit 2
    ;;
esac
