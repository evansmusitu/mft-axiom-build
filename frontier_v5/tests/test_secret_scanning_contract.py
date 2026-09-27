#!/usr/bin/env python3
"""Frozen SEC-015 contract for repository/artifact/log secret scanning.

The canaries below are synthetic and assembled at runtime so no credential-shaped
literal is committed to the repository. This contract intentionally predates the
implementation: the first admissible focused run must be RED because the scanner
module is missing, then the identical test must turn GREEN after the minimal
implementation is added.
"""
from __future__ import annotations

import json
import tempfile
from pathlib import Path

try:
    from frontier_v5.runtime.secret_scanning import SecretScanner
except ModuleNotFoundError as exc:
    if exc.name == "frontier_v5.runtime.secret_scanning":
        raise AssertionError("SEC-015 repository secret-scanning behavior is missing") from exc
    raise

ROOT = Path(__file__).resolve().parents[2]


def assert_detects(scanner: SecretScanner, text: str, *, source: str, kind: str) -> str:
    report = scanner.scan_text(text, source=source, kind=kind)
    assert report.clean is False, f"synthetic secret was not rejected for {kind}"
    assert report.findings, f"secret finding missing for {kind}"
    finding = report.findings[0]
    assert finding.source == source
    assert finding.line >= 1
    assert finding.rule_id
    assert len(finding.fingerprint) == 64
    assert finding.redacted and text.strip() not in finding.redacted
    serialized = json.dumps(report.to_dict(), sort_keys=True)
    assert text.strip() not in serialized, "raw secret leaked into serialized scan evidence"
    return finding.fingerprint


def main() -> None:
    scanner = SecretScanner()

    clean = """service_name = 'musitu-axiom'\napi_key = os.environ['AXIOM_API_KEY']\nsecret_ref = '${{ secrets.AXIOM_TEST_SECRET }}'\nsha256 = '0123456789abcdef' * 4\n"""
    clean_report = scanner.scan_text(clean, source="clean.py", kind="source")
    assert clean_report.clean is True
    assert clean_report.findings == ()

    # Build credential-shaped canaries only at runtime. These values are not real
    # credentials and are never used outside this deterministic contract.
    assignment_secret = "ms_test_" + "A7zQ9pLm2NwX4cVr6Ty8BkDh1Fs3Ju5E"
    assignment_line = "api_key = \"" + assignment_secret + "\"\n"
    private_key = "-----BEGIN " + "PRIVATE KEY-----\n" + ("SYNTHETIC" * 8) + "\n-----END " + "PRIVATE KEY-----\n"

    assignment_fp = assert_detects(
        scanner,
        assignment_line,
        source="config.py",
        kind="source",
    )
    assert_detects(scanner, private_key, source="bundle.txt", kind="artifact")
    assert_detects(scanner, "auth token=" + assignment_secret, source="worker.log", kind="log")

    # Suppressions are exact secret fingerprints with a non-trivial justification.
    # Broad/wildcard suppressions must fail closed.
    try:
        SecretScanner(suppressions={"*": "never permit global suppression"})
    except ValueError:
        pass
    else:
        raise AssertionError("SEC-015 accepted a wildcard secret-scan suppression")

    try:
        SecretScanner(suppressions={assignment_fp: "x"})
    except ValueError:
        pass
    else:
        raise AssertionError("SEC-015 accepted an unjustified suppression")

    suppressed = SecretScanner(
        suppressions={assignment_fp: "synthetic fixture approved only for this exact fingerprint"}
    )
    suppressed_report = suppressed.scan_text(assignment_line, source="fixture.py", kind="source")
    assert suppressed_report.clean is True
    assert suppressed_report.findings == ()
    assert suppressed_report.suppressed_count == 1

    # Tree scans must work on ordinary tracked-text inputs, detect a canary in a
    # nested file, and never require access to any connected/production secret.
    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        (root / "nested").mkdir()
        (root / "clean.txt").write_text("public documentation only\n", encoding="utf-8")
        tree_clean = scanner.scan_tree(root)
        assert tree_clean.clean is True

        (root / "nested" / "leak.env").write_text(
            "SERVICE_PASSWORD='" + assignment_secret + "'\n", encoding="utf-8"
        )
        tree_bad = scanner.scan_tree(root)
        assert tree_bad.clean is False
        assert any(f.source.endswith("nested/leak.env") for f in tree_bad.findings)

    # The checked-in branch itself must be clean under the same deterministic
    # scanner. This is source-only evidence; it is not production credential proof.
    repository_report = scanner.scan_tree(ROOT)
    if not repository_report.clean:
        summary = [(f.rule_id, f.source, f.line, f.redacted) for f in repository_report.findings[:10]]
        raise AssertionError(f"repository secret scan failed: {summary}")

    print("MUSITU_AXIOM_FRONTIER_SECRET_SCANNING_PASS")


if __name__ == "__main__":
    main()
