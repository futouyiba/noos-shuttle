#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

pass() {
  printf "ok      %s\n" "$1"
}

fail() {
  printf "fail    %s\n" "$1"
}

start_snapshot_mock() {
  local project="$1"
  (
    while true; do
      probe="$(find "$project/raw/sources/noos/post-wake-probes" -type f -name '*.md' -print -quit 2>/dev/null || true)"
      if [[ -n "$probe" ]]; then
        basename "$probe" > "$project/.llm-wiki/file-snapshot.json"
        exit 0
      fi
      sleep 0.1
    done
  ) &
}

run_case() {
  local mode="$1"
  local expected="$2"
  local tmpdir
  local snapshot_pid=""
  tmpdir="$(mktemp -d)"

  cleanup_case() {
    if [[ -n "$snapshot_pid" ]]; then
      kill "$snapshot_pid" >/dev/null 2>&1 || true
      wait "$snapshot_pid" >/dev/null 2>&1 || true
    fi
    rm -rf "$tmpdir"
  }
  trap cleanup_case RETURN

  local project="$tmpdir/wiki-project"
  local noos_home="$tmpdir/noos-home"
  mkdir -p "$project/.llm-wiki" "$project/raw/sources/noos/post-wake-probes" "$noos_home/reports"
  echo '[]' > "$project/.llm-wiki/file-snapshot.json"

  if [[ "$mode" == "fresh" ]]; then
    start_snapshot_mock "$project"
    snapshot_pid=$!
  fi

  set +e
  NOOS_HOME="$noos_home" \
    NOOS_WIKI_POST_WAKE_PID="$$" \
    NOOS_WIKI_POST_WAKE_SAMPLES=1 \
    NOOS_WIKI_POST_WAKE_SAMPLE_DELAY=0 \
    NOOS_WIKI_POST_WAKE_CPU_LIMIT=999 \
    NOOS_WIKI_POST_WAKE_WATCHER_TIMEOUT=2 \
    "$ROOT_DIR/scripts/llm-wiki-post-wake-check.sh" --project "$project" > "$tmpdir/check.out" 2>&1
  local exit_status=$?
  set -e

  if [[ "$expected" == "pass" ]]; then
    if [[ "$exit_status" != "0" ]]; then
      fail "$mode wiki post-wake check unexpectedly failed"
      cat "$tmpdir/check.out"
      exit 1
    fi
    if ! rg -q '^ok      File watcher state includes fresh post-wake probe$' "$tmpdir/check.out"; then
      fail "$mode wiki post-wake check did not verify snapshot evidence"
      cat "$tmpdir/check.out"
      exit 1
    fi
  else
    if [[ "$exit_status" == "0" ]]; then
      fail "$mode wiki post-wake check unexpectedly passed"
      cat "$tmpdir/check.out"
      exit 1
    fi
    if ! rg -q 'File watcher state did not include probe' "$tmpdir/check.out"; then
      fail "$mode wiki post-wake check did not reject missing snapshot evidence"
      cat "$tmpdir/check.out"
      exit 1
    fi
  fi

  pass "$mode wiki post-wake watcher probe"
}

run_case fresh pass
run_case stale fail
