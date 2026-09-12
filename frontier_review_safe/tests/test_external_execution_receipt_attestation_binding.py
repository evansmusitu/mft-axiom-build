from __future__ import annotations

from dataclasses import replace
import unittest

from frontier_review_safe.baseline_registry import BaselineRegistration, BaselineRegistry
from frontier_review_safe.core import sha256
from frontier_review_safe.external_execution import ProviderExecutionEvidence, ProviderExecutionNormalizer


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


if __name__ == "__main__":
    unittest.main(verbosity=2)
