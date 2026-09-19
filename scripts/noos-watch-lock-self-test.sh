#!/usr/bin/env bash
# Self-test for scripts/noos-watch-lock.mjs (transport hardening L0).
#
# The load-bearing property is mutual exclusion: exactly one caller may hold the
# lock at a time, including under simultaneous starts. Every other check keeps that
# property from degrading into either a permanent wedge (stale lock never reclaimed)
# or a trampled holder (live run's lock stolen).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCKER=(node "$ROOT/scripts/noos-watch-lock.mjs")
TMPDIR_TEST="$(mktemp -d)"
LOCK="$TMPDIR_TEST/watch.lock"
FAILURES=0

cleanup() { rm -rf "$TMPDIR_TEST"; }
trap cleanup EXIT

pass() { echo "  ok   - $1"; }
fail() { echo "  FAIL - $1"; FAILURES=$((FAILURES + 1)); }

expect_exit() {
  local expected="$1" actual="$2" label="$3"
  if [ "$expected" = "$actual" ]; then pass "$label"; else fail "$label (expected exit $expected, got $actual)"; fi
}

token_of() { python3 -c 'import json,sys; print(json.load(sys.stdin)["holderToken"])'; }

echo "noos-watch-lock self-test"

# --- acquire / busy / release ------------------------------------------------
TOKEN="$("${LOCKER[@]}" acquire --lock "$LOCK" | token_of)"
if [ -n "$TOKEN" ]; then pass "fresh lock is acquired and returns a holder token"; else fail "fresh lock returns a holder token"; fi

"${LOCKER[@]}" acquire --lock "$LOCK" >/dev/null 2>&1
expect_exit 1 $? "second acquire is refused while held (exit 1)"

"${LOCKER[@]}" status --lock "$LOCK" | grep -q '"outcome": "held"'
expect_exit 0 $? "status reports held"

# --- ownership is token-scoped ----------------------------------------------
"${LOCKER[@]}" release --lock "$LOCK" --token "not-the-holder" >/dev/null 2>&1
expect_exit 1 $? "release with a foreign token is refused (exit 1)"
[ -f "$LOCK" ] && pass "foreign release leaves the lock intact" || fail "foreign release leaves the lock intact"

"${LOCKER[@]}" refresh --lock "$LOCK" --token "not-the-holder" >/dev/null 2>&1
expect_exit 1 $? "refresh with a foreign token is refused (exit 1)"

"${LOCKER[@]}" refresh --lock "$LOCK" --token "$TOKEN" >/dev/null 2>&1
expect_exit 0 $? "holder can refresh (heartbeat)"

"${LOCKER[@]}" release --lock "$LOCK" --token "$TOKEN" >/dev/null 2>&1
expect_exit 0 $? "holder releases (exit 0)"

"${LOCKER[@]}" status --lock "$LOCK" | grep -q '"outcome": "free"'
expect_exit 0 $? "status reports free after release"

# --- simultaneous acquisition: exactly one winner ---------------------------
# This is the property that makes duplicate routing impossible.
parallel_lock="$TMPDIR_TEST/parallel.lock"
pids=()
for _ in $(seq 1 12); do
  ( "${LOCKER[@]}" acquire --lock "$parallel_lock" >/dev/null 2>&1; echo $? >> "$TMPDIR_TEST/exits" ) &
  pids+=($!)
done
for pid in "${pids[@]}"; do wait "$pid" 2>/dev/null; done
winners=$(grep -c "^0$" "$TMPDIR_TEST/exits" 2>/dev/null); winners=${winners:-0}
if [ "$winners" = "1" ]; then
  pass "12 simultaneous acquires yield exactly one winner"
else
  fail "12 simultaneous acquires yield exactly one winner (got $winners)"
fi

# --- staleness is TTL-only ---------------------------------------------------
# A fresh lock must never be reclaimed, even though its acquiring process has exited.
"${LOCKER[@]}" acquire --lock "$parallel_lock" >/dev/null 2>&1
expect_exit 1 $? "a fresh lock is not reclaimed just because its writer exited"

# A crash cannot clean up, so an expired lock must be reclaimable.
stale_lock="$TMPDIR_TEST/stale.lock"
cat > "$stale_lock" <<'JSON'
{ "holderToken": "dead-run", "sessionRef": null, "host": "placeholder", "startedAt": "2020-01-01T00:00:00.000Z" }
JSON
if "${LOCKER[@]}" acquire --lock "$stale_lock" | grep -q '"acquired_after_stale"'; then
  pass "an expired lock is reclaimed"
else
  fail "an expired lock is reclaimed"
fi

# --- TTL is configurable -----------------------------------------------------
ttl_lock="$TMPDIR_TEST/ttl.lock"
cat > "$ttl_lock" <<'JSON'
{ "holderToken": "old-run", "sessionRef": null, "host": "placeholder", "startedAt": "2020-01-01T00:00:00.000Z" }
JSON
if "${LOCKER[@]}" acquire --lock "$ttl_lock" --ttl-minutes 0.001 >/dev/null 2>&1; then
  pass "expired lock reclaimed with an explicit TTL"
else
  fail "expired lock reclaimed with an explicit TTL"
fi

echo
if [ "$FAILURES" -eq 0 ]; then
  echo "noos-watch-lock self-test: all checks passed"
  exit 0
fi
echo "noos-watch-lock self-test: $FAILURES check(s) failed"
exit 1
