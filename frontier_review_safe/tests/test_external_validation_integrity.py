from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone
import math
import unittest

from frontier_review_safe.external_attestation import ExternalAttestationService
from frontier_review_safe.external_validation import (
    ClaimBoundary,
    ComparativeOutcome,
    ExternalEvidenceGate,
    ExternalRunRecord,
    IndependentValidationRecord,
    LongitudinalRefreshRecord,
)


NOW = datetime(2026, 9, 11, 8, 40, tzinfo=timezone.utc).isoformat()
H = "a" * 64
CANDIDATE_SHA = "d" * 40
SECRET = b"v" * 32
SECRETS = {"validator-key": SECRET}
TRUST = {"Independent Validator": frozenset({"validator-key"})}


def attest(refresh: LongitudinalRefreshRecord):
    return ExternalAttestationService.issue(
        subject_type="longitudinal_refresh",
        subject_id=refresh.refresh_id,
        subject_hash=refresh.fingerprint,
        issuer_org="Independent Validator",
        verifier_key_id="validator-key",
        provenance_type="independent_lab_record",
        issued_at=NOW,
        verifier_secret=SECRET,
    )


def level6_identity() -> dict[str, object]:
    return {
        "status": "PASS",
        "attestation_verified": True,
        "candidate_sha": CANDIDATE_SHA,
        "case_set_hash": H,
    }


def refresh(refresh_id: str, baseline_hash: str, *, candidate_sha: str = CANDIDATE_SHA, case_set_hash: str = H) -> LongitudinalRefreshRecord:
    return LongitudinalRefreshRecord(
        refresh_id,
        NOW,
        candidate_sha,
        case_set_hash,
        baseline_hash,
        "2" * 64,
        "3" * 64,
        "4" * 64,
        True,
        executor_org="Independent Longitudinal Lab",
    )


class ExternalValidationIntegrityTests(unittest.TestCase):
    def valid_run(self) -> ExternalRunRecord:
        return ExternalRunRecord(
            run_id="run-1",
            provider_org="Provider",
            product="Product",
            exact_version="v1",
            executed_at=NOW,
            access_mode="api",
            case_set_hash="1" * 64,
            constraint_hash="2" * 64,
            permissions_hash="3" * 64,
            result_hash="4" * 64,
            raw_evidence_hash="5" * 64,
            provenance_type="provider_api_receipt",
            authenticated=True,
            candidate_sha=CANDIDATE_SHA,
            candidate_environment_hash="6" * 64,
            metrics={"score": 0.9},
            configuration_hash="7" * 64,
            account_scope_hash="8" * 64,
            baseline_registry_hash="9" * 64,
            baseline_registration_id="reg-1",
            baseline_registration_hash="a" * 64,
        )

    def test_external_run_rejects_nonhex_hashes_nonfinite_metrics_and_inexact_candidate(self):
        run = self.valid_run()
        with self.assertRaises(ValueError):
            replace(run, result_hash="z" * 64)
        with self.assertRaises(ValueError):
            replace(run, baseline_registry_hash="q" * 64)
        with self.assertRaises(ValueError):
            replace(run, metrics={"score": math.inf})
        with self.assertRaises(ValueError):
            replace(run, candidate_sha="candidate")
        with self.assertRaises(ValueError):
            replace(run, authenticated="yes")

    def test_comparative_outcome_rejects_malformed_nonfinite_or_inexact_identity(self):
        outcome = ComparativeOutcome(
            provider_org="Provider",
            external_run_id="run-1",
            candidate_sha=CANDIDATE_SHA,
            case_set_hash="1" * 64,
            constraint_hash="2" * 64,
            external_result_hash="3" * 64,
            raw_external_evidence_hash="4" * 64,
            matched_cases=5,
            mean_delta=0.2,
            ci_low_delta=0.1,
            ci_high_delta=0.3,
            candidate_wins=4,
            baseline_wins=1,
            ties=0,
            attestation_receipt_hash="5" * 64,
        )
        with self.assertRaises(ValueError):
            replace(outcome, raw_external_evidence_hash="x" * 64)
        with self.assertRaises(ValueError):
            replace(outcome, mean_delta=math.inf, ci_low_delta=math.inf, ci_high_delta=math.inf)
        with self.assertRaises(ValueError):
            replace(outcome, candidate_wins=6, baseline_wins=-1)
        with self.assertRaises(ValueError):
            replace(outcome, candidate_sha="candidate")
        with self.assertRaises(ValueError):
            replace(outcome, matched_cases=5.0)

    def test_level6_and_level7_records_require_real_identity_hashes_and_booleans(self):
        with self.assertRaises(ValueError):
            IndependentValidationRecord(
                "Lab", NOW, CANDIDATE_SHA, "z" * 64, H, True, "independent_lab_record"
            )
        valid = IndependentValidationRecord(
            "Lab", NOW, CANDIDATE_SHA, H, "9" * 64, True, "independent_lab_record"
        )
        with self.assertRaises(ValueError):
            replace(valid, candidate_sha="candidate")
        with self.assertRaises(ValueError):
            replace(valid, passed="yes")
        with self.assertRaises(ValueError):
            LongitudinalRefreshRecord(
                "refresh-1", NOW, CANDIDATE_SHA, H, H, "q" * 64, H, H, True
            )
        record = refresh("refresh-1", H)
        with self.assertRaises(ValueError):
            replace(record, passed="yes")
        with self.assertRaises(ValueError):
            replace(record, candidate_sha="candidate")
        with self.assertRaises(ValueError):
            replace(record, case_set_hash="z" * 64)
        with self.assertRaises(ValueError):
            replace(record, executor_org=1)

    def test_level5_provider_floor_cannot_be_lowered_or_malformed(self):
        lowered = ExternalEvidenceGate.level5([], required_provider_orgs=1)
        self.assertEqual(lowered["status"], "FAIL")
        self.assertEqual(lowered["reason"], "external_provider_floor_below_required")
        malformed = ExternalEvidenceGate.level5([], required_provider_orgs=3.0)
        self.assertEqual(malformed["status"], "FAIL")
        self.assertEqual(malformed["reason"], "invalid_required_provider_orgs")

    def test_level7_rejects_duplicate_refreshes_and_cannot_lower_three_refresh_floor(self):
        l6 = level6_identity()
        a = refresh("a", "1" * 64)
        b = refresh("b", "5" * 64)
        duplicate = ExternalEvidenceGate.level7(
            l6,
            [a, a, b],
            receipts=[attest(a), attest(b)],
            verifier_secrets=SECRETS,
            trusted_issuers=TRUST,
        )
        self.assertEqual(duplicate["status"], "FAIL")
        self.assertIn("duplicate_longitudinal_refresh", duplicate["reasons"])
        self.assertIn("insufficient_attested_longitudinal_refreshes", duplicate["reasons"])

        lowered = ExternalEvidenceGate.level7(
            l6,
            [a, b],
            receipts=[attest(a), attest(b)],
            verifier_secrets=SECRETS,
            trusted_issuers=TRUST,
            min_refreshes=1,
        )
        self.assertEqual(lowered["status"], "FAIL")
        self.assertIn("longitudinal_refresh_floor_below_required", lowered["reasons"])
        malformed = ExternalEvidenceGate.level7(l6, [a, b], min_refreshes=3.0)
        self.assertEqual(malformed["status"], "FAIL")
        self.assertIn("invalid_longitudinal_refresh_floor", malformed["reasons"])

    def test_level7_rejects_correctly_attested_refresh_for_other_candidate_or_case_set(self):
        l6 = level6_identity()
        good_a = refresh("good-a", "1" * 64)
        good_b = refresh("good-b", "5" * 64)
        wrong_candidate = refresh("wrong-candidate", "9" * 64, candidate_sha="e" * 40)
        wrong_cases = refresh("wrong-cases", "6" * 64, case_set_hash="b" * 64)

        report = ExternalEvidenceGate.level7(
            l6,
            [good_a, good_b, wrong_candidate, wrong_cases],
            receipts=[attest(x) for x in (good_a, good_b, wrong_candidate, wrong_cases)],
            verifier_secrets=SECRETS,
            trusted_issuers=TRUST,
        )
        self.assertEqual(report["status"], "FAIL")
        self.assertIn("longitudinal_refresh_identity_mismatch", report["reasons"])
        self.assertIn("insufficient_attested_longitudinal_refreshes", report["reasons"])
        self.assertEqual(report["refresh_count"], 2)

    def test_level7_requires_level6_identity_binding(self):
        a = refresh("a", "1" * 64)
        b = refresh("b", "5" * 64)
        c = refresh("c", "9" * 64)
        report = ExternalEvidenceGate.level7(
            {"status": "PASS", "attestation_verified": True},
            [a, b, c],
            receipts=[attest(a), attest(b), attest(c)],
            verifier_secrets=SECRETS,
            trusted_issuers=TRUST,
        )
        self.assertEqual(report["status"], "FAIL")
        self.assertIn("level6_identity_binding_invalid", report["reasons"])
        self.assertEqual(report["refresh_count"], 0)

    def test_claim_boundary_rejects_nonhex_benchmark_digest(self):
        l5 = {
            "status": "PASS",
            "attestation_verified": True,
            "baseline_registry_verified": True,
            "provider_orgs": ["provider"],
            "run_ids": ["run-1"],
            "candidate_sha": CANDIDATE_SHA,
            "case_set_hash": H,
            "constraint_hash": "b" * 64,
            "run_receipt_hashes": {"run-1": "c" * 64},
        }
        l6 = {"status": "PASS", "attestation_verified": True}
        l7 = {"status": "PASS", "attestation_verified": True}
        denied = ClaimBoundary.authorize(
            "scoped comparison",
            level5=l5,
            level6=l6,
            level7=l7,
            comparison_scope="sealed benchmark",
            benchmark_hash="z" * 64,
        )
        self.assertEqual(denied["status"], "DENY")
        self.assertEqual(denied["reason"], "comparison_scope_or_benchmark_missing")

    def test_microsoft_superiority_claim_is_broad_and_requires_level7(self):
        l5 = {
            "status": "PASS",
            "attestation_verified": True,
            "baseline_registry_verified": True,
        }
        denied = ClaimBoundary.authorize(
            "better than Microsoft",
            level5=l5,
            level6={"status": "FAIL", "attestation_verified": False},
            level7={"status": "FAIL", "attestation_verified": False},
            comparison_scope="sealed benchmark",
            benchmark_hash=H,
        )
        self.assertEqual(denied["status"], "DENY")
        self.assertEqual(denied["reason"], "broad_frontier_claim_not_proven")
        self.assertEqual(denied["max_evidence_level"], 5)

    def test_equivalent_broad_claim_wording_cannot_bypass_level7(self):
        broad_variants = (
            "world-best system",
            "best in the world",
            "superior to Microsoft",
            "outperforms OpenAI",
            "beats Google",
            "ahead of Anthropic",
            "globally leading system",
            "frontier leader",
        )
        for claim in broad_variants:
            with self.subTest(claim=claim):
                self.assertTrue(ClaimBoundary._is_broad_claim(claim))

    def test_scoped_baseline_comparison_is_not_laundered_into_broad_claim(self):
        scoped_variants = (
            "better than baseline-v1 on declared sealed benchmark",
            "outperforms registered baseline on metric X",
            "positive paired delta on the declared case set",
        )
        for claim in scoped_variants:
            with self.subTest(claim=claim):
                self.assertFalse(ClaimBoundary._is_broad_claim(claim))


if __name__ == "__main__":
    unittest.main(verbosity=2)
