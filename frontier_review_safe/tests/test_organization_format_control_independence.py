from __future__ import annotations

from datetime import datetime, timedelta, timezone
import unittest

from frontier_review_safe.external_validation import (
    ExternalEvidenceGate,
    IndependentValidationRecord,
    LongitudinalRefreshRecord,
    _independence_organization_key,
    _organization_key,
)


NOW = datetime(2026, 9, 12, 4, 0, tzinfo=timezone.utc)
CANDIDATE_SHA = "d" * 40
CASE_SET_HASH = "a" * 64
FORMAT_CONTROL_ALIASES = (
    "Open\u200dAI",  # ZERO WIDTH JOINER
    "Open\u200cAI",  # ZERO WIDTH NON-JOINER
    "Open\u2060AI",  # WORD JOINER
    "Open\ufeffAI",  # ZERO WIDTH NO-BREAK SPACE
)


class OrganizationFormatControlIndependenceTests(unittest.TestCase):
    def test_format_control_aliases_remain_distinct_for_literal_provider_attribution(self):
        for alias in FORMAT_CONTROL_ALIASES:
            with self.subTest(alias=ascii(alias)):
                self.assertNotEqual(_organization_key("OpenAI"), _organization_key(alias))

    def test_format_control_aliases_collapse_for_independence_checks(self):
        expected = _independence_organization_key("OpenAI")
        for alias in FORMAT_CONTROL_ALIASES:
            with self.subTest(alias=ascii(alias)):
                self.assertEqual(expected, _independence_organization_key(alias))

    def test_format_control_provider_alias_cannot_inflate_independent_provider_floor(self):
        providers = ("OpenAI", "Open\u200dAI", "Other Org")
        independent = {_independence_organization_key(provider) for provider in providers}
        self.assertEqual(len(independent), 2)

    def test_format_control_provider_alias_cannot_masquerade_as_level6_validator(self):
        level5 = {
            "status": "PASS",
            "attestation_verified": True,
            "baseline_registry_verified": True,
            "candidate_sha": CANDIDATE_SHA,
            "case_set_hash": CASE_SET_HASH,
            "provider_orgs": ["OpenAI", "Provider B", "Provider C"],
        }
        record = IndependentValidationRecord(
            validator_org="Open\u200dAI",
            validated_at=NOW.isoformat(),
            candidate_sha=CANDIDATE_SHA,
            case_set_hash=CASE_SET_HASH,
            reproduction_hash="9" * 64,
            passed=True,
            provenance_type="independent_lab_record",
        )
        result = ExternalEvidenceGate.level6(level5, [record])
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("validator_overlaps_level5_provider", result["reasons"])
        self.assertEqual(result["validation_count"], 0)

    def test_format_control_provider_alias_cannot_masquerade_as_level7_executor(self):
        level6 = {
            "status": "PASS",
            "attestation_verified": True,
            "candidate_sha": CANDIDATE_SHA,
            "case_set_hash": CASE_SET_HASH,
            "level5_provider_orgs": ["OpenAI", "Provider B", "Provider C"],
            "latest_validation_at": NOW.isoformat(),
        }
        refreshes = tuple(
            LongitudinalRefreshRecord(
                refresh_id=f"refresh-{i}",
                executed_at=(NOW + timedelta(days=i + 1)).isoformat(),
                candidate_sha=CANDIDATE_SHA,
                case_set_hash=CASE_SET_HASH,
                baseline_registry_hash=("1" if i < 2 else "2") * 64,
                retained_failure_corpus_hash="3" * 64,
                drift_report_hash="4" * 64,
                replacement_governance_hash="5" * 64,
                passed=True,
                provenance_type="independent_lab_record",
                executor_org="Open\u200dAI",
            )
            for i in range(3)
        )
        result = ExternalEvidenceGate.level7(level6, refreshes)
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("longitudinal_refresh_executor_overlaps_level5_provider", result["reasons"])
        self.assertEqual(result["refresh_count"], 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
