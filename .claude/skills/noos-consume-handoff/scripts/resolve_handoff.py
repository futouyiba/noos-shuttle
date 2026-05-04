#!/usr/bin/env python3
"""Resolve candidate NOOS handoffs from local inputs and config."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any

BEGIN = "<!-- NOOS:THREAD:BEGIN -->"
END = "<!-- NOOS:THREAD:END -->"


@dataclass
class Candidate:
    source_type: str
    path: str | None
    title: str
    created_at: str | None
    mtime: float | None
    size: int
    warnings: list[str]


def main() -> int:
    parser = argparse.ArgumentParser(description="Resolve NOOS handoff candidates.")
    parser.add_argument("--path", help="Explicit handoff file path.")
    parser.add_argument("--stdin", action="store_true", help="Read handoff content from stdin.")
    parser.add_argument("--clipboard", action="store_true", help="Try reading handoff content from the OS clipboard.")
    parser.add_argument("--include-inbox", action="store_true", help="Scan configured local inbox directories.")
    parser.add_argument("--max-age-hours", type=float, default=48, help="Max age for inbox candidates.")
    parser.add_argument("--limit", type=int, default=20, help="Maximum candidates to return.")
    parser.add_argument("--repo-root", default=".", help="Repository root to inspect.")
    args = parser.parse_args()

    repo_root = Path(args.repo_root).resolve()
    config = load_effective_config(repo_root)
    candidates: list[Candidate] = []
    setup_needed: list[str] = []

    if args.stdin:
        content = sys.stdin.read()
        candidate = candidate_from_content("stdin", None, content)
        if candidate:
            candidates.append(candidate)

    if args.clipboard:
        content = read_clipboard()
        if content:
            candidate = candidate_from_content("clipboard", None, content)
            if candidate:
                candidates.append(candidate)
        else:
            setup_needed.append("clipboard_unavailable")

    if args.path:
        path = expand_path(args.path, repo_root)
        candidate = candidate_from_file("explicit_path", path)
        if candidate:
            candidates.append(candidate)
        else:
            setup_needed.append("explicit_path_not_found_or_invalid")

    active_dir = repo_root / config["project"].get("handoff_dirs", {}).get("active", ".noos/handoffs/active")
    candidates.extend(scan_dir("repo_active", active_dir, max_age_hours=None, limit=args.limit))

    if args.include_inbox:
        inbox_dirs = config["user"].get("local_inbox_dirs") or ["~/NOOS/inbox", "~/Downloads"]
        for inbox in inbox_dirs:
            candidates.extend(
                scan_dir("local_inbox", expand_path(inbox, repo_root), max_age_hours=args.max_age_hours, limit=args.limit)
            )
        if not inbox_dirs:
            setup_needed.append("local_inbox_dirs_missing")

    candidates = dedupe_candidates(candidates)
    candidates.sort(key=lambda item: item.mtime or 0, reverse=True)
    candidates = candidates[: args.limit]

    print(
        json.dumps(
            {
                "ok": True,
                "repo_root": str(repo_root),
                "config": {
                    "project_config": str(repo_root / ".noos/project.json"),
                    "local_config": str(repo_root / ".noos/local.json"),
                    "user_config": str(Path.home() / ".noos/config.json"),
                    "github": config["project"].get("github", {})
                },
                "setup_needed": setup_needed,
                "candidates": [asdict(candidate) for candidate in candidates]
            },
            ensure_ascii=False,
            indent=2
        )
    )
    return 0


def load_effective_config(repo_root: Path) -> dict[str, Any]:
    return {
        "user": read_json(Path.home() / ".noos/config.json") or read_json(repo_root / ".noos/config.example.json") or {},
        "project": read_json(repo_root / ".noos/project.json") or {},
        "local": read_json(repo_root / ".noos/local.json") or {}
    }


def read_json(path: Path) -> dict[str, Any] | None:
    try:
        if not path.exists():
            return None
        with path.open("r", encoding="utf-8") as file:
            data = json.load(file)
        return data if isinstance(data, dict) else None
    except (OSError, json.JSONDecodeError):
        return None


def expand_path(value: str, repo_root: Path) -> Path:
    expanded = Path(os.path.expandvars(os.path.expanduser(value)))
    if expanded.is_absolute():
        return expanded
    return repo_root / expanded


def scan_dir(source_type: str, directory: Path, max_age_hours: float | None, limit: int) -> list[Candidate]:
    if not directory.exists() or not directory.is_dir():
        return []

    now = max(Path.cwd().stat().st_mtime, directory.stat().st_mtime)
    candidates: list[Candidate] = []
    files = sorted(directory.glob("*.md"), key=lambda path: path.stat().st_mtime, reverse=True)

    for path in files:
        if max_age_hours is not None:
            age_hours = (now - path.stat().st_mtime) / 3600
            if age_hours > max_age_hours:
                continue
        candidate = candidate_from_file(source_type, path)
        if candidate:
            candidates.append(candidate)
        if len(candidates) >= limit:
            break

    return candidates


def candidate_from_file(source_type: str, path: Path) -> Candidate | None:
    try:
        content = path.read_text(encoding="utf-8")
        stat = path.stat()
    except OSError:
        return None

    candidate = candidate_from_content(source_type, str(path), content)
    if not candidate:
        return None

    candidate.mtime = stat.st_mtime
    candidate.size = stat.st_size
    return candidate


def candidate_from_content(source_type: str, path: str | None, content: str) -> Candidate | None:
    if BEGIN not in content or END not in content:
        return None

    warnings: list[str] = []
    begin = content.find(BEGIN)
    end = content.find(END, begin + len(BEGIN))
    if end == -1:
        return None

    block = content[begin : end + len(END)]
    title = parse_frontmatter_value(block, "title") or parse_heading_title(block) or "Untitled NOOS Handoff"
    created_at = parse_frontmatter_value(block, "created_at")

    if parse_frontmatter_value(block, "type") != "noos_thread":
        warnings.append("frontmatter type is not noos_thread")
    if not parse_frontmatter_value(block, "version"):
        warnings.append("frontmatter version missing")

    return Candidate(
        source_type=source_type,
        path=path,
        title=title,
        created_at=created_at,
        mtime=None,
        size=len(content.encode("utf-8")),
        warnings=warnings
    )


def parse_frontmatter_value(content: str, key: str) -> str | None:
    match = re.search(rf"^{re.escape(key)}:\s*(.+?)\s*$", content, flags=re.MULTILINE)
    if not match:
        return None
    return match.group(1).strip().strip("\"'")


def parse_heading_title(content: str) -> str | None:
    match = re.search(r"^#\s+Thread:\s*(.+?)\s*$", content, flags=re.MULTILINE | re.IGNORECASE)
    if match:
        return match.group(1).strip()
    match = re.search(r"^#\s+交接[：:]\s*(.+?)\s*$", content, flags=re.MULTILINE)
    if match:
        return match.group(1).strip()
    return None


def read_clipboard() -> str | None:
    commands = [
        ["pbpaste"],
        ["wl-paste"],
        ["xclip", "-selection", "clipboard", "-o"],
        ["powershell.exe", "-NoProfile", "-Command", "Get-Clipboard"]
    ]
    for command in commands:
        try:
            result = subprocess.run(command, check=False, capture_output=True, text=True, timeout=3)
        except (OSError, subprocess.TimeoutExpired):
            continue
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout
    return None


def dedupe_candidates(candidates: list[Candidate]) -> list[Candidate]:
    seen: set[tuple[str | None, str, str | None]] = set()
    result: list[Candidate] = []
    for candidate in candidates:
        key = (candidate.path, candidate.title, candidate.created_at)
        if key in seen:
            continue
        seen.add(key)
        result.append(candidate)
    return result


if __name__ == "__main__":
    raise SystemExit(main())
