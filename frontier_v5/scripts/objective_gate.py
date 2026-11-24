#!/usr/bin/env python3
"""Fail-closed checker for the five-year frontier objective ledger.

Modes:

``--check-consistency`` (default)
    Exit 0 when the ledger is internally consistent and honest, even if the
    objective is not met. Exit non-zero when a workstream claims VERIFIED while
    it has open items or lacks existing runtime/test evidence paths, when any
    referenced path is missing, when a field is not understood, or when a
    top-level claim (``current_gate``, ``gate_marker``, ``verification.status``)
    says PASS although the objective is not met.
``--require-met``
    Exit 0 only when the ledger is consistent *and* every required workstream
    is legitimately VERIFIED.

A workstream is legitimately VERIFIED only when it has no open items in any
open-item list (``remaining``, ``continuing_hardening`` and similar keys), at
least one ``runtime`` anchor and one ``tests`` anchor, every anchor exists as a
file inside the repository (``path::Symbol`` symbols must be defined in that
module or in a sibling module it re-exports via ``from . import``), and
``evidence`` is non-empty. Unknown workstream fields fail closed, so an
open-item list cannot be hidden under a key this gate does not understand.

Claim scope: a repository-local ledger check. It does not verify external CI
runs, comparisons, market position or any claim beyond the repository files.
"""
from __future__ import annotations

from pathlib import Path, PurePosixPath
import argparse
import ast
import json
import re
import sys

GATE = "MUSITU_AXIOM_FIVE_YEAR_FRONTIER_OBJECTIVE"
FRONTIER = Path(__file__).resolve().parents[1]
REPO_ROOT = FRONTIER.parent
DEFAULT_OBJECTIVE = FRONTIER / "FIVE_YEAR_FRONTIER_OBJECTIVE.json"
STATUSES = ("TARGET", "PARTIAL", "IMPLEMENTED_CORE", "VERIFIED")
KNOWN_FIELDS = frozenset({"id", "required", "status", "runtime", "tests", "evidence"})
ANCHOR_FIELDS = ("runtime", "tests")
# Keys (after normalization) that hold open work. "remaining" is canonical.
OPEN_ITEM_KEYS = frozenset({
    "remaining", "continuing_hardening", "hardening", "open", "open_items", "open_issues", "issues",
    "todo", "todos", "to_do", "pending", "gaps", "known_gaps", "blockers", "follow_up", "follow_ups",
    "followups", "next_steps", "outstanding", "deferred", "backlog", "future_work", "in_progress",
    "incomplete", "not_done", "missing", "limitations", "known_limitations", "caveats", "risks",
    "residual", "residual_work", "remaining_work", "work_remaining",
})
OPEN_ITEM_TOKENS = ("remain", "harden", "todo", "pending", "open", "gap", "block", "follow", "next",
                    "outstanding", "defer", "backlog", "future", "missing", "continu", "residual",
                    "limitation", "caveat", "issue", "risk", "incomplete", "unfinished", "unresolved", "wip")
CLAIM_SCOPE = (
    "repository-local ledger check: validates ledger structure, open items and repository paths only; "
    "it does not verify external CI runs, comparisons, market position or world-best/superiority claims"
)


def _normalize_key(key: str) -> str:
    return re.sub(r"[^0-9a-z]+", "_", key.casefold()).strip("_")


def _is_open_item_key(key: str) -> bool:
    norm = _normalize_key(key)
    return norm in OPEN_ITEM_KEYS or any(token in norm for token in OPEN_ITEM_TOKENS)


def _module_names(path: Path, seen: set[Path]) -> set[str]:
    """Top-level names a module defines, plus names of sibling modules it imports via ``from . import``."""
    if path in seen:
        return set()
    seen.add(path)
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    names: set[str] = set()
    siblings: list[Path] = []
    for node in tree.body:
        if isinstance(node, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            names.add(node.name)
        elif isinstance(node, (ast.Assign, ast.AnnAssign, ast.AugAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            for target in targets:
                names.update(n.id for n in ast.walk(target) if isinstance(n, ast.Name))
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            for alias in node.names:
                names.add((alias.asname or alias.name).split(".")[0])
            if isinstance(node, ast.ImportFrom) and node.level == 1 and node.module is None:
                siblings.extend(path.parent / f"{alias.name}.py" for alias in node.names)
    for sibling in siblings:
        if sibling.is_file():
            names |= _module_names(sibling, seen)
    return names


def check_anchor(anchor: object, repo_root: Path) -> str | None:
    """Return None when ``path`` or ``path::Symbol`` exists inside the repository."""
    if not isinstance(anchor, str) or not anchor.strip():
        return "anchor must be a non-empty string"
    path_text, _, symbol = anchor.partition("::")
    rel = PurePosixPath(path_text)
    if not path_text or "\\" in path_text or rel.is_absolute() or ".." in rel.parts or re.match(r"[A-Za-z]:", path_text):
        return "anchor path must be repository-relative without '..'"
    target = (repo_root / Path(*rel.parts)).resolve()
    if not target.is_relative_to(repo_root) or not target.is_file():
        return "anchor path does not exist in the repository"
    if symbol:
        if target.suffix != ".py":
            return "symbol anchors are only supported for Python files"
        if not re.fullmatch(r"[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*", symbol):
            return "anchor symbol is not a Python identifier"
        try:
            defined = _module_names(target, set())
        except (SyntaxError, UnicodeDecodeError, OSError):
            return "anchor module cannot be parsed"
        if symbol.split(".")[0] not in defined:
            return f"symbol {symbol} is not defined in {path_text}"
    return None


def _string_list(item: dict, key: str) -> list | None:
    value = item.get(key, [])
    if not isinstance(value, list) or not all(isinstance(x, str) and x.strip() for x in value):
        return None
    return value


def evaluate(path: Path, mode: str = "check-consistency", repo_root: Path | None = None) -> dict:
    if mode not in ("check-consistency", "require-met"):
        raise ValueError(f"unknown mode: {mode}")
    repo_root = Path(repo_root or REPO_ROOT).resolve()
    result = {
        "gate": GATE, "mode": mode, "status": "FAIL", "consistent": False, "objective_met": False,
        "required_workstreams": 0, "verified_workstreams": 0, "inconsistencies": [], "unmet": [],
        "failures": [], "claim_scope": CLAIM_SCOPE,
    }
    issues: list[dict] = result["inconsistencies"]
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        issues.append({"id": None, "reason": f"cannot read objective ledger: {exc}"})
        result["failures"] = list(issues)
        return result
    workstreams = data.get("workstreams") if isinstance(data, dict) else None
    if not isinstance(workstreams, list) or not workstreams:
        issues.append({"id": None, "reason": "workstreams must be a non-empty list"})
        result["failures"] = list(issues)
        return result

    seen: set[str] = set()
    required_ids: list[str] = []
    legit_verified: set[str] = set()
    for index, item in enumerate(workstreams):
        if not isinstance(item, dict):
            issues.append({"id": None, "reason": f"workstream #{index} must be an object"})
            continue
        wid = item.get("id")
        if not isinstance(wid, str) or not wid.strip() or wid in seen:
            issues.append({"id": wid, "reason": "workstream ids must be unique non-empty strings"})
            continue
        seen.add(wid)
        own: list[str] = []
        required, status = item.get("required"), item.get("status")
        if not isinstance(required, bool):
            own.append("required must be true or false")
        if status not in STATUSES:
            own.append(f"invalid status {status!r}")
        open_items: dict[str, list] = {}
        for key in item:
            if key in KNOWN_FIELDS:
                continue
            if not _is_open_item_key(key):
                own.append(f"unknown workstream field {key!r}; the gate fails closed on fields it does not understand")
                continue
            values = _string_list(item, key)
            if values is None:
                own.append(f"{key} must be a list of non-empty strings")
            elif values:
                open_items[key] = values
        lists = {}
        for key in ANCHOR_FIELDS + ("evidence",):
            lists[key] = _string_list(item, key)
            if lists[key] is None:
                own.append(f"{key} must be a list of non-empty strings")
                lists[key] = []
        for key in ANCHOR_FIELDS:
            for anchor in lists[key]:
                problem = check_anchor(anchor, repo_root)
                if problem:
                    own.append(f"{key} anchor {anchor!r}: {problem}")
        if status == "VERIFIED":
            if open_items:
                own.append("VERIFIED with open items in " + ", ".join(sorted(open_items)))
            for key in ANCHOR_FIELDS:
                if not lists[key]:
                    own.append(f"VERIFIED requires at least one {key} anchor")
            if not lists["evidence"]:
                own.append("VERIFIED requires evidence")
        issues.extend({"id": wid, "reason": reason} for reason in own)
        if required is True:
            required_ids.append(wid)
            if status == "VERIFIED" and not own:
                legit_verified.add(wid)
            else:
                result["unmet"].append({
                    "id": wid, "status": status,
                    "remaining": [x for values in open_items.values() for x in values],
                })

    met = bool(required_ids) and not result["unmet"] and len(legit_verified) == len(required_ids)
    expected_gate = "PASS" if met else "FAIL"
    if data.get("current_gate") != expected_gate:
        issues.append({"id": None, "reason": f"current_gate is {data.get('current_gate')!r} but the ledger evaluates to {expected_gate!r}"})
    marker = data.get("gate_marker")
    if marker is not None and (not isinstance(marker, str) or (marker.endswith("_PASS") and not met)):
        issues.append({"id": None, "reason": f"gate_marker {marker!r} claims PASS but the objective is not met"})
    verification = data.get("verification")
    if verification is not None:
        if not isinstance(verification, dict):
            issues.append({"id": None, "reason": "verification must be an object"})
        elif verification.get("status") == "PASS" and not met:
            issues.append({"id": None, "reason": "verification.status is PASS but the objective is not met"})

    result["required_workstreams"] = len(required_ids)
    result["verified_workstreams"] = len(legit_verified)
    result["objective_met"] = met
    result["consistent"] = not issues
    ok = result["consistent"] and (met or mode == "check-consistency")
    result["status"] = "PASS" if ok else "FAIL"
    result["failures"] = list(issues) + ([] if mode == "check-consistency" else result["unmet"])
    return result


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--objective", default=str(DEFAULT_OBJECTIVE))
    ap.add_argument("--repo-root", default=str(REPO_ROOT), help="root that runtime/test anchors are relative to")
    group = ap.add_mutually_exclusive_group()
    group.add_argument("--check-consistency", dest="mode", action="store_const", const="check-consistency",
                       help="(default) pass when the ledger is consistent and honest, even if the objective is not met")
    group.add_argument("--require-met", dest="mode", action="store_const", const="require-met",
                       help="pass only when every required workstream is legitimately VERIFIED")
    ap.add_argument("--allow-fail", action="store_true", help="report but always exit 0")
    args = ap.parse_args()
    result = evaluate(Path(args.objective), args.mode or "check-consistency", Path(args.repo_root))
    print(json.dumps(result, indent=2, sort_keys=True))
    if result["status"] != "PASS" and not args.allow_fail:
        sys.exit(2)


if __name__ == "__main__":
    main()
