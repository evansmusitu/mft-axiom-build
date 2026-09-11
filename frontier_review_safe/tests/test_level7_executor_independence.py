from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta, timezone
import unittest

from frontier_review_safe.external_attestation import ExternalAttestationService
from frontier_review_safe.external_validation import ExternalEvidenceGate, LongitudinalRefreshRecord


NOW = datetime(2026, 9, 11, 14, 20, tzinfo=timezone.utc)
CANDIDATE_SHA = "d" * 40
CASE_SET_HASH = "a" * 64
SECRET = b"x" * 32
KEY_ID = "executor-independence-key"
ISSUER = "Independent Longitudinal Evaluator"
SECRETS = {KEY_ID: SECRET}
TRUST = {ISSUER: frozenset({KEY_ID})}


def level6(provider_orgs=("OpenAI", "Anthropic", "Google")):
    return {
        "status": "PASS",
        "attestation_verified": True,
        "candidate_sha": CANDIDATE_SHA,
        "case_set_hash": CASE_SET_HASH,
        "level5_provider_orgs": list(provider_orgs),
        "latest_validation_at": NOW.isoformat(),
    }


def refresh(refresh_id: str, day: int, baseline_hash: str, executor_org: str | None):
    return LongitudinalRefreshRecord(
        refresh_id=refresh_id,
        executed_at=(NOW + timedelta(days=day)).isoformat(),
        candidate_sha=CANDIDATE_SHA,
        case_set_hash=CASE_SET_HASH,
        baseline_registry_hash=baseline_hash,
        retained_failure_corpus_hash="1" * 64,
        drift_report_hash="2" * 64,
        replacement_governance_hash="3" * 64,
        passed=True,
        provenance_type="independent_lab_record",
        executor_org=executor_org,
    )


def attest(record: LongitudinalRefreshRecord):
    return ExternalAttestationService.issue(
        subject_type="longitudinal_refresh",
        subject_id=record.refresh_id,
        subject_hash=record.fingerprint,
        issuer_org=ISSUER,
        verifier_key_id=KEY_ID,
        provenance_type=record.provenance_type,
        issued_at=record.executed_at,
        verifier_secret=SECRET,
    )


def evaluate(records, *, provider_orgs=("OpenAI", "Anthropic", "Google")):
    return ExternalEvidenceGate.level7(
        level6(provider_orgs),
        records,
        receipts=[attest(record) for record in records],
        verifier_secrets=SECRETS,
        trusted_issuers=TRUST,
    )


class Level7ExecutorIndependenceTests(unittest.TestCase):
    def test_missing_executor_identity_cannot_count_as_independent_refresh(self):
        records = [
            refresh("r1", 0, "4" * 64, None),
            refresh("r2", 30, "5" * 64, None),
            refresh("r3", 60, "4" * 64, None),
        ]
        result = evaluate(records)
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("longitudinal_refresh_executor_identity_invalid", result["reasons"])
        self.assertIn("insufficient_attested_longitudinal_refreshes", result["reasons"])
        self.assertEqual(result["refresh_count"], 0)

    def test_level5_provider_cannot_execute_refresh_even_with_independent_attester(self):
        records = [
            refresh("r1", 0, "4" * 64, "OpenAI"),
            refresh("r2", 30, "5" * 64, "OpenAI"),
            refresh("r3", 60, "4" * 64, "OpenAI"),
        ]
        result = evaluate(records)
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("longitudinal_refresh_executor_overlaps_level5_provider", result["reasons"])
        self.assertEqual(result["refresh_count"], 0)

    def test_casefold_alias_cannot_masquerade_as_independent_executor(self):
        records = [
            refresh("r1", 0, "4" * 64, "Straße Labs"),
            refresh("r2", 30, "5" * 64, "Straße Labs"),
            refresh("r3", 60, "4" * 64, "Straße Labs"),
        ]
        result = evaluate(records, provider_orgs=("STRASSE LABS", "Other B", "Other C"))
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("longitudinal_refresh_executor_overlaps_level5_provider", result["reasons"])

    def test_whitespace_alias_cannot_masquerade_as_independent_executor(self):
        records = [
            refresh("r1", 0, "4" * 64, "Open\tAI"),
            refresh("r2", 30, "5" * 64, "Open\tAI"),
            refresh("r3", 60, "4" * 64, "Open\tAI"),
        ]
        result = evaluate(records, provider_orgs=("Open AI", "Other B", "Other C"))
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("longitudinal_refresh_executor_overlaps_level5_provider", result["reasons"])

    def test_executor_identity_is_cryptographically_bound_into_refresh_fingerprint(self):
        record = refresh("r1", 0, "4" * 64, "Independent Lab A")
        changed = replace(record, executor_org="Independent Lab B")
        self.assertNotEqual(record.fingerprint, changed.fingerprint)

    def test_independent_executor_and_independent_attester_pass_mechanics(self):
        records = [
            refresh("r1", 0, "4" * 64, "Independent Longitudinal Lab"),
            refresh("r2", 30, "5" * 64, "Independent Longitudinal Lab"),
            refresh("r3", 60, "4" * 64, "Independent Longitudinal Lab"),
        ]
        result = evaluate(records)
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["refresh_count"], 3)
        self.assertEqual(result["refresh_executor_orgs"], ["independent longitudinal lab"])

    def test_provider_executed_extra_does_not_poison_complete_independent_set(self):
        good = [
            refresh("r1", 0, "4" * 64, "Independent Longitudinal Lab"),
            refresh("r2", 30, "5" * 64, "Independent Longitudinal Lab"),
            refresh("r3", 60, "4" * 64, "Independent Longitudinal Lab"),
        ]
        extra = refresh("provider-extra", 90, "5" * 64, "OpenAI")
        result = evaluate([*good, extra])
        self.assertEqual(result["status"], "PASS")
        self.assertNotIn("longitudinal_refresh_executor_overlaps_level5_provider", result["reasons"])
        self.assertEqual(result["refresh_count"], 3)


if __name__ == "__main__":
    unittest.main(verbosity=2)
