#!/usr/bin/env python3
"""Plan a NOOS handoff transfer between agents."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any


DEFAULT_REGISTRY = ".noos/agent-registry.json"
RESOLVE_SCRIPT = ".noos/skills/noos-consume-handoff/scripts/resolve_handoff.py"


def main() -> int:
    parser = argparse.ArgumentParser(description="Plan NOOS handoff transfer.")
    parser.add_argument("--repo-root", default=".", help="Repository root.")
    parser.add_argument("--registry", default=DEFAULT_REGISTRY, help="Agent registry path.")
    parser.add_argument("--target", help="Target agent id, display name, or alias.")
    parser.add_argument("--source", help="Source agent id, display name, or alias.")
    parser.add_argument("--path", help="Explicit handoff path.")
    parser.add_argument("--include-inbox", action="store_true", help="Include local inbox directories while resolving handoffs.")
    parser.add_argument("--delivery", choices=["local_file", "repo", "clipboard", "browser_extension", "prompt"], help="Requested delivery method.")
    parser.add_argument("--list-agents", action="store_true", help="List available agents and exit.")
    args = parser.parse_args()

    repo_root = Path(args.repo_root).resolve()
    registry_path = expand_path(args.registry, repo_root)
    registry = read_json(registry_path)
    agents = registry.get("agents", {}) if isinstance(registry, dict) else {}

    if args.list_agents:
        print_json(
            {
                "ok": True,
                "registry": str(registry_path),
                "agents": [
                    {
                        "id": agent_id,
                        "display_name": agent.get("display_name", agent_id),
                        "category": agent.get("category"),
                        "aliases": agent.get("aliases", [])
                    }
                    for agent_id, agent in sorted(agents.items())
                ]
            }
        )
        return 0

    target_id = resolve_agent_id(args.target, agents) if args.target else None
    source_id = resolve_agent_id(args.source, agents) if args.source else detect_current_agent(agents)
    candidates = resolve_candidates(repo_root, args.path, args.include_inbox)
    selected = candidates[0] if len(candidates) == 1 else None

    target = agents.get(target_id, {}) if target_id else {}
    delivery = choose_delivery(target, args.delivery)
    instruction = build_instruction(target_id, target, delivery, selected, repo_root)

    print_json(
        {
            "ok": True,
            "repo_root": str(repo_root),
            "registry": str(registry_path),
            "source_agent": source_id,
            "target_agent": target_id,
            "target": target if target_id else None,
            "delivery": delivery,
            "setup_needed": setup_needed(target_id, target, delivery, selected),
            "candidate_count": len(candidates),
            "selected_handoff": selected,
            "candidates": candidates,
            "instruction": instruction,
            "next_steps": next_steps(target_id, delivery, selected, len(candidates))
        }
    )
    return 0


def read_json(path: Path) -> dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8") as file:
            data = json.load(file)
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def print_json(data: dict[str, Any]) -> None:
    print(json.dumps(data, ensure_ascii=False, indent=2))


def expand_path(value: str, repo_root: Path) -> Path:
    path = Path(os.path.expandvars(os.path.expanduser(value)))
    return path if path.is_absolute() else repo_root / path


def resolve_agent_id(value: str | None, agents: dict[str, Any]) -> str | None:
    if not value:
        return None
    normalized = normalize(value)
    for agent_id, agent in agents.items():
        names = [agent_id, agent.get("display_name", ""), *agent.get("aliases", [])]
        if any(normalize(name) == normalized for name in names):
            return agent_id
    for agent_id, agent in agents.items():
        names = [agent_id, agent.get("display_name", ""), *agent.get("aliases", [])]
        if any(normalized in normalize(name) for name in names):
            return agent_id
    return None


def normalize(value: str) -> str:
    return value.lower().replace("_", "-").strip()


def detect_current_agent(agents: dict[str, Any]) -> str | None:
    env_text = " ".join(f"{key}={value}" for key, value in os.environ.items()).lower()
    if "codex" in env_text:
        return "codex" if "codex" in agents else None
    if "claude" in env_text:
        return "claude-code" if "claude-code" in agents else None
    if "cursor" in env_text:
        return "cursor" if "cursor" in agents else None
    return None


def resolve_candidates(repo_root: Path, explicit_path: str | None, include_inbox: bool) -> list[dict[str, Any]]:
    script = repo_root / RESOLVE_SCRIPT
    if not script.exists():
        return []

    command = [sys.executable, str(script), "--repo-root", str(repo_root), "--limit", "10"]
    if explicit_path:
        command.extend(["--path", explicit_path])
    if include_inbox:
        command.append("--include-inbox")

    try:
        result = subprocess.run(command, check=False, capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.TimeoutExpired):
        return []

    if result.returncode != 0:
        return []

    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError:
        return []

    candidates = payload.get("candidates", [])
    return candidates if isinstance(candidates, list) else []


def choose_delivery(target: dict[str, Any], requested: str | None) -> str | None:
    if requested:
        return requested
    preferences = target.get("delivery_preference", [])
    if isinstance(preferences, list) and preferences:
        return preferences[0]
    return None


def build_instruction(
    target_id: str | None,
    target: dict[str, Any],
    delivery: str | None,
    handoff: dict[str, Any] | None,
    repo_root: Path
) -> str | None:
    if not target_id or not handoff:
        return None

    location = handoff.get("path") or "<paste NOOS handoff here>"
    try:
        location_text = str(Path(location).resolve().relative_to(repo_root)) if handoff.get("path") else location
    except ValueError:
        location_text = str(location)

    if "skill" in target.get("consume", []):
        return f"Use $noos-consume-handoff to read this NOOS handoff and continue the task: {location_text}"
    if delivery in {"local_file", "repo"}:
        return (
            f"Read the NOOS handoff at {location_text}. Treat it as the task source. "
            "Restate the task, constraints, acceptance criteria, and next-agent instructions before making changes."
        )
    return (
        "Please consume the following NOOS handoff. Summarize the task and continue from the "
        f"Suggested Next-Agent Instructions section.\n\n{location_text}"
    )


def setup_needed(target_id: str | None, target: dict[str, Any], delivery: str | None, handoff: dict[str, Any] | None) -> list[str]:
    items: list[str] = []
    if not target_id:
        items.append("target_agent_missing_or_unknown")
    if not handoff:
        items.append("handoff_missing")
    if target.get("skill") == "noos-consume-handoff" and delivery in {"local_file", "repo"}:
        items.append("ensure_noos_consume_handoff_skill_installed")
    if delivery == "repo":
        items.append("ensure_github_auth_and_repo_access")
    if delivery == "browser_extension":
        items.append("ensure_noos_browser_extension_installed")
    return items


def next_steps(target_id: str | None, delivery: str | None, handoff: dict[str, Any] | None, candidate_count: int) -> list[str]:
    steps: list[str] = []
    if not target_id:
        steps.append("Run with --list-agents, then rerun with --target <agent-id>.")
    if candidate_count > 1:
        steps.append("Choose one handoff candidate by path and rerun with --path <handoff.md>.")
    if not handoff:
        steps.append("Create or provide a NOOS handoff path, or rerun with --include-inbox.")
    if handoff and target_id:
        steps.append("Send the instruction field to the target agent.")
    if delivery == "clipboard":
        steps.append("Copy the selected handoff or instruction into the target app.")
    return steps


if __name__ == "__main__":
    raise SystemExit(main())
