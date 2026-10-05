from __future__ import annotations

from dataclasses import replace
import unittest

from frontier_review_safe.baseline_registry import BaselineRegistration, BaselineRegistry
from frontier_review_safe.core import sha256
from frontier_review_safe.external_attestation import ExternalAttestationService
from frontier_review_safe.external_execution import ProviderExecutionEvidence, ProviderExecutionNormalizer
from frontier_review_safe.external_validation import ExternalEvidenceGate, ExternalRunRecord


NOW = "2026-09-12T06:30:00+00:00"
H = {name: sha256({"binding": name}) for name in (
    "case_set", "constraint", "permissions", "configuration", "account",
    "result", "raw", "receipt", "receipt_alt", "environment",
)}


class ProviderReceiptAttestationBindingTests(unittest.TestCase):
    def fixture(self) -> tuple[BaselineRegistry, ProviderExecutionEvidence]:
        registration = BaselineRegistration(
            registration_id="provider-reg-001",
            provider_org="Provider A",
            provider_class="general_agent",
            product="agent",
            exact_version="v1",
            access_mode="api",
            registered_at="2026-09-12T06:00:00+00:00",
            valid_until="2026-09-13T06:00:00+00:00",
            case_set_hash=H["case_set"],
            constraint_hash=H["constraint"],
            permissions_hash=H["permissions"],
            configuration_hash=H["configuration"],
            account_scope_hash=H["account"],
            capabilities=("sealed_eval",),
        )
        registry = BaselineRegistry(
            "musitu.axiom.baseline-registry.v1",
            "provider-receipt-binding-v1",
            "2026-09-12T06:00:00+00:00",
            (registration,),
        )
        evidence = ProviderExecutionEvidence(
            schema="musitu.axiom.provider-execution-evidence.v1",
            run_id="provider-run-001",
            baseline_registry_hash=registry.fingerprint,
            baseline_registration_id=registration.registration_id,
            baseline_registration_hash=registration.fingerprint,
            provider_org=registration.provider_org,
            product=registration.product,
            exact_version=registration.exact_version,
            access_mode=registration.access_mode,
            executed_at=NOW,
            case_set_hash=registration.case_set_hash,
            constraint_hash=registration.constraint_hash,
            permissions_hash=registration.permissions_hash,
            configuration_hash=registration.configuration_hash,
            account_scope_hash=registration.account_scope_hash,
            result_hash=H["result"],
            raw_evidence_hash=H["raw"],
            provider_receipt_hash=H["receipt"],
            provider_request_id="request-001",
            provider_response_id="response-001",
            provenance_type="provider_api_receipt",
            candidate_sha="d" * 40,
            candidate_environment_hash=H["environment"],
            metrics={"score": 0.9},
        )
        return registry, evidence

    def test_provider_receipt_identity_changes_attested_run_subject(self):
        registry, evidence = self.fixture()
        original = ProviderExecutionNormalizer.normalize(evidence, registry)
        variants = (
            replace(evidence, provider_receipt_hash=H["receipt_alt"]),
            replace(evidence, provider_request_id="request-002"),
            replace(evidence, provider_response_id="response-002"),
        )
        for changed_evidence in variants:
            with self.subTest(changed=changed_evidence):
                changed = ProviderExecutionNormalizer.normalize(changed_evidence, registry)
                self.assertNotEqual(
                    original["provider_receipt_binding_sha256"],
                    changed["provider_receipt_binding_sha256"],
                )
                self.assertNotEqual(
                    original["run"].fingerprint,
                    changed["run"].fingerprint,
                    "provider receipt identity must be inside the independently attested external-run subject",
                )

    def test_plain_external_run_without_provider_receipt_binding_cannot_pass_level5(self):
        providers = ("Provider A", "Provider B", "Provider C")
        registrations = tuple(
            BaselineRegistration(
                registration_id=f"provider-reg-{index}",
                provider_org=provider,
                provider_class="general_agent",
                product="agent",
                exact_version="v1",
                access_mode="api",
                registered_at="2026-09-12T06:00:00+00:00",
                valid_until="2026-09-13T06:00:00+00:00",
                case_set_hash=H["case_set"],
                constraint_hash=H["constraint"],
                permissions_hash=H["permissions"],
                configuration_hash=H["configuration"],
                account_scope_hash=H["account"],
                capabilities=("sealed_eval",),
            )
            for index, provider in enumerate(providers)
        )
        registry = BaselineRegistry(
            "musitu.axiom.baseline-registry.v1",
            "provider-receipt-level5-bypass-v1",
            "2026-09-12T06:00:00+00:00",
            registrations,
        )
        runs = tuple(
            ExternalRunRecord(
                run_id=f"provider-run-{index}",
                provider_org=provider,
                product="agent",
                exact_version="v1",
                executed_at=NOW,
                access_mode="api",
                case_set_hash=H["case_set"],
                constraint_hash=H["constraint"],
                permissions_hash=H["permissions"],
                result_hash=sha256({"result": index}),
                raw_evidence_hash=sha256({"raw": index}),
                provenance_type="provider_api_receipt",
                authenticated=True,
                candidate_sha="d" * 40,
                candidate_environment_hash=H["environment"],
                metrics={"score": 0.9},
                configuration_hash=H["configuration"],
                account_scope_hash=H["account"],
                baseline_registry_hash=registry.fingerprint,
                baseline_registration_id=registration.registration_id,
                baseline_registration_hash=registration.fingerprint,
            )
            for index, (provider, registration) in enumerate(zip(providers, registrations))
        )
        secret = b"independent-evaluator-secret" * 2
        receipts = tuple(
            ExternalAttestationService.issue(
                subject_type="external_run",
                subject_id=run.run_id,
                subject_hash=run.fingerprint,
                issuer_org="Independent Evaluator",
                verifier_key_id="independent-key",
                provenance_type=run.provenance_type,
                issued_at=NOW,
                verifier_secret=secret,
            )
            for run in runs
        )
        result = ExternalEvidenceGate.level5(
            runs,
            receipts=receipts,
            verifier_secrets={"independent-key": secret},
            trusted_issuers={"Independent Evaluator": frozenset({"independent-key"})},
            baseline_registry=registry,
        )
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("provider_execution_receipt_binding_missing", result["reasons"])
        self.assertEqual(result["run_count"], 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
