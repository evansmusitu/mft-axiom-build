import unittest

from connect.activation import ProductionRuntimeActivationEvidence


class ProductionRuntimeActivationTests(unittest.TestCase):
    def _verified(self):
        return ProductionRuntimeActivationEvidence(
            authorization_id="MUSITU-CONNECT-RUNTIME-AUTH-2026-10-05-001",
            gate="MUSITU_CONNECT_PRODUCTION_RUNTIME_ENABLED",
            endpoint="https://musitu-connect-production.example.workers.dev",
            canary_pass=True,
            production_pass=True,
            exact_usage_ledger_request_id_correlation=True,
            pr_9_unmerged=True,
            main_unchanged=True,
            rollback_required=False,
            production_axiom_integration_enabled=True,
        )

    def test_verified_runtime_activation_is_valid(self):
        evidence=self._verified()
        self.assertTrue(
            evidence.is_valid(
                expected_authorization_id="MUSITU-CONNECT-RUNTIME-AUTH-2026-10-05-001"
            )
        )

    def test_runtime_activation_fails_closed_on_rollback_or_missing_verification(self):
        evidence=self._verified()
        self.assertFalse(
            ProductionRuntimeActivationEvidence(
                **{**evidence.__dict__, "rollback_required": True}
            ).is_valid(
                expected_authorization_id="MUSITU-CONNECT-RUNTIME-AUTH-2026-10-05-001"
            )
        )
        self.assertFalse(
            ProductionRuntimeActivationEvidence(
                **{**evidence.__dict__, "production_pass": False}
            ).is_valid(
                expected_authorization_id="MUSITU-CONNECT-RUNTIME-AUTH-2026-10-05-001"
            )
        )

    def test_runtime_activation_rejects_wrong_authorization_or_missing_endpoint(self):
        evidence=self._verified()
        self.assertFalse(
            evidence.is_valid(expected_authorization_id="different-authorization")
        )
        self.assertFalse(
            ProductionRuntimeActivationEvidence(
                **{**evidence.__dict__, "endpoint": ""}
            ).is_valid(
                expected_authorization_id="MUSITU-CONNECT-RUNTIME-AUTH-2026-10-05-001"
            )
        )


if __name__=="__main__":
    unittest.main()
