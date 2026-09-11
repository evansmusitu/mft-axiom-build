from __future__ import annotations

from dataclasses import replace
import unittest

from frontier_review_safe.baseline_registry import BaselineRegistration, BaselineRegistry
from frontier_review_safe.core import FrontierSafetyError, sha256
from frontier_review_safe.external_execution import ProviderExecutionEvidence, ProviderExecutionNormalizer
from frontier_review_safe.external_validation import ExternalEvidenceGate


NOW = "2026-09-11T06:00:00+00:00"
H = {
    name: sha256({"binding": name})
    for name in (
        "case_set", "constraint", "permissions", "configuration", "account",
        "result", "raw", "receipt", "environment",
    )
}


class ExternalExecutionNormalizationTests(unittest.TestCase):
    def registry(self) -> tuple[BaselineRegistry, BaselineRegistration]:
        registration = BaselineRegistration(
            registration_id="openai-agent-2026-09",
            provider_org="OpenAI",
            provider_class="general_agent",
            product="provider-agent",
            exact_version="2026-09-11",
            access_mode="provider_api",
            registered_at="2026-09-11T05:00:00+00:00",
            valid_until="2026-09-12T05:00:00+00:00",
            case_set_hash=H["case_set"],
            constraint_hash=H["constraint"],
            permissions_hash=H["permissions"],
            configuration_hash=H["configuration"],
            account_scope_hash=H["account"],
            capabilities=("sealed_reasoning",),
        )
        registry = BaselineRegistry(
            "musitu.axiom.baseline-registry.v1",
            "2026-09-11.1",
            "2026-09-11T05:00:00+00:00",
            (registration,),
        )
        return registry, registration

    def evidence(self) -> tuple[BaselineRegistry, ProviderExecutionEvidence]:
        registry, registration = self.registry()
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
            candidate_sha="5" * 40,
            candidate_environment_hash=H["environment"],
            metrics={"score": .8, "latency_ms": 123.0, "cost_units": .5},
        )
        return registry, evidence

    def test_valid_provider_evidence_normalizes_but_cannot_self_attest_level5(self):
        registry, evidence = self.evidence()
        normalized = ProviderExecutionNormalizer.normalize(evidence, registry)
        self.assertEqual(normalized["status"], "NORMALIZED_NOT_ATTESTED")
        self.assertFalse(normalized["level5_authorized"])
        self.assertEqual(len(normalized["run_sha256"]), 64)
        self.assertEqual(normalized["run"].exact_version, evidence.exact_version)

        gate = ExternalEvidenceGate.level5(
            [normalized["run"]],
            baseline_registry=registry,
        )
        self.assertEqual(gate["status"], "FAIL")
        self.assertFalse(gate["attestation_verified"])
        self.assertIn("external_run_attestation_missing", gate["reasons"])
        self.assertIn("insufficient_independent_providers", gate["reasons"])

    def test_exact_version_and_registry_drift_fail_closed(self):
        registry, evidence = self.evidence()
        with self.assertRaises(FrontierSafetyError):
            ProviderExecutionNormalizer.normalize(
                replace(evidence, exact_version="different-version"), registry
            )
        with self.assertRaises(FrontierSafetyError):
            ProviderExecutionNormalizer.normalize(
                replace(evidence, baseline_registry_hash="f" * 64), registry
            )

    def test_local_or_lab_provenance_cannot_enter_provider_execution_boundary(self):
        _, evidence = self.evidence()
        with self.assertRaises(ValueError):
            replace(evidence, provenance_type="repository_local")
        with self.assertRaises(ValueError):
            replace(evidence, provenance_type="independent_lab_record")

    def test_execution_evidence_schema_excludes_secrets_and_sealed_content(self):
        forbidden = {"api_key", "token", "secret", "prompt", "answer", "case_payload", "sealed_case"}
        fields = {name.lower() for name in ProviderExecutionEvidence.__dataclass_fields__}
        self.assertTrue(forbidden.isdisjoint(fields))
        _, evidence = self.evidence()
        self.assertNotIn("api_key", evidence.__dict__)
        self.assertNotIn("prompt", evidence.__dict__)

    def test_nonfinite_or_negative_operational_metrics_fail_closed(self):
        _, evidence = self.evidence()
        with self.assertRaises(ValueError):
            replace(evidence, metrics={"score": float("nan")})
        with self.assertRaises(ValueError):
            replace(evidence, metrics={"latency_ms": -1.0})
        with self.assertRaises(ValueError):
            replace(evidence, metrics={"cost_units": -0.01})


if __name__ == "__main__":
    unittest.main(verbosity=2)
