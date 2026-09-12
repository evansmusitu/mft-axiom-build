from __future__ import annotations

from dataclasses import replace
import unittest

from frontier_review_safe.baseline_registry import BaselineRegistration, BaselineRegistry
from frontier_review_safe.core import sha256
from frontier_review_safe.external_execution import ProviderExecutionEvidence


NOW = "2026-09-12T05:45:00+00:00"
H = {
    name: sha256({"binding": name})
    for name in (
        "case_set", "constraint", "permissions", "configuration", "account",
        "result", "raw", "receipt", "environment",
    )
}


def _evidence() -> ProviderExecutionEvidence:
    registration = BaselineRegistration(
        registration_id="provider-a-v1",
        provider_org="Provider A",
        provider_class="general_agent",
        product="agent",
        exact_version="v1",
        access_mode="api",
        registered_at="2026-09-12T05:00:00+00:00",
        valid_until="2026-09-13T05:00:00+00:00",
        case_set_hash=H["case_set"],
        constraint_hash=H["constraint"],
        permissions_hash=H["permissions"],
        configuration_hash=H["configuration"],
        account_scope_hash=H["account"],
    )
    registry = BaselineRegistry(
        "musitu.axiom.baseline-registry.v1",
        "provider-evidence-v1",
        "2026-09-12T05:00:00+00:00",
        (registration,),
    )
    return ProviderExecutionEvidence(
        schema="musitu.axiom.provider-execution-evidence.v1",
        run_id="run-1",
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
        provider_request_id="request-1",
        provider_response_id="response-1",
        provenance_type="provider_api_receipt",
        candidate_sha="d" * 40,
        candidate_environment_hash=H["environment"],
        metrics={"score": 0.8},
    )


class ProviderExecutionIdentityIntegrityTests(unittest.TestCase):
    def test_candidate_sha_must_be_exact_git_sha_at_evidence_boundary(self):
        with self.assertRaises(ValueError):
            replace(_evidence(), candidate_sha="candidate")

    def test_provider_identity_fields_must_be_strings_not_stringifiable_objects(self):
        for field in (
            "run_id", "baseline_registration_id", "provider_org", "product",
            "exact_version", "access_mode", "provider_request_id", "provider_response_id",
        ):
            with self.subTest(field=field):
                with self.assertRaises(ValueError):
                    replace(_evidence(), **{field: 123})


if __name__ == "__main__":
    unittest.main(verbosity=2)
