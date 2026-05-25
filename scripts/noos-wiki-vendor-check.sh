#!/usr/bin/env bash
set -euo pipefail

DEFAULT_ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -n "${NOOS_WIKI_VENDOR_ROOT:-}" ]]; then
  if [[ "${NOOS_WIKI_VENDOR_SELF_TEST:-0}" == "1" ]]; then
    ROOT_DIR="$NOOS_WIKI_VENDOR_ROOT"
  else
    echo "NOOS_WIKI_VENDOR_ROOT is reserved for vendor self-tests." >&2
    exit 2
  fi
else
  ROOT_DIR="$DEFAULT_ROOT_DIR"
fi
WIKI_DIR="$ROOT_DIR/apps/llm-wiki"

ok() {
  printf "ok      %s\n" "$1"
}

fail() {
  printf "fail    %s\n" "$1"
}

exit_code=0

echo "NOOS LLM Wiki Vendor Check"
echo "Wiki dir: $WIKI_DIR"
echo

if [[ -d "$WIKI_DIR" ]]; then
  ok "LLM Wiki directory exists"
else
  fail "LLM Wiki directory is missing"
  exit 1
fi

for required in \
  package.json \
  package-lock.json \
  index.html \
  vite.config.ts \
  src/App.tsx \
  src-tauri/Cargo.toml \
  src-tauri/Cargo.lock \
  src-tauri/tauri.conf.json \
  src-tauri/src/lib.rs
do
  if [[ -f "$WIKI_DIR/$required" ]]; then
    ok "Required file exists: apps/llm-wiki/$required"
  else
    fail "Required file is missing: apps/llm-wiki/$required"
    exit_code=1
  fi

  if git -C "$ROOT_DIR" ls-files --cached --error-unmatch "apps/llm-wiki/$required" >/dev/null 2>&1; then
    ok "Required file is staged/tracked: apps/llm-wiki/$required"
  else
    fail "Required file is not staged/tracked by this repository: apps/llm-wiki/$required"
    exit_code=1
  fi
done

nested_git_file="$(mktemp)"
find "$WIKI_DIR" -name .git -print > "$nested_git_file"

if [[ ! -s "$nested_git_file" ]]; then
  ok "No nested git metadata found"
else
  fail "Nested repository metadata found"
  sed 's/^/  /' "$nested_git_file"
  exit_code=1
fi
rm -f "$nested_git_file"

tracked_artifacts_file="$(mktemp)"
git -C "$ROOT_DIR" ls-files --cached -- apps/llm-wiki \
  | rg '(^|/)(node_modules|dist|target)(/|$)|\.tsbuildinfo$' \
  > "$tracked_artifacts_file" || true

if [[ ! -s "$tracked_artifacts_file" ]]; then
  ok "No generated dependency/build artifacts are staged/tracked"
else
  fail "Generated dependency/build artifacts are staged/tracked"
  sed 's/^/  /' "$tracked_artifacts_file"
  exit_code=1
fi
rm -f "$tracked_artifacts_file"

for ignored in \
  apps/llm-wiki/node_modules/example \
  apps/llm-wiki/dist/example \
  apps/llm-wiki/src-tauri/target/example \
  apps/llm-wiki/example.tsbuildinfo
do
  if git -C "$ROOT_DIR" check-ignore --no-index -q "$ignored"; then
    ok "Generated artifact path is ignored: $ignored"
  else
    fail "Generated artifact path is not ignored: $ignored"
    exit_code=1
  fi
done

if git -C "$ROOT_DIR" status --short -- "apps/llm-wiki" | rg -q '^[AM]'; then
  ok "LLM Wiki files are visible to the noos-shuttle git index"
else
  fail "LLM Wiki files are not visible as staged/tracked repository content"
  exit_code=1
fi

unstaged_file="$(mktemp)"
git -C "$ROOT_DIR" diff --name-only -- apps/llm-wiki > "$unstaged_file"

if [[ ! -s "$unstaged_file" ]]; then
  ok "No unstaged LLM Wiki file changes are outside the git index"
else
  fail "Unstaged LLM Wiki file changes are outside the git index"
  sed 's/^/  /' "$unstaged_file"
  exit_code=1
fi
rm -f "$unstaged_file"

untracked_file="$(mktemp)"
git -C "$ROOT_DIR" ls-files --others --exclude-standard -- apps/llm-wiki > "$untracked_file"

if [[ ! -s "$untracked_file" ]]; then
  ok "No non-ignored LLM Wiki files are missing from git"
else
  fail "Non-ignored LLM Wiki files are missing from git"
  sed 's/^/  /' "$untracked_file"
  exit_code=1
fi
rm -f "$untracked_file"

echo
if [[ "$exit_code" == "0" ]]; then
  ok "LLM Wiki vendor check passed"
else
  fail "LLM Wiki vendor check failed"
fi

exit "$exit_code"
