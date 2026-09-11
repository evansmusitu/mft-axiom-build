from __future__ import annotations

from datetime import datetime, timedelta, timezone
import unittest

from frontier_review_safe.baseline_registry import BaselineRegistration, BaselineRegistry
from frontier_review_safe.external_attestation import ExternalAttestationService
from frontier_review_safe.external_validation import ExternalEvidenceGate, ExternalRunRecord


NOW = datetime(2026, 9, 11, 10, 50, tzinfo=timezone.utc)
CANDIDATE_SHA = "d" * 40
CASE_SET_HASH = "a" * 64
CONSTRAINT_HASH = "b" * 64
PERMISSIONS_HASH = "c" * 64
CONFIGURATION_HASH = "6" * 64
ACCOUNT_SCOPE_HASH = "7" * 64
ENVIRONMENT_HASH = "f" * 64
PROVIDERS = ("OpenAI", "Anthropic", "Google")


def fixture():
    registrations = tuple(
        BaselineRegistration(
            registration_id=f"reg-{i}",
            provider_org=provider,
            provider_class="general_agent",
            product="agent",
            exact_version="v1",
            access_mode="api",
            registered_at=(NOW - timedelta(minutes=5)).isoformat(),
            valid_until=(NOW + timedelta(days=1)).isoformat(),
            case_set_hash=CASE_SET_HASH,
            constraint_hash=CONSTRAINT_HASH,
            permissions_hash=PERMISSIONS_HASH,
            configuration_hash=CONFIGURATION_HASH,
            account_scope_hash=ACCOUNT_SCOPE_HASH,
            capabilities=("sealed_eval",),
        )
        for i, provider in enumerate(PROVIDERS)
    )
    registry = BaselineRegistry(
        "musitu.axiom.baseline-registry.v1",
        "attestation-independence-v1",
        (NOW - timedelta(minutes=5)).isoformat(),
        registrations,
    )
    runs = tuple(
        ExternalRunRecord(
            run_id=f"run-{i}",
            provider_org=provider,
            product="agent",
            exact_version="v1",
            executed_at=NOW.isoformat(),
            access_mode="api",
            case_set_hash=CASE_SET_HASH,
            constraint_hash=CONSTRAINT_HASH,
            permissions_hash=PERMISSIONS_HASH,
            result_hash=f"{i + 10:064x}",
            raw_evidence_hash=f"{i + 20:064x}",
            provenance_type="provider_api_receipt",
            authenticated=True,
            candidate_sha=CANDIDATE_SHA,
            candidate_environment_hash=ENVIRONMENT_HASH,
            metrics={"score": .9},
            configuration_hash=CONFIGURATION_HASH,
            account_scope_hash=ACCOUNT_SCOPE_HASH,
            baseline_registry_hash=registry.fingerprint,
            baseline_registration_id=registration.registration_id,
            baseline_registration_hash=registration.fingerprint,
        )
        for i, (provider, registration) in enumerate(zip(PROVIDERS, registrations))
    )
    return registry, runs


def issue(run, *, issuer_org: str, key_id: str, secret: bytes):
    return ExternalAttestationService.issue(
        subject_type="external_run",
        subject_id=run.run_id,
        subject_hash=run.fingerprint,
        issuer_org=issuer_org,
        verifier_key_id=key_id,
        provenance_type=run.provenance_type,
        issued_at=NOW.isoformat(),
        verifier_secret=secret,
    )


class Level5AttestationIndependenceTests(unittest.TestCase):
    def evaluate(self, registry, runs, receipts, secrets, trust):
        return ExternalEvidenceGate.level5(
            runs,
            receipts=receipts,
            verifier_secrets=secrets,
            trusted_issuers=trust,
            baseline_registry=registry,
        )

    def test_each_provider_cannot_self_attest_even_with_valid_trusted_hmac(self):
        registry, runs = fixture()
        secrets = {f"key-{i}": bytes([65 + i]) * 32 for i in range(3)}
        receipts = [
            issue(run, issuer_org=run.provider_org, key_id=f"key-{i}", secret=secrets[f"key-{i}"])
            for i, run in enumerate(runs)
        ]
        trust = {provider: frozenset({f"key-{i}"}) for i, provider in enumerate(PROVIDERS)}
        result = self.evaluate(registry, runs, receipts, secrets, trust)
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("external_attestation_issuer_overlaps_level5_provider", result["reasons"])
        self.assertIn("not_all_external_runs_attested_and_registered", result["reasons"])
        self.assertIn("insufficient_independent_providers", result["reasons"])
        self.assertEqual(result["run_count"], 0)

    def test_provider_cross_attestation_cycle_is_not_independent(self):
        registry, runs = fixture()
        issuers = ("Anthropic", "Google", "OpenAI")
        secrets = {f"cross-{i}": bytes([75 + i]) * 32 for i in range(3)}
        receipts = [
            issue(run, issuer_org=issuers[i], key_id=f"cross-{i}", secret=secrets[f"cross-{i}"])
            for i, run in enumerate(runs)
        ]
        trust = {issuer: frozenset({f"cross-{i}"}) for i, issuer in enumerate(issuers)}
        result = self.evaluate(registry, runs, receipts, secrets, trust)
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("external_attestation_issuer_overlaps_level5_provider", result["reasons"])
        self.assertEqual(result["run_count"], 0)

    def test_case_and_whitespace_alias_of_provider_still_counts_as_overlap(self):
        registry, runs = fixture()
        secrets = {"alias-key": b"z" * 32, "lab-key": b"l" * 32}
        receipts = [
            issue(runs[0], issuer_org=" OPENAI ", key_id="alias-key", secret=secrets["alias-key"]),
            issue(runs[1], issuer_org="ExternalLab", key_id="lab-key", secret=secrets["lab-key"]),
            issue(runs[2], issuer_org="ExternalLab", key_id="lab-key", secret=secrets["lab-key"]),
        ]
        trust = {
            " OPENAI ": frozenset({"alias-key"}),
            "ExternalLab": frozenset({"lab-key"}),
        }
        result = self.evaluate(registry, runs, receipts, secrets, trust)
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("external_attestation_issuer_overlaps_level5_provider", result["reasons"])
        self.assertEqual(result["run_count"], 2)

    def test_independent_evaluator_can_attest_all_registered_provider_runs(self):
        registry, runs = fixture()
        secret = b"i" * 32
        receipts = [
            issue(run, issuer_org="IndependentEvaluator", key_id="independent-key", secret=secret)
            for run in runs
        ]
        result = self.evaluate(
            registry,
            runs,
            receipts,
            {"independent-key": secret},
            {"IndependentEvaluator": frozenset({"independent-key"})},
        )
        self.assertEqual(result["status"], "PASS")
        self.assertTrue(result["attestation_verified"])
        self.assertTrue(result["baseline_registry_verified"])
        self.assertEqual(result["run_count"], 3)
        self.assertEqual(set(result["provider_orgs"]), {"openai", "anthropic", "google"})


if __name__ == "__main__":
    unittest.main(verbosity=2)
