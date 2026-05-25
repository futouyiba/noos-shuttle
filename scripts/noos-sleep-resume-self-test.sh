#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

run_step() {
  local label="$1"
  shift
  printf "\n== %s ==\n" "$label"
  "$@"
}

run_step "LLM Wiki vendor check" "$ROOT_DIR/scripts/noos-wiki-vendor-check.sh"
run_step "LLM Wiki vendor check self-test" "$ROOT_DIR/scripts/noos-wiki-vendor-check-self-test.sh"
run_step "Readiness precheck self-test" "$ROOT_DIR/scripts/noos-sleep-resume-readiness-self-test.sh"
run_step "Preflight metadata self-test" "$ROOT_DIR/scripts/noos-sleep-resume-preflight-self-test.sh"
run_step "Hub post-wake check self-test" "$ROOT_DIR/scripts/noos-post-wake-check-self-test.sh"
run_step "LLM Wiki post-wake check self-test" "$ROOT_DIR/scripts/llm-wiki-post-wake-check-self-test.sh"
run_step "Acceptance metadata self-test" "$ROOT_DIR/scripts/noos-sleep-resume-acceptance-self-test.sh"
run_step "Guided wrapper self-test" "$ROOT_DIR/scripts/noos-sleep-resume-guided-self-test.sh"
run_step "Guided LaunchAgent arm self-test" "$ROOT_DIR/scripts/noos-sleep-resume-arm-self-test.sh"
run_step "Status gate self-test" "$ROOT_DIR/scripts/noos-sleep-resume-status-self-test.sh"
run_step "Objective audit self-test" "$ROOT_DIR/scripts/noos-sleep-resume-audit-self-test.sh"
run_step "Hub recovery state tests" npm run hub:sleep-recovery:test
run_step "LLM Wiki recovery state tests" npm run wiki:sleep-recovery:test

printf "\nok      sleep/resume self-test suite passed\n"
