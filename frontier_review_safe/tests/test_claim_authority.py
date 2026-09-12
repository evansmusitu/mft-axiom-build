from __future__ import annotations

from dataclasses import asdict
from datetime import datetime, timedelta, timezone
import unittest

from frontier_review_safe.baseline_registry import BaselineRegistration, BaselineRegistry
from frontier_review_safe.core import sha256
from frontier_review_safe.evaluation import SealedCaseResult
from frontier_review_safe.external_attestation import ExternalAttestationService
from frontier_review_safe.external_execution import ProviderBoundExternalRunRecord
from frontier_review_safe.external_validation import (
    ClaimBoundary,
    ComparativeOutcome,
    ExternalEvidenceGate,
    LongitudinalRefreshRecord,
)


NOW = datetime(2026, 9, 11, 10, 30, tzinfo=timezone.utc)
NOW_S = NOW.isoformat()
CANDIDATE_SHA = "d" * 40
SECRET = b"c" * 32
SECRETS = {"claim-key": SECRET}
TRUST = {"claim-verifier": frozenset({"claim-key"})}


def issue(subject_type: str, subject_id: str, subject_hash: str, provenance_type: str, *, issued_at: str = NOW_S):
    return ExternalAttestationService.issue(
        subject_type=subject_type,
        subject_id=subject_id,
        subject_hash=subject_hash,
        issuer_org="claim-verifier",
        verifier_key_id="claim-key",
        provenance_type=provenance_type,
        issued_at=issued_at,
        verifier_secret=SECRET,
    )


def external_fixture():
    fps = [f"{i:064x}" for i in range(10)]
    baseline = [SealedCaseResult(fp, .80) for fp in fps]
    candidate = [SealedCaseResult(fp, .95) for fp in fps]
    constraint_hash = "b" * 64
    case_set_hash = sha256({"case_fingerprints": sorted(fps), "constraint_hash": constraint_hash})
    result_hash = sha256([asdict(x) for x in sorted(baseline, key=lambda x: x.case_fingerprint)])
    providers = ("OpenAI", "Anthropic", "Google")
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
            case_set_hash=case_set_hash,
            constraint_hash=constraint_hash,
            permissions_hash="c" * 64,
            configuration_hash="6" * 64,
            account_scope_hash="7" * 64,
            capabilities=("sealed_eval",),
        ))
    registry = BaselineRegistry(
        "musitu.axiom.baseline-registry.v1",
        "claim-test-v1",
        (NOW - timedelta(minutes=5)).isoformat(),
        tuple(registrations),
    )
    runs = []
    for i, (provider, registration) in enumerate(zip(providers, registrations)):
        runs.append(ProviderBoundExternalRunRecord(
            run_id=f"run-{i}",
            provider_org=provider,
            product="agent",
            exact_version="v1",
            executed_at=NOW_S,
            access_mode="api",
            case_set_hash=case_set_hash,
            constraint_hash=constraint_hash,
            permissions_hash="c" * 64,
            result_hash=result_hash,
            raw_evidence_hash=f"{i + 3:064x}",
            provenance_type="provider_api_receipt",
            authenticated=True,
            candidate_sha=CANDIDATE_SHA,
            candidate_environment_hash="f" * 64,
            metrics={"score": .8},
            configuration_hash="6" * 64,
            account_scope_hash="7" * 64,
            baseline_registry_hash=registry.fingerprint,
            baseline_registration_id=registration.registration_id,
            baseline_registration_hash=registration.fingerprint,
            provider_receipt_hash=f"{i + 30:064x}",
            provider_request_id=f"request-{i}",
            provider_response_id=f"response-{i}",
        ))
    receipts = [issue("external_run", r.run_id, r.fingerprint, r.provenance_type) for r in runs]
    return registry, runs, receipts, baseline, candidate, case_set_hash, constraint_hash


class ClaimAuthorityTests(unittest.TestCase):
    def test_forged_pass_summaries_and_positive_outcomes_cannot_authorize(self):
        providers = ("openai", "anthropic", "google")
        receipt_hashes = {f"run-{i}": f"{i + 20:064x}" for i in range(3)}
        level5 = {
            "status": "PASS",
            "attestation_verified": True,
            "baseline_registry_verified": True,
            "provider_orgs": list(providers),
            "run_ids": list(receipt_hashes),
            "candidate_sha": CANDIDATE_SHA,
            "case_set_hash": "a" * 64,
            "constraint_hash": "b" * 64,
            "run_receipt_hashes": receipt_hashes,
        }
        outcomes = [
            ComparativeOutcome(
                provider_org=provider,
                external_run_id=f"run-{i}",
                candidate_sha=CANDIDATE_SHA,
                case_set_hash="a" * 64,
                constraint_hash="b" * 64,
                external_result_hash="c" * 64,
                raw_external_evidence_hash="d" * 64,
                matched_cases=10,
                mean_delta=.1,
                ci_low_delta=.02,
                ci_high_delta=.18,
                candidate_wins=7,
                baseline_wins=2,
                ties=1,
                attestation_receipt_hash=receipt_hashes[f"run-{i}"],
            )
            for i, provider in enumerate(providers)
        ]
        result = ClaimBoundary.authorize(
            "outperformed registered baselines on sealed suite",
            level5=level5,
            level6={"status": "FAIL"},
            level7={"status": "FAIL"},
            comparison_scope="sealed suite",
            benchmark_hash="a" * 64,
            comparative_outcomes=outcomes,
        )
        self.assertEqual(result["status"], "DENY")
        self.assertEqual(result["reason"], "verified_external_evidence_required")

    def test_verified_claim_path_recomputes_baseline_result_hash(self):
        registry, runs, receipts, baseline, candidate, case_set_hash, _ = external_fixture()
        tampered = list(baseline)
        tampered[0] = SealedCaseResult(tampered[0].case_fingerprint, .10)
        result = ClaimBoundary.authorize_verified(
            "outperformed registered baselines on sealed suite",
            runs=runs,
            run_receipts=receipts,
            verifier_secrets=SECRETS,
            trusted_issuers=TRUST,
            baseline_registry=registry,
            candidate_results=candidate,
            baseline_results_by_run={
                runs[0].run_id: tampered,
                runs[1].run_id: baseline,
                runs[2].run_id: baseline,
            },
            comparison_scope="sealed suite",
            benchmark_hash=case_set_hash,
            comparison_bootstrap_samples=200,
        )
        self.assertEqual(result["status"], "DENY")
        self.assertEqual(result["reason"], "comparison_raw_evidence_invalid")
        self.assertEqual(result["verified_evidence_levels"]["level5"], "PASS")

    def test_level7_receipt_provenance_must_match_refresh_record(self):
        level6 = {
            "status": "PASS",
            "attestation_verified": True,
            "candidate_sha": CANDIDATE_SHA,
            "case_set_hash": "a" * 64,
        }
        refreshes = [
            LongitudinalRefreshRecord(
                f"refresh-{i}",
                (NOW + timedelta(days=30 * i)).isoformat(),
                CANDIDATE_SHA,
                "a" * 64,
                f"{i % 2:064x}",
                "1" * 64,
                "2" * 64,
                "3" * 64,
                True,
                "independent_lab_record",
                executor_org="Independent Longitudinal Lab",
            )
            for i in range(3)
        ]
        receipts = [
            issue(
                "longitudinal_refresh",
                refresh.refresh_id,
                refresh.fingerprint,
                "provider_export" if i == 1 else refresh.provenance_type,
                issued_at=refresh.executed_at,
            )
            for i, refresh in enumerate(refreshes)
        ]
        result = ExternalEvidenceGate.level7(
            level6,
            refreshes,
            receipts=receipts,
            verifier_secrets=SECRETS,
            trusted_issuers=TRUST,
        )
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("longitudinal_refresh_provenance_type_mismatch", result["reasons"])
        self.assertIn("insufficient_attested_longitudinal_refreshes", result["reasons"])
        self.assertEqual(result["refresh_count"], 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
