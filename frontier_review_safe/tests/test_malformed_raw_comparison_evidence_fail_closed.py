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


def _level5_pass():
    return {
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


class MalformedRawComparisonEvidenceTests(unittest.TestCase):
    def _authorize(self, *, candidate_results, baseline_results):
        with (
            patch.object(ExternalEvidenceGate, "level5", return_value=_level5_pass()),
            patch.object(ExternalEvidenceGate, "level6", return_value={"status": "FAIL", "attestation_verified": False}),
            patch.object(ExternalEvidenceGate, "level7", return_value={"status": "FAIL", "attestation_verified": False}),
        ):
            return ClaimBoundary.authorize_verified(
                "scoped comparison",
                runs=[_run()],
                run_receipts=[],
                verifier_secrets={},
                trusted_issuers={},
                baseline_registry=object(),
                candidate_results=candidate_results,
                baseline_results_by_run={"run-1": baseline_results},
                comparison_scope="sealed benchmark",
                benchmark_hash=HASH,
            )

    def test_malformed_candidate_case_object_is_denied_without_exception(self):
        result = self._authorize(candidate_results=[object()], baseline_results=[])
        self.assertEqual(result["status"], "DENY")
        self.assertEqual(result["reason"], "comparison_raw_evidence_invalid")

    def test_malformed_baseline_case_object_is_denied_without_exception(self):
        result = self._authorize(candidate_results=[], baseline_results=[object()])
        self.assertEqual(result["status"], "DENY")
        self.assertEqual(result["reason"], "comparison_raw_evidence_invalid")


if __name__ == "__main__":
    unittest.main(verbosity=2)
