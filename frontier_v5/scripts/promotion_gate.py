#!/usr/bin/env python3
"""Fail-closed MUSITU Axiom Frontier promotion gate.

Every required suite entry in the evidence file must be an object::

    {"status": "PASS", "artifact": "<relative path>", "sha256": "<64 hex>"}

``artifact`` is resolved against ``--evidence-root`` (default: the evidence
file's directory) and must stay inside it (no absolute paths, ``..`` or symlink
escapes). The artifact's SHA-256 must match ``sha256`` and the artifact must be
a JSON object reporting ``{"suite": "<that suite>", "status": "PASS"}``. Plain
``"PASS"`` strings, missing suites and malformed evidence fail. Exit 0 on PASS,
2 on FAIL.

Claim scope: this is a repository-local integrity check of self-reported suite
artifacts. It is not an external comparison, independent validation or
parity/superiority evidence.
"""
import argparse
import hashlib
import hmac
import json
import re
import sys
from pathlib import Path, PurePosixPath

REQUIRED = ["functional", "security", "policy", "regression", "unseen_eval", "provenance"]
GATE = "MUSITU_AXIOM_FRONTIER_PROMOTION"
CLAIM_SCOPE = (
    "repository-local: checks that each required suite points to an artifact inside the evidence root "
    "whose SHA-256 matches and which itself reports PASS for that suite. It is not an external comparison, "
    "independent validation, or parity/superiority evidence."
)
_SHA256 = re.compile(r"[0-9a-fA-F]{64}")


def _load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def check_suite(suite, entry, root):
    """Return None when the suite's evidence is valid, else the failure reason."""
    if not isinstance(entry, dict):
        return "entry must be an object with status, artifact and sha256 (plain status strings are not evidence)"
    if entry.get("status") != "PASS":
        return f"status is {entry.get('status')!r}, not 'PASS'"
    artifact, digest = entry.get("artifact"), entry.get("sha256")
    if not isinstance(artifact, str) or not artifact.strip():
        return "artifact must be a non-empty relative path"
    if not isinstance(digest, str) or not _SHA256.fullmatch(digest):
        return "sha256 must be 64 hexadecimal characters"
    rel = PurePosixPath(artifact)
    if "\\" in artifact or rel.is_absolute() or re.match(r"[A-Za-z]:", artifact) or ".." in rel.parts:
        return "artifact path must be relative to the evidence root without '..'"
    target = (root / Path(*rel.parts)).resolve()
    if not target.is_relative_to(root):
        return "artifact resolves outside the evidence root"
    if not target.is_file():
        return "artifact does not exist"
    data = target.read_bytes()
    if not hmac.compare_digest(hashlib.sha256(data).hexdigest(), digest.lower()):
        return "artifact sha256 mismatch"
    try:
        report = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return "artifact is not valid UTF-8 JSON"
    if not isinstance(report, dict) or report.get("suite") != suite:
        return f"artifact does not report suite {suite!r}"
    if report.get("status") != "PASS":
        return f"artifact reports status {report.get('status')!r}, not 'PASS'"
    return None


def evaluate(evidence_path, evidence_root=None):
    evidence_path = Path(evidence_path)
    root = Path(evidence_root) if evidence_root else evidence_path.resolve().parent
    out = {"gate": GATE, "status": "FAIL", "missing_or_failed": list(REQUIRED), "suites": {}, "claim_scope": CLAIM_SCOPE}
    try:
        evidence = _load_json(evidence_path)
    except (OSError, ValueError) as exc:
        out["error"] = f"cannot read evidence file: {exc}"
        return out
    if not isinstance(evidence, dict):
        out["error"] = "evidence file must be a JSON object keyed by suite"
        return out
    if not root.is_dir():
        out["error"] = "evidence root is not a directory"
        return out
    root = root.resolve()
    failed = []
    for suite in REQUIRED:
        reason = "missing" if suite not in evidence else check_suite(suite, evidence[suite], root)
        out["suites"][suite] = {"status": "PASS"} if reason is None else {"status": "FAIL", "reason": reason}
        if reason is not None:
            failed.append(suite)
    out["missing_or_failed"] = failed
    out["status"] = "PASS" if not failed else "FAIL"
    return out


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--evidence", required=True)
    p.add_argument("--evidence-root", help="directory that artifact paths are relative to (default: the evidence file's directory)")
    a = p.parse_args()
    out = evaluate(a.evidence, a.evidence_root)
    print(json.dumps(out, indent=2))
    sys.exit(0 if out["status"] == "PASS" else 2)


if __name__ == "__main__":
    main()
