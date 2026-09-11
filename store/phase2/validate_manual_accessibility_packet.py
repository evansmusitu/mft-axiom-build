#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import pathlib
import re
import sys
from datetime import datetime

PACKET = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "evidence/musitu-store/MUSITU_STORE_PHASE2_MANUAL_ACCESSIBILITY_CERTIFICATION_PACKET_20260911.json")
ROOT = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else ".").resolve()

EXPECTED_SCHEMA = "musitu.store.phase2.manual_accessibility_certification_packet.v2"
EXPECTED_STATUS = "PASS_REVIEWED_REAL_ASSISTIVE_TECHNOLOGY_EVIDENCE"
EXPECTED_RESULT = "PASS"
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
PLACEHOLDER_RE = re.compile(r"(^|[\s:/#_-])(todo|tbd|pending|placeholder|example|replace|unknown|null)([\s:/#_.-]|$)", re.I)

REQUIRED_ENV = (
    "platform",
    "os_version",
    "device_model_class",
    "browser_name",
    "browser_version",
    "screen_reader_name",
    "screen_reader_version",
    "production_url",
    "store_version_under_test",
)
REQUIRED_CHECK_GROUPS = (
    "manual_keyboard_checks",
    "screen_reader_checks",
    "zoom_reflow_checks",
)
REQUIRED_EVIDENCE_KEYS = (
    "continuous_recording_reference",
    "keyboard_navigation_recording_or_screenshot_reference",
    "screen_reader_heading_landmark_reference",
    "screen_reader_install_route_reference",
    "screen_reader_low_bandwidth_reference",
    "zoom_reflow_reference",
    "tester_notes_reference",
)


def fail(message: str) -> None:
    raise SystemExit("MANUAL_ACCESSIBILITY_PACKET_INVALID: " + message)


def nonempty(value, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        fail(f"missing/non-string {name}")
    value = value.strip()
    if PLACEHOLDER_RE.search(value):
        fail(f"placeholder-like value in {name}: {value!r}")
    return value


def parse_utc(value: str, name: str) -> None:
    value = nonempty(value, name)
    try:
        if value.endswith("Z"):
            datetime.fromisoformat(value[:-1] + "+00:00")
        else:
            dt = datetime.fromisoformat(value)
            if dt.tzinfo is None:
                fail(f"{name} must include timezone or Z")
    except ValueError as exc:
        fail(f"invalid ISO-8601 timestamp for {name}: {exc}")


def verify_repo_reference(reference: str, expected_sha: str, expected_bytes: int) -> None:
    if not reference.startswith("repo://"):
        return
    rel = reference[len("repo://"):].split("#", 1)[0]
    path = (ROOT / rel).resolve()
    try:
        path.relative_to(ROOT)
    except ValueError:
        fail(f"repo reference escapes repository root: {reference}")
    if not path.is_file():
        fail(f"repo evidence file missing: {reference}")
    raw = path.read_bytes()
    if len(raw) != expected_bytes:
        fail(f"repo evidence byte mismatch for {reference}: {len(raw)} != {expected_bytes}")
    digest = hashlib.sha256(raw).hexdigest()
    if digest != expected_sha:
        fail(f"repo evidence hash mismatch for {reference}: {digest} != {expected_sha}")


def main() -> None:
    if not PACKET.is_file():
        fail(f"packet not found: {PACKET}")
    try:
        d = json.loads(PACKET.read_text(encoding="utf-8"))
    except Exception as exc:
        fail(f"packet JSON unreadable: {exc}")

    if d.get("schema") != EXPECTED_SCHEMA:
        fail(f"schema must be {EXPECTED_SCHEMA!r}")
    if d.get("status") != EXPECTED_STATUS:
        fail(f"status must be {EXPECTED_STATUS!r}")
    if d.get("result") != EXPECTED_RESULT:
        fail(f"result must be {EXPECTED_RESULT!r}")
    if d.get("phase2Complete") is not False:
        fail("phase2Complete must remain false until deployment/rollback proof passes")
    if d.get("production_mutation") is not False:
        fail("manual packet must not claim production mutation")

    equivalence = d.get("body_equivalence") or {}
    if equivalence.get("result") != "PASS":
        fail("body_equivalence.result must be PASS")
    nonempty(equivalence.get("workflow_run_id"), "body_equivalence.workflow_run_id")
    nonempty(equivalence.get("artifact_id"), "body_equivalence.artifact_id")
    digest = nonempty(equivalence.get("artifact_digest"), "body_equivalence.artifact_digest")
    if not digest.startswith("sha256:") or not SHA256_RE.fullmatch(digest.split(":", 1)[1]):
        fail("body_equivalence.artifact_digest must be sha256:<64 lowercase hex>")

    env = d.get("test_environment") or {}
    for key in REQUIRED_ENV:
        nonempty(env.get(key), f"test_environment.{key}")
    if env.get("production_url") != "https://payments.mftintelligence.com/store":
        fail("production_url must be exact Store production URL")
    if env.get("store_version_under_test") != "1.0.2":
        fail("store_version_under_test must be 1.0.2")
    parse_utc(env.get("test_started_at_utc"), "test_environment.test_started_at_utc")
    parse_utc(env.get("test_completed_at_utc"), "test_environment.test_completed_at_utc")

    for group in REQUIRED_CHECK_GROUPS:
        checks = d.get(group)
        if not isinstance(checks, dict) or not checks:
            fail(f"{group} missing or empty")
        failed = [key for key, value in checks.items() if value is not True]
        if failed:
            fail(f"{group} not all true: {failed}")

    refs = d.get("required_evidence") or {}
    for key in REQUIRED_EVIDENCE_KEYS:
        nonempty(refs.get(key), f"required_evidence.{key}")

    manifest = d.get("evidence_manifest")
    if not isinstance(manifest, list) or not manifest:
        fail("evidence_manifest must be a non-empty list")

    manifest_refs = set()
    for idx, item in enumerate(manifest):
        if not isinstance(item, dict):
            fail(f"evidence_manifest[{idx}] must be object")
        ref = nonempty(item.get("reference"), f"evidence_manifest[{idx}].reference")
        sha256 = nonempty(item.get("sha256"), f"evidence_manifest[{idx}].sha256").lower()
        if not SHA256_RE.fullmatch(sha256):
            fail(f"evidence_manifest[{idx}].sha256 must be 64 lowercase hex")
        size = item.get("bytes")
        if not isinstance(size, int) or size <= 0:
            fail(f"evidence_manifest[{idx}].bytes must be positive integer")
        nonempty(item.get("media_type"), f"evidence_manifest[{idx}].media_type")
        parse_utc(item.get("captured_at_utc"), f"evidence_manifest[{idx}].captured_at_utc")
        verify_repo_reference(ref, sha256, size)
        manifest_refs.add(ref.split("#", 1)[0])

    for key in REQUIRED_EVIDENCE_KEYS:
        base = refs[key].split("#", 1)[0]
        if base not in manifest_refs and refs[key] != "packet://tester_notes":
            fail(f"required evidence {key} is not covered by evidence_manifest: {refs[key]}")

    notes = nonempty(d.get("tester_notes"), "tester_notes")
    if len(notes) < 40:
        fail("tester_notes must contain enough context to be reviewable")

    review = d.get("review") or {}
    nonempty(review.get("reviewer"), "review.reviewer")
    parse_utc(review.get("reviewed_at_utc"), "review.reviewed_at_utc")
    if review.get("original_evidence_reviewed") is not True:
        fail("review.original_evidence_reviewed must be true")
    if review.get("failures_omitted_or_reinterpreted") is not False:
        fail("review.failures_omitted_or_reinterpreted must be false")
    statement = nonempty(review.get("statement"), "review.statement")
    if "real" not in statement.lower() or "assistive" not in statement.lower():
        fail("review.statement must explicitly attest review of real assistive-technology evidence")

    if d.get("failure_details") not in (None, ""):
        fail("failure_details must be empty for PASS packet")

    print(json.dumps({
        "schema": "musitu.store.phase2.manual_accessibility_validation.v1",
        "result": "PASS",
        "packet": str(PACKET),
        "screen_reader": env.get("screen_reader_name"),
        "browser": env.get("browser_name"),
        "evidence_objects": len(manifest),
        "all_manual_checks_true": True,
        "reviewed_real_assistive_technology_evidence": True,
    }, indent=2))


if __name__ == "__main__":
    main()
