#!/usr/bin/env python3
"""Synthetic contract tests for the manual accessibility validator.

These tests exercise validator structure only. They are not accessibility
evidence and must never be used to claim a manual accessibility PASS.
"""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile

VALIDATOR = Path(__file__).with_name("validate_manual_accessibility_packet.py").resolve()

KEYBOARD = (
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
SCREEN_READER = (
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
ZOOM = (
    "browser_zoom_200_percent_usable",
    "browser_zoom_400_percent_or_equivalent_reflow_usable",
    "no_blocking_horizontal_two_dimensional_scroll_for_primary_flow",
    "content_and_controls_not_clipped",
)


def base_packet(video_sha: str, video_bytes: int) -> dict:
    video = "repo://evidence/manual-accessibility.mp4"
    return {
        "schema": "musitu.store.phase2.manual_accessibility_certification_packet.v2",
        "created_date_utc": "2026-09-11",
        "status": "PASS_REVIEWED_REAL_ASSISTIVE_TECHNOLOGY_EVIDENCE",
        "scope": "phase2-wcag-2.2-aa-manual-smoke",
        "production_mutation": False,
        "phase2Complete": False,
        "automated_predeploy": {
            "certification_path": "evidence/musitu-store/MUSITU_STORE_PHASE2_REPAIRED_LIVE_HARDENED_CANDIDATE_CERTIFICATION_20260911.json",
            "workflow_run_id": "34582501210",
            "artifact_id": "10192199123",
            "artifact_digest": "sha256:3b1c157fd2a061c26c9b150c5e018aefc109ddd6cea3d8fab3e1e2908717f497",
            "candidate_worker_sha256": "c98e6e36fa153f16a05c627b10b9a562e5f2ffde1f02ec0a7676a8d5121b7cce",
            "baseline_live_worker_sha256": "e17e0c7bde55d9f8d41b476e917159b6bf39b46c3895b7ec6d2a7b4f705beb81",
            "result": "PASS_AUTOMATED",
        },
        "body_equivalence": {
            "record_path": "evidence/musitu-store/MUSITU_STORE_PHASE2_REPAIRED_LIVE_RESPONSE_BODY_EQUIVALENCE_20260911.json",
            "workflow_run_id": "34582501210",
            "artifact_id": "10192199123",
            "artifact_digest": "sha256:3b1c157fd2a061c26c9b150c5e018aefc109ddd6cea3d8fab3e1e2908717f497",
            "result": "PASS",
            "baseline_live_worker_sha256": "e17e0c7bde55d9f8d41b476e917159b6bf39b46c3895b7ec6d2a7b4f705beb81",
            "candidate_worker_sha256": "c98e6e36fa153f16a05c627b10b9a562e5f2ffde1f02ec0a7676a8d5121b7cce",
            "manual_evidence_target": "current repaired live Store 1.0.2 body",
            "applicability_condition": "Synthetic contract fixture bound to the same certified response-body equivalence contract; not real accessibility evidence.",
        },
        "protocol": {
            "path": "docs/MUSITU_STORE_PHASE2_REAL_ACCESSIBILITY_TEST_PROTOCOL_20260911.md",
            "validator": "store/phase2/validate_manual_accessibility_packet.py",
        },
        "rules": {
            "real_screen_reader_required": True,
            "automated_accessibility_tree_is_not_a_substitute": True,
            "manual_keyboard_test_required": True,
            "real_zoom_reflow_test_required": True,
            "screen_reader_live_transcription_visible_required": True,
            "continuous_recording_preferred": True,
            "single_recording_may_cover_multiple_evidence_fields_with_timestamp_fragments": True,
            "evidence_sha256_and_byte_length_required": True,
            "original_evidence_review_required": True,
            "failures_must_be_recorded_without_reinterpretation": True,
            "secrets_and_private_account_credentials_forbidden": True,
            "minimum_required_result": "all required checks PASS with complete integrity metadata and reviewed original evidence",
        },
        "test_environment": {
            "platform": "Windows 11 synthetic validator fixture",
            "os_version": "Windows 11 24H2 synthetic fixture",
            "device_model_class": "synthetic test fixture",
            "browser_name": "Microsoft Edge",
            "browser_version": "999.0 synthetic",
            "screen_reader_name": "Microsoft Narrator",
            "screen_reader_version": "synthetic contract fixture",
            "production_url": "https://payments.mftintelligence.com/store",
            "store_version_under_test": "1.0.2",
            "test_started_at_utc": "2026-09-11T09:00:00Z",
            "test_completed_at_utc": "2026-09-11T09:10:00Z",
        },
        "manual_keyboard_checks": {k: True for k in KEYBOARD},
        "screen_reader_checks": {k: True for k in SCREEN_READER},
        "zoom_reflow_checks": {k: True for k in ZOOM},
        "required_evidence": {
            "continuous_recording_reference": video + "#t=0,600",
            "keyboard_navigation_recording_or_screenshot_reference": video + "#t=60,180",
            "screen_reader_heading_landmark_reference": video + "#t=180,260",
            "screen_reader_install_route_reference": video + "#t=260,340",
            "screen_reader_low_bandwidth_reference": video + "#t=340,420",
            "zoom_reflow_reference": video + "#t=420,560",
            "tester_notes_reference": "packet://tester_notes",
        },
        "evidence_manifest": [{
            "reference": video,
            "sha256": video_sha,
            "bytes": video_bytes,
            "media_type": "video/mp4",
            "captured_at_utc": "2026-09-11T09:09:59Z",
        }],
        "tester_notes": "Synthetic validator-only fixture covering keyboard navigation, Microsoft Narrator output, and browser zoom/reflow. This text is not real accessibility evidence and exists only to attack the validator contract.",
        "review": {
            "reviewer": "synthetic-validator-test",
            "reviewed_at_utc": "2026-09-11T09:11:00Z",
            "original_evidence_reviewed": True,
            "failures_omitted_or_reinterpreted": False,
            "statement": "Synthetic contract test states that real assistive evidence review would include keyboard, Narrator, and zoom evidence; this is not a production certification.",
        },
        "result": "PASS",
        "failure_details": None,
    }


def run_validator(root: Path, packet: dict) -> subprocess.CompletedProcess[str]:
    packet_path = root / "packet.json"
    packet_path.write_text(json.dumps(packet, indent=2) + "\n", encoding="utf-8")
    return subprocess.run(
        [sys.executable, str(VALIDATOR), str(packet_path), str(root)],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )


def expect_reject(root: Path, packet: dict, label: str) -> None:
    result = run_validator(root, packet)
    if result.returncode == 0 or "MANUAL_ACCESSIBILITY_PACKET_INVALID" not in result.stdout:
        raise AssertionError(f"validator failed to reject {label}: rc={result.returncode} output={result.stdout!r}")


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="musitu-p2-validator-") as temp:
        root = Path(temp)
        evidence = root / "evidence"
        evidence.mkdir()
        video_path = evidence / "manual-accessibility.mp4"
        video_path.write_bytes(b"synthetic-validator-only-video-fixture\n")
        raw = video_path.read_bytes()
        packet = base_packet(hashlib.sha256(raw).hexdigest(), len(raw))

        valid = run_validator(root, packet)
        if valid.returncode != 0 or '"result": "PASS"' not in valid.stdout:
            raise AssertionError(f"synthetic complete packet should validate structurally: {valid.stdout}")

        case = copy.deepcopy(packet)
        del case["screen_reader_checks"]["narrator_speech_recap_live_transcription_visible"]
        expect_reject(root, case, "missing Speech Recap key")

        case = copy.deepcopy(packet)
        case["body_equivalence"]["candidate_worker_sha256"] = "0" * 64
        expect_reject(root, case, "wrong candidate binding")

        case = copy.deepcopy(packet)
        case["automated_predeploy"]["artifact_digest"] = "sha256:" + "0" * 64
        expect_reject(root, case, "wrong qualification artifact binding")

        case = copy.deepcopy(packet)
        case["screen_reader_checks"]["no_unrecoverable_focus_loss"] = False
        expect_reject(root, case, "failed manual screen-reader check")

        case = copy.deepcopy(packet)
        case["zoom_reflow_checks"].pop("content_and_controls_not_clipped")
        expect_reject(root, case, "missing zoom/reflow key")

        case = copy.deepcopy(packet)
        case["test_environment"]["screen_reader_name"] = "Other reader"
        expect_reject(root, case, "non-Narrator environment")

        case = copy.deepcopy(packet)
        case["required_evidence"]["continuous_recording_reference"] = "https://example.invalid/video.mp4"
        expect_reject(root, case, "unstable evidence reference scheme")

        case = copy.deepcopy(packet)
        case["review"]["original_evidence_reviewed"] = False
        expect_reject(root, case, "unreviewed original evidence")

        case = copy.deepcopy(packet)
        case["status"] = "PENDING_REAL_ASSISTIVE_TECHNOLOGY_EVIDENCE"
        expect_reject(root, case, "pending packet")

    print("MUSITU_STORE_PHASE2_MANUAL_VALIDATOR_SYNTHETIC_CONTRACT_TESTS=PASS")
    print("SYNTHETIC_FIXTURE_IS_NOT_REAL_ACCESSIBILITY_EVIDENCE=TRUE")


if __name__ == "__main__":
    main()
