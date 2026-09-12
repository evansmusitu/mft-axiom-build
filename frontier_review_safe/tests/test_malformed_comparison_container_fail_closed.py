from __future__ import annotations

import unittest
from unittest.mock import patch

from frontier_review_safe.external_validation import ClaimBoundary, ExternalEvidenceGate, ExternalRunRecord


HASH = "a" * 64
CANDIDATE_SHA = "d" * 40


def _run() -> ExternalRunRecord:
    return ExternalRunRecord(
        run_id="run-1",
        provider_org="Provider A",
        product="Product A",
        exact_version="1.0",
        executed_at="2026-09-12T04:00:00+00:00",
        access_mode="api",
        case_set_hash=HASH,
        constraint_hash="b" * 64,
        permissions_hash="c" * 64,
        result_hash="d" * 64,
        raw_evidence_hash="e" * 64,
        provenance_type="provider_api_receipt",
        authenticated=True,
        candidate_sha=CANDIDATE_SHA,
        candidate_environment_hash="f" * 64,
        metrics={"score": 1.0},
    )


class MalformedComparisonContainerTests(unittest.TestCase):
    def test_level5_non_iterable_required_provider_classes_fails_closed_without_exception(self):
        result = ExternalEvidenceGate.level5([_run()], required_provider_classes=None)
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("invalid_required_provider_classes", result["reasons"])
        self.assertFalse(result["attestation_verified"])

    def test_verified_claim_non_mapping_baseline_results_fails_closed_without_exception(self):
        level5 = {
            "status": "PASS",
            "attestation_verified": True,
            "baseline_registry_verified": True,
            "provider_orgs": ["provider-a"],
            "run_ids": ["run-1"],
            "candidate_sha": CANDIDATE_SHA,
            "case_set_hash": HASH,
            "constraint_hash": "b" * 64,
            "run_receipt_hashes": {"run-1": "c" * 64},
        }
        level6 = {"status": "FAIL", "attestation_verified": False}
        level7 = {"status": "FAIL", "attestation_verified": False}
        with (
            patch.object(ExternalEvidenceGate, "level5", return_value=level5),
            patch.object(ExternalEvidenceGate, "level6", return_value=level6),
            patch.object(ExternalEvidenceGate, "level7", return_value=level7),
        ):
            result = ClaimBoundary.authorize_verified(
                "scoped comparison",
                runs=[],
                run_receipts=[],
                verifier_secrets={},
                trusted_issuers={},
                baseline_registry=object(),
                candidate_results=[],
                baseline_results_by_run=None,
                comparison_scope="sealed benchmark",
                benchmark_hash=HASH,
            )
        self.assertEqual(result["status"], "DENY")
        self.assertEqual(result["reason"], "invalid_baseline_results_by_run")
        self.assertEqual(result["verified_evidence_levels"]["level5"], "PASS")


if __name__ == "__main__":
    unittest.main(verbosity=2)
