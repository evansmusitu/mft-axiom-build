"""Source-only production runtime evidence validation; no activation is performed."""
import unittest
from dataclasses import replace

from connect.activation import ProductionRuntimeActivationEvidence

AUTH = "MUSITU-CONNECT-RUNTIME-AUTH-TEST-2026"


class ProductionRuntimeStrictEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.valid = ProductionRuntimeActivationEvidence(
            authorization_id=AUTH,
            gate="MUSITU_CONNECT_PRODUCTION_RUNTIME_ENABLED",
            endpoint="https://runtime.example.invalid/compute",
            canary_pass=True,
            production_pass=True,
            exact_usage_ledger_request_id_correlation=True,
            pr_9_unmerged=True,
            main_unchanged=True,
            rollback_required=False,
            production_axiom_integration_enabled=True,
        )

    def test_valid_strictly_typed_evidence_still_passes(self):
        self.assertTrue(self.valid.is_valid(expected_authorization_id=AUTH))

    def test_all_positive_evidence_must_be_literal_true_not_truthy(self):
        positive = (
            "canary_pass", "production_pass",
            "exact_usage_ledger_request_id_correlation", "pr_9_unmerged",
            "main_unchanged", "production_axiom_integration_enabled",
        )
        for field in positive:
            for forged in ("true", "false", 1, [True]):
                with self.subTest(field=field, supplied=repr(forged)):
                    value = replace(self.valid, **{field: forged})
                    self.assertFalse(value.is_valid(expected_authorization_id=AUTH))

    def test_rollback_required_must_be_literal_false_not_falsy(self):
        for forged in (0, "", None, [], {}):
            with self.subTest(supplied=repr(forged)):
                value = replace(self.valid, rollback_required=forged)
                self.assertFalse(value.is_valid(expected_authorization_id=AUTH))

    def test_malformed_authorization_and_endpoint_inputs_fail_closed(self):
        for invalid in (None, 123, {}, True, ""):
            with self.subTest(field="expected_authorization_id", supplied=repr(invalid)):
                self.assertFalse(self.valid.is_valid(expected_authorization_id=invalid))
            with self.subTest(field="endpoint", supplied=repr(invalid)):
                value = replace(self.valid, endpoint=invalid)
                self.assertFalse(value.is_valid(expected_authorization_id=AUTH))
        self.assertFalse(replace(self.valid, endpoint="https://").is_valid(expected_authorization_id=AUTH))


if __name__ == "__main__":
    unittest.main()
