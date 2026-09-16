#!/usr/bin/env python3
"""Deterministic, credential-free FA-17 repository security scan."""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[2]
VNEXT = ROOT / "axiom_interface" / "vnext"
SOURCE_COMMIT = "e88f4ecd09343bd04d1196b3379ed8d8c3677c82"


def finding(identifier: str, severity: str, title: str, evidence: dict) -> dict:
    return {"id": identifier, "severity": severity, "status": "OPEN", "title": title, "evidence": evidence}


def executable_projection(text: str) -> str:
    """Remove comments and quoted/template strings before dangerous-sink matching."""
    out: list[str] = []
    state = "code"
    i = 0
    while i < len(text):
        char = text[i]
        nxt = text[i + 1] if i + 1 < len(text) else ""
        if state == "code":
            if char == "/" and nxt == "/":
                state = "line"; out.extend("  "); i += 2; continue
            if char == "/" and nxt == "*":
                state = "block"; out.extend("  "); i += 2; continue
            if char in "'\"`":
                state = {"'": "single", '"': "double", "`": "template"}[char]; out.append(" "); i += 1; continue
            out.append(char); i += 1; continue
        if state == "line":
            if char == "\n": state = "code"; out.append("\n")
            else: out.append(" ")
            i += 1; continue
        if state == "block":
            if char == "*" and nxt == "/": state = "code"; out.extend("  "); i += 2
            else: out.append("\n" if char == "\n" else " "); i += 1
            continue
        if char == "\\":
            out.extend("  "); i += 2; continue
        delimiter = {"single": "'", "double": '"', "template": "`"}[state]
        if char == delimiter: state = "code"
        out.append("\n" if char == "\n" else " "); i += 1
    return "".join(out)


def scan_sast(findings: list[dict]) -> dict:
    patterns = {
        "DYNAMIC_EVAL": re.compile(r"\beval\s*\("),
        "FUNCTION_CONSTRUCTOR": re.compile(r"\bnew\s+Function\s*\("),
        "DOCUMENT_WRITE": re.compile(r"\bdocument\.write\s*\("),
        "HOST_PROCESS": re.compile(r"\b(?:child_process|Deno\.run|Bun\.spawn)\b"),
    }
    high: list[dict] = []
    html_sinks: list[str] = []
    for path in sorted(VNEXT.glob("*.js")) + sorted(VNEXT.glob("*.mjs")):
        text = path.read_text(encoding="utf-8")
        projected = executable_projection(text)
        for name, pattern in patterns.items():
            for match in pattern.finditer(projected):
                high.append({"rule": name, "path": str(path.relative_to(ROOT)), "offset": match.start()})
        if re.search(r"(?:\.innerHTML\s*=|insertAdjacentHTML\s*\()", text):
            html_sinks.append(str(path.relative_to(ROOT)))
    if high:
        findings.append(finding("SAST_DANGEROUS_EXECUTABLE_SINK", "HIGH", "Dangerous executable JavaScript sink found", {"matches": high}))
    if html_sinks:
        findings.append(finding("SAST_DYNAMIC_HTML_REVIEW", "MEDIUM", "Dynamic HTML sinks remain subject to escaping and browser regression tests", {"files": sorted(set(html_sinks)), "count": len(set(html_sinks))}))
    return {"dangerous_executable_matches": len(high), "dynamic_html_files": len(set(html_sinks))}


def scan_secrets(findings: list[dict]) -> dict:
    patterns = {
        "PRIVATE_KEY": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
        "AWS_ACCESS_KEY": re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
        "GITHUB_TOKEN": re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b"),
        "OPENAI_STYLE_KEY": re.compile(r"\bsk-[A-Za-z0-9_-]{32,}\b"),
        "SLACK_TOKEN": re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{20,}\b"),
    }
    matches: list[dict] = []
    paths = list(VNEXT.glob("*.js")) + list(VNEXT.glob("*.mjs")) + list((ROOT / "docs" / "axiom_final_product").glob("FA1[3-7]_*.md")) + list((ROOT / "docs" / "axiom_final_product").glob("FA1[3-7]_*.json"))
    for path in sorted(set(paths)):
        text = path.read_text(encoding="utf-8", errors="ignore")
        for name, pattern in patterns.items():
            if pattern.search(text): matches.append({"rule": name, "path": str(path.relative_to(ROOT))})
    if matches:
        findings.append(finding("COMMITTED_SECRET_MATERIAL", "CRITICAL", "Credential-like material found in the final-app candidate", {"matches": matches}))
    return {"credential_matches": len(matches), "files_scanned": len(set(paths))}


def scan_workflows(findings: list[dict]) -> dict:
    official_mutable: list[dict] = []
    third_party_mutable: list[dict] = []
    total = 0
    action_rx = re.compile(r"uses:\s*([^\s#]+)@([^\s#]+)")
    for path in sorted((ROOT / ".github" / "workflows").glob("*.y*ml")):
        for number, line in enumerate(path.read_text(encoding="utf-8", errors="ignore").splitlines(), 1):
            match = action_rx.search(line)
            if not match: continue
            total += 1
            action, ref = match.groups()
            if re.fullmatch(r"[0-9a-f]{40}", ref): continue
            row = {"path": str(path.relative_to(ROOT)), "line": number, "action": action, "ref": ref}
            (official_mutable if action.startswith("actions/") else third_party_mutable).append(row)
    if third_party_mutable:
        findings.append(finding("UNPINNED_THIRD_PARTY_ACTION", "HIGH", "Third-party workflow action is not pinned to an immutable commit", {"matches": third_party_mutable}))
    if official_mutable:
        findings.append(finding("OFFICIAL_ACTION_MAJOR_TAG_RESIDUAL", "MEDIUM", "Legacy GitHub-owned actions use mutable major tags", {"count": len(official_mutable), "scope": "legacy workflows outside FA-17 remain queued for supply-chain migration"}))

    fa17_text = "\n".join(path.read_text(encoding="utf-8") for path in sorted((ROOT / ".github" / "workflows").glob("axiom-fa17-*.yml")))
    fa17_mutable = [m.group(0) for m in action_rx.finditer(fa17_text) if not re.fullmatch(r"[0-9a-f]{40}", m.group(2))]
    fa17_write = re.findall(r"(?m)^\s*(?:contents|actions|deployments|packages|id-token):\s*write\s*$", fa17_text)
    fa17_deploy = [token for token in ["wrangler deploy", "kubectl apply", "terraform apply", "git push", "gh pr merge"] if token in fa17_text]
    if fa17_mutable or fa17_write or fa17_deploy:
        findings.append(finding("FA17_WORKFLOW_AUTHORITY_OR_PINNING", "HIGH", "FA-17 workflow is mutable or has write/deploy authority", {"mutable": fa17_mutable, "write_permissions": fa17_write, "deploy_commands": fa17_deploy}))
    return {"total_action_references": total, "official_mutable_major_refs": len(official_mutable), "third_party_mutable_refs": len(third_party_mutable), "fa17_mutable_refs": len(fa17_mutable), "fa17_write_permissions": len(fa17_write)}


def scan_network(findings: list[dict]) -> dict:
    fetch_files: list[str] = []
    for path in sorted(VNEXT.glob("*.js")) + sorted(VNEXT.glob("*.mjs")):
        if re.search(r"\bfetch\s*\(", executable_projection(path.read_text(encoding="utf-8"))): fetch_files.append(path.name)
    expected = {"enterprise_sso_gateway_worker.js", "fa16_mobile_pwa_ui.js", "fa16_service_worker.js", "identity_session_adapter.js"}
    unexpected = sorted(set(fetch_files) - expected)
    if unexpected:
        findings.append(finding("UNEXPECTED_NETWORK_CALL_SITE", "HIGH", "Unexpected final-app fetch call site found", {"files": unexpected}))
    if "enterprise_sso_gateway_worker.js" in fetch_files:
        findings.append(finding("ENTERPRISE_IDP_EGRESS_POLICY", "MEDIUM", "Configured Enterprise IdP fetch still requires deployment-level DNS pinning and egress policy evidence", {"path": "axiom_interface/vnext/enterprise_sso_gateway_worker.js"}))
    return {"fetch_files": sorted(fetch_files), "unexpected_fetch_files": unexpected}


def build_report() -> dict:
    findings: list[dict] = []
    metrics = {
        "sast": scan_sast(findings),
        "secrets": scan_secrets(findings),
        "supply_chain": scan_workflows(findings),
        "network": scan_network(findings),
    }
    blocking = [row for row in findings if row["severity"] in {"HIGH", "CRITICAL"} and row["status"] == "OPEN"]
    report = {
        "schema": "musitu.axiom.fa17.repository-scan.v1",
        "source_commit": SOURCE_COMMIT,
        "status": "PASS_NO_OPEN_HIGH_SEVERITY" if not blocking else "BLOCKED_HIGH_SEVERITY",
        "high_or_critical_open": len(blocking),
        "medium_open": sum(row["severity"] == "MEDIUM" and row["status"] == "OPEN" for row in findings),
        "findings": sorted(findings, key=lambda row: (row["severity"], row["id"])),
        "metrics": metrics,
        "scope": "final-app executable surfaces plus repository workflow dependency inventory",
        "production_authority": False,
        "tablet_evidence": "DEFERRED_PENDING_FUTURE_CUSTOMER",
    }
    digest_body = json.dumps(report, sort_keys=True, separators=(",", ":")).encode()
    report["report_sha256_without_digest"] = hashlib.sha256(digest_body).hexdigest()
    return report


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=pathlib.Path)
    args = parser.parse_args()
    report = build_report()
    rendered = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    print(json.dumps({key: report[key] for key in ["status", "high_or_critical_open", "medium_open", "report_sha256_without_digest"]}, sort_keys=True))
    return 0 if report["high_or_critical_open"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
