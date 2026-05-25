#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NOOS_HOME="${NOOS_HOME:-$HOME/.noos}"
RUN_DIR="$NOOS_HOME/run"
REPORT_DIR="$NOOS_HOME/reports"
PID_FILE="$RUN_DIR/noos-hub.pid"
HEALTH_URL="${NOOS_HUB_HEALTH_URL:-http://127.0.0.1:17642/health}"
CPU_LIMIT="${NOOS_POST_WAKE_CPU_LIMIT:-25}"
SAMPLES="${NOOS_POST_WAKE_SAMPLES:-5}"
SAMPLE_DELAY="${NOOS_POST_WAKE_SAMPLE_DELAY:-2}"
WRITE_PROBE="${NOOS_POST_WAKE_WRITE_PROBE:-0}"
PID_OVERRIDE="${NOOS_POST_WAKE_PID:-}"

usage() {
  cat <<'EOF'
Usage: scripts/noos-post-wake-check.sh [--write-probe]

Checks the Hub process, CPU settling, and /health after a macOS wake.

Options:
  --write-probe  Also POST timestamped handoff and crystal probes through Hub /v1/ingest.

Environment:
  NOOS_POST_WAKE_CPU_LIMIT       CPU percent threshold for the average sample.
  NOOS_POST_WAKE_SAMPLES         Number of CPU samples to collect.
  NOOS_POST_WAKE_SAMPLE_DELAY    Seconds between CPU samples.
  NOOS_POST_WAKE_WRITE_PROBE=1   Same as --write-probe.
  NOOS_POST_WAKE_PID             Optional pid override for controlled testing.
EOF
}

ok() {
  printf "ok      %s\n" "$1"
}

warn() {
  printf "warn    %s\n" "$1"
}

fail() {
  printf "fail    %s\n" "$1"
}

pid_is_running() {
  local pid="${1:-}"
  [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1
}

read_pid() {
  if [[ -f "$PID_FILE" ]]; then
    tr -d '[:space:]' < "$PID_FILE"
  fi
}

find_hub_pid() {
  pgrep -f "$ROOT_DIR/apps/noos-hub/src-tauri/target/release/bundle/macos/NOOS Hub.app/Contents/MacOS/noos-hub|$ROOT_DIR/apps/noos-hub/src-tauri/target/debug/noos-hub|target/debug/noos-hub" | head -n 1 || true
}

hub_cpu_percent() {
  local pid="$1"
  ps -p "$pid" -o %cpu= 2>/dev/null | awk '{ printf "%.1f\n", $1 }'
}

health_check() {
  curl --max-time 3 -fsS "$HEALTH_URL"
}

expected_noos_marker() {
  case "$1" in
    handoff) echo "<!-- NOOS:THREAD:BEGIN -->" ;;
    crystal) echo "<!-- NOOS:CRYSTAL:BEGIN -->" ;;
    *) return 1 ;;
  esac
}

response_vault_path() {
  python3 -c 'import json,sys; data=json.load(sys.stdin); print(data.get("path") or data.get("file_path") or "")'
}

response_probe_label() {
  python3 -c 'import json,sys; data=json.load(sys.stdin); print(data.get("path") or data.get("file_path") or data.get("lookup_key") or data)'
}

response_lookup_key() {
  python3 -c 'import json,sys; data=json.load(sys.stdin); print(data.get("lookup_key") or data.get("key") or "")'
}

verify_probe_file() {
  local object_type="$1"
  local path="$2"
  local marker vault_root real_path real_vault_root
  marker="$(expected_noos_marker "$object_type")"
  [[ -n "$path" ]] || {
    echo "Hub $object_type ingest response did not include a local path." >&2
    return 1
  }
  [[ -f "$path" ]] || {
    echo "Hub $object_type ingest response path is not a file: $path" >&2
    return 1
  }
  vault_root="$NOOS_HOME/vault"
  real_path="$(cd "$(dirname "$path")" && pwd -P)/$(basename "$path")"
  if [[ -d "$vault_root" ]]; then
    real_vault_root="$(cd "$vault_root" && pwd -P)"
  else
    echo "NOOS Vault root does not exist: $vault_root" >&2
    return 1
  fi
  case "$real_path" in
    "$real_vault_root"/*) ;;
    *)
      echo "Hub $object_type ingest file is outside NOOS Vault: $real_path" >&2
      return 1
      ;;
  esac
  if ! rg -q --fixed-strings "$marker" "$path"; then
    echo "Hub $object_type ingest file is missing expected marker $marker: $path" >&2
    return 1
  fi
}

verify_probe_index() {
  local object_type="$1"
  local lookup_key="$2"
  local path="$3"
  [[ -n "$lookup_key" ]] || {
    echo "Hub $object_type ingest response did not include a lookup key." >&2
    return 1
  }
  python3 - "$NOOS_HOME" "$object_type" "$lookup_key" "$path" <<'PY'
import json
import os
import sys
from pathlib import Path

noos_home = Path(sys.argv[1])
object_type = sys.argv[2]
lookup_key = sys.argv[3]
path = sys.argv[4]
index_path = noos_home / "vault" / "index" / "keys.json"

if not index_path.is_file():
    print(f"Hub {object_type} index file is missing: {index_path}", file=sys.stderr)
    raise SystemExit(1)

try:
    keys = json.loads(index_path.read_text())
except Exception as error:
    print(f"Hub {object_type} index file is not readable JSON: {error}", file=sys.stderr)
    raise SystemExit(1)

entry = keys.get(lookup_key)
if not isinstance(entry, dict):
    print(f"Hub {object_type} lookup key is missing from index: {lookup_key}", file=sys.stderr)
    raise SystemExit(1)

entry_type = entry.get("object_type") or entry.get("type")
if entry_type != object_type:
    print(f"Hub {object_type} index entry has wrong type: {entry_type}", file=sys.stderr)
    raise SystemExit(1)

entry_path = entry.get("path")
if not entry_path:
    print(f"Hub {object_type} index entry has no path: {lookup_key}", file=sys.stderr)
    raise SystemExit(1)

if os.path.realpath(entry_path) != os.path.realpath(path):
    print(
        f"Hub {object_type} index path does not match probe file: {entry_path} != {path}",
        file=sys.stderr,
    )
    raise SystemExit(1)
PY
}

hub_write_probe() {
  local object_type="$1"
  local stamp token payload status body_path response_path vault_path lookup_key label
  stamp="$(date -u '+%Y%m%dT%H%M%SZ')"
  token="$(
    curl --max-time 3 -fsS "${HEALTH_URL%/health}/pair" 2>/dev/null \
      | python3 -c 'import json,sys; print(json.load(sys.stdin).get("token", ""))' 2>/dev/null \
      || true
  )"
  if [[ -z "$token" ]]; then
    echo "Could not obtain Hub local write token." >&2
    return 1
  fi

  body_path="$(mktemp)"
  response_path="$(mktemp)"
  python3 - "$stamp" "$object_type" > "$body_path" <<'PY'
import json
import sys

stamp = sys.argv[1]
object_type = sys.argv[2]
created_at = f"{stamp[:4]}-{stamp[4:6]}-{stamp[6:8]}T{stamp[9:11]}:{stamp[11:13]}:{stamp[13:15]}Z"

if object_type == "handoff":
    marker_begin = "<!-- NOOS:THREAD:BEGIN -->"
    marker_end = "<!-- NOOS:THREAD:END -->"
    frontmatter_type = "noos_thread"
    title = "NOOS Post-Wake Handoff Probe"
    key_field = "handoff_key"
    key = f"{stamp.lower()}-post-wake-handoff-probe"
    heading = "NOOS Post-Wake Handoff Probe"
    summary = "This probe verifies Hub local handoff ingestion after macOS wake."
elif object_type == "crystal":
    marker_begin = "<!-- NOOS:CRYSTAL:BEGIN -->"
    marker_end = "<!-- NOOS:CRYSTAL:END -->"
    frontmatter_type = "noos_crystal"
    title = "NOOS Post-Wake Crystal Probe"
    key_field = "crystal_key"
    key = f"{stamp.lower()}-post-wake-crystal-probe"
    heading = "NOOS Post-Wake Crystal Probe"
    summary = "This probe verifies Hub local crystal ingestion after macOS wake."
else:
    raise SystemExit(f"unsupported object type: {object_type}")

markdown = f"""{marker_begin}
---
type: {frontmatter_type}
version: 0.1
status: active
created_at: {created_at}
title: {title}
{key_field}: {key}
---

# {heading}

{summary}
{marker_end}
"""

payload = {
    "protocol_version": 1,
    "request_id": f"post-wake-{object_type}-{stamp}",
    "idempotency_key": f"post-wake-{object_type}-{stamp}",
    "object_type": object_type,
    "source": {
        "app": "noos-post-wake-check",
        "captured_at": created_at,
    },
    "suggested": {
        "lookup_key": key,
        "filename": f"{key}.md",
        "status": "active",
    },
    "content": {
        "media_type": "text/markdown",
        "text": markdown,
    },
}
json.dump(payload, sys.stdout)
PY

  status="$(
    curl --max-time 5 -sS \
      -o "$response_path" \
      -w '%{http_code}' \
      -H "Authorization: Bearer $token" \
      -H "Content-Type: application/json" \
      --data-binary "@$body_path" \
      "${HEALTH_URL%/health}/v1/ingest" || true
  )"
  payload="$(cat "$response_path")"
  rm -f "$body_path" "$response_path"

  if [[ "$status" != "200" ]]; then
    echo "Hub $object_type ingest returned HTTP $status: $payload" >&2
    return 1
  fi

  vault_path="$(printf "%s\n" "$payload" | response_vault_path)"
  verify_probe_file "$object_type" "$vault_path" || return 1
  lookup_key="$(printf "%s\n" "$payload" | response_lookup_key)"
  verify_probe_index "$object_type" "$lookup_key" "$vault_path" || return 1
  label="$(printf "%s\n" "$payload" | response_probe_label)"
  printf "%s\n" "$label"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --write-probe)
      WRITE_PROBE=1
      shift
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

mkdir -p "$REPORT_DIR"
report="$REPORT_DIR/noos-post-wake-$(date -u '+%Y%m%dT%H%M%SZ').txt"
exec > >(tee "$report") 2>&1

echo "NOOS Post-Wake Check"
echo "Report: $report"
echo "Time: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo

exit_code=0

pid="$PID_OVERRIDE"
if [[ -z "$pid" ]]; then
  pid="$(read_pid)"
  if ! pid_is_running "$pid"; then
    pid="$(find_hub_pid)"
  fi
fi

if pid_is_running "$pid"; then
  ok "NOOS Hub process running: pid=$pid"
  echo "Hub PID after wake: $pid"
else
  fail "NOOS Hub process not found"
  exit 1
fi

health_body="$(health_check || true)"
if [[ -n "$health_body" ]]; then
  ok "Hub health endpoint responds: $HEALTH_URL"
  echo "Health summary:"
  printf "%s\n" "$health_body" | python3 -m json.tool 2>/dev/null || printf "%s\n" "$health_body"
else
  fail "Hub health endpoint failed: $HEALTH_URL"
  exit_code=1
fi

echo
echo "CPU samples:"
cpu_sum="0"
for ((i = 1; i <= SAMPLES; i++)); do
  cpu="$(hub_cpu_percent "$pid")"
  if [[ -z "$cpu" ]]; then
    fail "Could not read CPU for pid=$pid"
    exit_code=1
    break
  fi
  printf "  sample %d/%d: %s%%\n" "$i" "$SAMPLES" "$cpu"
  cpu_sum="$(awk -v a="$cpu_sum" -v b="$cpu" 'BEGIN { printf "%.1f", a + b }')"
  if (( i < SAMPLES )); then
    sleep "$SAMPLE_DELAY"
  fi
done

cpu_avg="$(awk -v sum="$cpu_sum" -v count="$SAMPLES" 'BEGIN { printf "%.1f", sum / count }')"
if awk -v avg="$cpu_avg" -v limit="$CPU_LIMIT" 'BEGIN { exit !(avg <= limit) }'; then
  ok "Average CPU settled: ${cpu_avg}% <= ${CPU_LIMIT}%"
  ok "Hub CPU settled after wake: ${cpu_avg}% <= ${CPU_LIMIT}%"
else
  fail "Average CPU too high: ${cpu_avg}% > ${CPU_LIMIT}%"
  exit_code=1
fi

if [[ "$WRITE_PROBE" == "1" ]]; then
  echo
  if handoff_probe_result="$(hub_write_probe handoff)"; then
    ok "Hub local handoff write probe accepted and verified: $handoff_probe_result"
  else
    fail "Hub local handoff write probe failed"
    exit_code=1
  fi
  if crystal_probe_result="$(hub_write_probe crystal)"; then
    ok "Hub local crystal write probe accepted and verified: $crystal_probe_result"
  else
    fail "Hub local crystal write probe failed"
    exit_code=1
  fi
else
  echo
  warn "Hub local write probe skipped. Re-run with --write-probe to verify Shuttle-style handoff and crystal writes after wake."
fi

echo
if [[ "$exit_code" == "0" ]]; then
  ok "Post-wake check passed"
else
  fail "Post-wake check failed"
fi

exit "$exit_code"
