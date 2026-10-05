from __future__ import annotations

from collections.abc import Iterator, Mapping
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
import unittest

from frontier_review_safe.baseline_registry import BaselineRegistration, BaselineRegistry
from frontier_review_safe.core import sha256
from frontier_review_safe.evaluation import SealedCaseResult
from frontier_review_safe.external_attestation import ExternalAttestationService
from frontier_review_safe.external_validation import ClaimBoundary, ExternalRunRecord


NOW = datetime(2026, 9, 12, 5, 40, tzinfo=timezone.utc)
CANDIDATE_SHA = "d" * 40
CASE_HASH = "a" * 64
CONSTRAINT_HASH = "b" * 64
SECRET = b"m" * 32
KEY_ID = "mapping-key"
ISSUER = "Independent Mapping Evaluator"
SECRETS = {KEY_ID: SECRET}
TRUST = {ISSUER: frozenset({KEY_ID})}


class ExplodingMapping(Mapping[str, object]):
    def __getitem__(self, key: str) -> object:
        raise KeyError(key)

    def __iter__(self) -> Iterator[str]:
        raise RuntimeError("mapping iteration failed")

    def __len__(self) -> int:
        return 1


def _level5_summary_with_receipts(receipts):
    return {
        "status": "PASS",
        "attestation_verified": True,
        "baseline_registry_verified": True,
        "provider_orgs": ["provider-a"],
        "run_ids": ["run-1"],
        "candidate_sha": CANDIDATE_SHA,
        "case_set_hash": CASE_HASH,
        "constraint_hash": CONSTRAINT_HASH,
        "run_receipt_hashes": receipts,
    }


def _verified_level5_fixture():
    providers = ("Provider A", "Provider B", "Provider C")
    registrations = []
    for i, provider in enumerate(providers):
        registrations.append(BaselineRegistration(
            registration_id=f"reg-{i}",
            provider_org=provider,
            provider_class="general_agent",
            product="agent",
            exact_version="v1",
            access_mode="api",
            registered_at=(NOW - timedelta(minutes=5)).isoformat(),
            valid_until=(NOW + timedelta(days=1)).isoformat(),
            case_set_hash=CASE_HASH,
            constraint_hash=CONSTRAINT_HASH,
            permissions_hash="c" * 64,
            configuration_hash="e" * 64,
            account_scope_hash="f" * 64,
        ))
    registry = BaselineRegistry(
        "musitu.axiom.baseline-registry.v1",
        "mapping-integrity-v1",
        (NOW - timedelta(minutes=5)).isoformat(),
        tuple(registrations),
    )
    runs = []
    for i, (provider, registration) in enumerate(zip(providers, registrations)):
        runs.append(ExternalRunRecord(
            run_id=f"run-{i}",
            provider_org=provider,
            product="agent",
            exact_version="v1",
            executed_at=NOW.isoformat(),
            access_mode="api",
            case_set_hash=CASE_HASH,
            constraint_hash=CONSTRAINT_HASH,
            permissions_hash="c" * 64,
            result_hash=f"{i + 5:064x}",
            raw_evidence_hash=f"{i + 10:064x}",
            provenance_type="provider_api_receipt",
            authenticated=True,
            candidate_sha=CANDIDATE_SHA,
            candidate_environment_hash="9" * 64,
            metrics={"score": 0.8},
            configuration_hash="e" * 64,
            account_scope_hash="f" * 64,
            baseline_registry_hash=registry.fingerprint,
            baseline_registration_id=registration.registration_id,
            baseline_registration_hash=registration.fingerprint,
        ))
    receipts = [
        ExternalAttestationService.issue(
            subject_type="external_run",
            subject_id=run.run_id,
            subject_hash=run.fingerprint,
            issuer_org=ISSUER,
            verifier_key_id=KEY_ID,
            provenance_type=run.provenance_type,
            issued_at=NOW.isoformat(),
            verifier_secret=SECRET,
        )
        for run in runs
    ]
    return registry, runs, receipts


class ClaimMappingMaterializationTests(unittest.TestCase):
    def test_exploding_level5_receipt_mapping_is_denied_without_exception(self):
        result = ClaimBoundary.authorize(
            "scoped comparison",
            level5=_level5_summary_with_receipts(ExplodingMapping()),
            level6={"status": "FAIL"},
            level7={"status": "FAIL"},
            comparison_scope="sealed benchmark",
            benchmark_hash=CASE_HASH,
        )
        self.assertEqual(result["status"], "DENY")
        self.assertEqual(result["reason"], "invalid_level5_run_receipt_hashes")

    def test_exploding_verified_baseline_result_mapping_is_denied_without_exception(self):
        registry, runs, receipts = _verified_level5_fixture()
        result = ClaimBoundary.authorize_verified(
            "scoped comparison",
            runs=runs,
            run_receipts=receipts,
            verifier_secrets=SECRETS,
            trusted_issuers=TRUST,
            baseline_registry=registry,
            candidate_results=[SealedCaseResult(f"{i:064x}", 0.9) for i in range(5)],
            baseline_results_by_run=ExplodingMapping(),
            comparison_scope="sealed benchmark",
            benchmark_hash=CASE_HASH,
        )
        self.assertEqual(result["status"], "DENY")
        self.assertEqual(result["reason"], "invalid_baseline_results_by_run")


if __name__ == "__main__":
    unittest.main(verbosity=2)
