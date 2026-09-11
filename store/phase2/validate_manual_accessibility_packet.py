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
EXPECTED_PRODUCTION_URL = "https://payments.mftintelligence.com/store"
EXPECTED_STORE_VERSION = "1.0.2"
EXPECTED_CANDIDATE_CERT = "evidence/musitu-store/MUSITU_STORE_PHASE2_REPAIRED_LIVE_HARDENED_CANDIDATE_CERTIFICATION_20260911.json"
EXPECTED_EQUIVALENCE_RECORD = "evidence/musitu-store/MUSITU_STORE_PHASE2_REPAIRED_LIVE_RESPONSE_BODY_EQUIVALENCE_20260911.json"
EXPECTED_PROTOCOL = "docs/MUSITU_STORE_PHASE2_REAL_ACCESSIBILITY_TEST_PROTOCOL_20260911.md"
EXPECTED_VALIDATOR = "store/phase2/validate_manual_accessibility_packet.py"
EXPECTED_WORKFLOW_RUN = "34582501210"
EXPECTED_ARTIFACT_ID = "10192199123"
EXPECTED_ARTIFACT_DIGEST = "sha256:3b1c157fd2a061c26c9b150c5e018aefc109ddd6cea3d8fab3e1e2908717f497"
EXPECTED_BASELINE_SHA = "e17e0c7bde55d9f8d41b476e917159b6bf39b46c3895b7ec6d2a7b4f705beb81"
EXPECTED_CANDIDATE_SHA = "c98e6e36fa153f16a05c627b10b9a562e5f2ffde1f02ec0a7676a8d5121b7cce"
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
DRIVE_REF_RE = re.compile(r"^drive://[A-Za-z0-9_-]+(?:#.+)?$")
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
REQUIRED_KEYBOARD_CHECKS = (
    "first_tab_reaches_skip_link",
    "skip_link_moves_focus_to_main",
    "all_interactive_controls_reachable",
    "logical_focus_order",
    "visible_focus_indicator",
    "no_keyboard_trap",
    "install_route_operable_without_pointer",
    "app_details_route_operable_without_pointer",
    "status_and_developer_routes_operable_without_pointer",
    "low_bandwidth_route_operable_without_pointer",
)
REQUIRED_SCREEN_READER_CHECKS = (
    "narrator_speech_recap_live_transcription_visible",
    "page_title_announced_meaningfully",
    "language_announced_or_interpreted_correctly",
    "main_landmark_discoverable",
    "navigation_landmarks_discoverable",
    "heading_structure_navigable",
    "link_and_button_names_meaningful",
    "install_call_to_action_name_clear",
    "chemistry_product_name_and_version_understandable",
    "verified_publisher_information_understandable",
    "distribution_vs_entitlement_boundary_understandable",
    "status_information_not_color_only",
    "offline_and_recovery_information_understandable",
    "low_bandwidth_mode_understandable",
    "no_blocking_unlabeled_control",
    "no_unrecoverable_focus_loss",
)
REQUIRED_ZOOM_REFLOW_CHECKS = (
    "browser_zoom_200_percent_usable",
    "browser_zoom_400_percent_or_equivalent_reflow_usable",
    "no_blocking_horizontal_two_dimensional_scroll_for_primary_flow",
    "content_and_controls_not_clipped",
)
REQUIRED_CHECK_GROUPS = {
    "manual_keyboard_checks": REQUIRED_KEYBOARD_CHECKS,
    "screen_reader_checks": REQUIRED_SCREEN_READER_CHECKS,
    "zoom_reflow_checks": REQUIRED_ZOOM_REFLOW_CHECKS,
}
REQUIRED_EVIDENCE_KEYS = (
    "continuous_recording_reference",
    "keyboard_navigation_recording_or_screenshot_reference",
    "screen_reader_heading_landmark_reference",
    "screen_reader_install_route_reference",
    "screen_reader_low_bandwidth_reference",
    "zoom_reflow_reference",
    "tester_notes_reference",
)
REQUIRED_TRUE_RULES = (
    "real_screen_reader_required",
    "automated_accessibility_tree_is_not_a_substitute",
    "manual_keyboard_test_required",
    "real_zoom_reflow_test_required",
    "screen_reader_live_transcription_visible_required",
    "evidence_sha256_and_byte_length_required",
    "original_evidence_review_required",
    "failures_must_be_recorded_without_reinterpretation",
    "secrets_and_private_account_credentials_forbidden",
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


def parse_utc(value: str, name: str) -> datetime:
    value = nonempty(value, name)
    try:
        if value.endswith("Z"):
            dt = datetime.fromisoformat(value[:-1] + "+00:00")
        else:
            dt = datetime.fromisoformat(value)
            if dt.tzinfo is None:
                fail(f"{name} must include timezone or Z")
    except ValueError as exc:
        fail(f"invalid ISO-8601 timestamp for {name}: {exc}")
    if dt.utcoffset() is None:
        fail(f"{name} must be timezone-aware")
    return dt


def require_exact(value, expected, name: str) -> None:
    if value != expected:
        fail(f"{name} must equal {expected!r}")


def validate_reference(reference: str, name: str, allow_packet_notes: bool = False) -> str:
    reference = nonempty(reference, name)
    if allow_packet_notes and reference == "packet://tester_notes":
        return reference
    if reference.startswith("repo://"):
        rel = reference[len("repo://"):].split("#", 1)[0]
        if not rel or rel.startswith("/") or ".." in pathlib.PurePosixPath(rel).parts:
            fail(f"invalid repo evidence reference in {name}: {reference}")
        return reference
    if DRIVE_REF_RE.fullmatch(reference):
        return reference
    fail(f"{name} must use drive://<file-id> or repo://<relative-path> stable reference")


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


def validate_binding(d: dict) -> None:
    automated = d.get("automated_predeploy") or {}
    require_exact(automated.get("certification_path"), EXPECTED_CANDIDATE_CERT, "automated_predeploy.certification_path")
    require_exact(automated.get("workflow_run_id"), EXPECTED_WORKFLOW_RUN, "automated_predeploy.workflow_run_id")
    require_exact(automated.get("artifact_id"), EXPECTED_ARTIFACT_ID, "automated_predeploy.artifact_id")
    require_exact(automated.get("artifact_digest"), EXPECTED_ARTIFACT_DIGEST, "automated_predeploy.artifact_digest")
    require_exact(automated.get("baseline_live_worker_sha256"), EXPECTED_BASELINE_SHA, "automated_predeploy.baseline_live_worker_sha256")
    require_exact(automated.get("candidate_worker_sha256"), EXPECTED_CANDIDATE_SHA, "automated_predeploy.candidate_worker_sha256")
    require_exact(automated.get("result"), "PASS_AUTOMATED", "automated_predeploy.result")

    equivalence = d.get("body_equivalence") or {}
    require_exact(equivalence.get("record_path"), EXPECTED_EQUIVALENCE_RECORD, "body_equivalence.record_path")
    require_exact(equivalence.get("workflow_run_id"), EXPECTED_WORKFLOW_RUN, "body_equivalence.workflow_run_id")
    require_exact(equivalence.get("artifact_id"), EXPECTED_ARTIFACT_ID, "body_equivalence.artifact_id")
    require_exact(equivalence.get("artifact_digest"), EXPECTED_ARTIFACT_DIGEST, "body_equivalence.artifact_digest")
    require_exact(equivalence.get("baseline_live_worker_sha256"), EXPECTED_BASELINE_SHA, "body_equivalence.baseline_live_worker_sha256")
    require_exact(equivalence.get("candidate_worker_sha256"), EXPECTED_CANDIDATE_SHA, "body_equivalence.candidate_worker_sha256")
    require_exact(equivalence.get("result"), "PASS", "body_equivalence.result")
    nonempty(equivalence.get("manual_evidence_target"), "body_equivalence.manual_evidence_target")
    nonempty(equivalence.get("applicability_condition"), "body_equivalence.applicability_condition")

    protocol = d.get("protocol") or {}
    require_exact(protocol.get("path"), EXPECTED_PROTOCOL, "protocol.path")
    require_exact(protocol.get("validator"), EXPECTED_VALIDATOR, "protocol.validator")

    rules = d.get("rules") or {}
    for key in REQUIRED_TRUE_RULES:
        if rules.get(key) is not True:
            fail(f"rules.{key} must be true")


def main() -> None:
    if not PACKET.is_file():
        fail(f"packet not found: {PACKET}")
    try:
        d = json.loads(PACKET.read_text(encoding="utf-8"))
    except Exception as exc:
        fail(f"packet JSON unreadable: {exc}")

    require_exact(d.get("schema"), EXPECTED_SCHEMA, "schema")
    require_exact(d.get("status"), EXPECTED_STATUS, "status")
    require_exact(d.get("result"), EXPECTED_RESULT, "result")
    if d.get("phase2Complete") is not False:
        fail("phase2Complete must remain false until deployment/rollback proof passes")
    if d.get("production_mutation") is not False:
        fail("manual packet must not claim production mutation")

    validate_binding(d)

    env = d.get("test_environment") or {}
    for key in REQUIRED_ENV:
        nonempty(env.get(key), f"test_environment.{key}")
    require_exact(env.get("production_url"), EXPECTED_PRODUCTION_URL, "test_environment.production_url")
    require_exact(env.get("store_version_under_test"), EXPECTED_STORE_VERSION, "test_environment.store_version_under_test")
    if "windows" not in str(env.get("platform", "")).lower():
        fail("test_environment.platform must identify a real Windows environment")
    if "narrator" not in str(env.get("screen_reader_name", "")).lower():
        fail("test_environment.screen_reader_name must identify Microsoft Narrator for this protocol")
    started = parse_utc(env.get("test_started_at_utc"), "test_environment.test_started_at_utc")
    completed = parse_utc(env.get("test_completed_at_utc"), "test_environment.test_completed_at_utc")
    if completed < started:
        fail("test completion time precedes test start time")

    for group, expected_keys in REQUIRED_CHECK_GROUPS.items():
        checks = d.get(group)
        if not isinstance(checks, dict):
            fail(f"{group} missing or not an object")
        if set(checks) != set(expected_keys):
            missing = sorted(set(expected_keys) - set(checks))
            extra = sorted(set(checks) - set(expected_keys))
            fail(f"{group} key-set mismatch; missing={missing}, extra={extra}")
        failed = [key for key in expected_keys if checks.get(key) is not True]
        if failed:
            fail(f"{group} not all true: {failed}")

    refs = d.get("required_evidence") or {}
    if not isinstance(refs, dict) or set(refs) != set(REQUIRED_EVIDENCE_KEYS):
        missing = sorted(set(REQUIRED_EVIDENCE_KEYS) - set(refs if isinstance(refs, dict) else ()))
        extra = sorted(set(refs if isinstance(refs, dict) else ()) - set(REQUIRED_EVIDENCE_KEYS))
        fail(f"required_evidence key-set mismatch; missing={missing}, extra={extra}")
    for key in REQUIRED_EVIDENCE_KEYS:
        validate_reference(refs.get(key), f"required_evidence.{key}", allow_packet_notes=(key == "tester_notes_reference"))

    manifest = d.get("evidence_manifest")
    if not isinstance(manifest, list) or not manifest:
        fail("evidence_manifest must be a non-empty list")

    manifest_refs: dict[str, dict] = {}
    for idx, item in enumerate(manifest):
        if not isinstance(item, dict):
            fail(f"evidence_manifest[{idx}] must be object")
        ref = validate_reference(item.get("reference"), f"evidence_manifest[{idx}].reference")
        sha = nonempty(item.get("sha256"), f"evidence_manifest[{idx}].sha256").lower()
        if not SHA256_RE.fullmatch(sha):
            fail(f"evidence_manifest[{idx}].sha256 must be 64 lowercase hex")
        size = item.get("bytes")
        if not isinstance(size, int) or size <= 0:
            fail(f"evidence_manifest[{idx}].bytes must be positive integer")
        media_type = nonempty(item.get("media_type"), f"evidence_manifest[{idx}].media_type").lower()
        captured = parse_utc(item.get("captured_at_utc"), f"evidence_manifest[{idx}].captured_at_utc")
        if captured > completed:
            fail(f"evidence_manifest[{idx}].captured_at_utc is after test completion")
        verify_repo_reference(ref, sha, size)
        base = ref.split("#", 1)[0]
        if base in manifest_refs:
            fail(f"duplicate evidence_manifest base reference: {base}")
        manifest_refs[base] = {"media_type": media_type, "sha256": sha, "bytes": size}

    for key in REQUIRED_EVIDENCE_KEYS:
        if key == "tester_notes_reference" and refs[key] == "packet://tester_notes":
            continue
        base = refs[key].split("#", 1)[0]
        if base not in manifest_refs:
            fail(f"required evidence {key} is not covered by evidence_manifest: {refs[key]}")

    continuous_base = refs["continuous_recording_reference"].split("#", 1)[0]
    if not manifest_refs[continuous_base]["media_type"].startswith("video/"):
        fail("continuous_recording_reference must resolve to a video/* evidence object")

    notes = nonempty(d.get("tester_notes"), "tester_notes")
    if len(notes) < 80:
        fail("tester_notes must contain enough context to be independently reviewable")
    lower_notes = notes.lower()
    for token in ("keyboard", "narrator", "zoom"):
        if token not in lower_notes:
            fail(f"tester_notes must explicitly cover {token}")

    review = d.get("review") or {}
    nonempty(review.get("reviewer"), "review.reviewer")
    reviewed = parse_utc(review.get("reviewed_at_utc"), "review.reviewed_at_utc")
    if reviewed < completed:
        fail("review.reviewed_at_utc precedes test completion")
    if review.get("original_evidence_reviewed") is not True:
        fail("review.original_evidence_reviewed must be true")
    if review.get("failures_omitted_or_reinterpreted") is not False:
        fail("review.failures_omitted_or_reinterpreted must be false")
    statement = nonempty(review.get("statement"), "review.statement")
    statement_lower = statement.lower()
    for token in ("real", "assistive", "keyboard", "narrator", "zoom"):
        if token not in statement_lower:
            fail(f"review.statement must explicitly attest {token} evidence review")

    if d.get("failure_details") not in (None, ""):
        fail("failure_details must be empty for PASS packet")

    print(json.dumps({
        "schema": "musitu.store.phase2.manual_accessibility_validation.v2",
        "result": "PASS",
        "packet": str(PACKET),
        "baseline_worker_sha256": EXPECTED_BASELINE_SHA,
        "candidate_worker_sha256": EXPECTED_CANDIDATE_SHA,
        "screen_reader": env.get("screen_reader_name"),
        "browser": env.get("browser_name"),
        "evidence_objects": len(manifest),
        "complete_required_check_keysets": True,
        "all_manual_checks_true": True,
        "reviewed_real_assistive_technology_evidence": True,
    }, indent=2))


if __name__ == "__main__":
    main()
