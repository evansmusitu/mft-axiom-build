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
            candidate_sha="candidate",
            candidate_environment_hash="6" * 64,
            metrics={"score": 0.9},
            configuration_hash="7" * 64,
            account_scope_hash="8" * 64,
            baseline_registry_hash="9" * 64,
            baseline_registration_id="reg-1",
            baseline_registration_hash="a" * 64,
        )

    def test_external_run_rejects_nonhex_hashes_nonfinite_metrics_and_empty_candidate(self):
        run = self.valid_run()
        with self.assertRaises(ValueError):
            replace(run, result_hash="z" * 64)
        with self.assertRaises(ValueError):
            replace(run, baseline_registry_hash="q" * 64)
        with self.assertRaises(ValueError):
            replace(run, metrics={"score": math.inf})
        with self.assertRaises(ValueError):
            replace(run, candidate_sha="")

    def test_comparative_outcome_rejects_malformed_or_nonfinite_statistics(self):
        outcome = ComparativeOutcome(
            provider_org="Provider",
            external_run_id="run-1",
            candidate_sha="candidate",
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

    def test_level6_and_level7_record_hashes_require_real_hex_digests(self):
        with self.assertRaises(ValueError):
            IndependentValidationRecord(
                "Lab", NOW, "candidate", "z" * 64, H, True, "independent_lab_record"
            )
        with self.assertRaises(ValueError):
            LongitudinalRefreshRecord(
                "refresh-1", NOW, H, "q" * 64, H, H, True
            )

    def test_level7_rejects_duplicate_refreshes_and_cannot_lower_three_refresh_floor(self):
        l6 = {"status": "PASS", "attestation_verified": True}
        a = LongitudinalRefreshRecord("a", NOW, "1" * 64, "2" * 64, "3" * 64, "4" * 64, True)
        b = LongitudinalRefreshRecord("b", NOW, "5" * 64, "6" * 64, "7" * 64, "8" * 64, True)
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

    def test_claim_boundary_rejects_nonhex_benchmark_digest(self):
        l5 = {
            "status": "PASS",
            "attestation_verified": True,
            "baseline_registry_verified": True,
            "provider_orgs": ["provider"],
            "run_ids": ["run-1"],
            "candidate_sha": "candidate",
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


if __name__ == "__main__":
    unittest.main(verbosity=2)
