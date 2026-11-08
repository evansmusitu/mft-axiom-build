import unittest
from dataclasses import replace

from connect.admission import (
    ProductionAdmissionEvidence,
    ProductionAdmissionPolicy,
    ProductionPromotionAuthorization,
)

class ProductionAdmissionTests(unittest.TestCase):
    def _full_evidence(self):
        return ProductionAdmissionEvidence(
            credentialed_request_id_e2e=True,
            non_fixture_identity=True,
            oauth_authorization_code_pkce=True,
            secret_rotation_recovery=True,
            rollback_rehearsal=True,
            observability_alerting_slo=True,
            canary=True,
        )

    def test_missing_production_controls_fail_closed(self):
        decision=ProductionAdmissionPolicy().assess(
            ProductionAdmissionEvidence(credentialed_request_id_e2e=True)
        )
        self.assertFalse(decision.technical_ready)
        self.assertFalse(decision.promotion_authorized)
        self.assertFalse(decision.enablement_permitted)
        self.assertEqual(decision.state,"PRODUCTION_ADMISSION_BLOCKED")
        self.assertIn("non_fixture_identity",decision.missing_controls)
        self.assertNotIn("credentialed_request_id_e2e",decision.missing_controls)

    def test_technical_readiness_does_not_authorize_promotion(self):
        decision=ProductionAdmissionPolicy().assess(self._full_evidence())
        self.assertTrue(decision.technical_ready)
        self.assertFalse(decision.promotion_authorized)
        self.assertFalse(decision.enablement_permitted)
        self.assertEqual(
            decision.state,
            "PRODUCTION_ADMISSION_QUALIFIED__PROMOTION_AUTHORIZATION_REQUIRED",
        )

    def test_authorization_is_recorded_but_does_not_enable_runtime(self):
        decision=ProductionAdmissionPolicy().assess(
            self._full_evidence(),
            ProductionPromotionAuthorization(
                approved=True,
                authorization_id="chg-2026-10-04-001",
                authorized_by="release-authority",
            ),
        )
        self.assertTrue(decision.technical_ready)
        self.assertTrue(decision.promotion_authorized)
        self.assertFalse(decision.enablement_permitted)
        self.assertEqual(
            decision.state,
            "PRODUCTION_ADMISSION_QUALIFIED__PROMOTION_AUTHORIZED__"
            "ENABLEMENT_REMAINS_SEPARATELY_BLOCKED",
        )

    def test_truthy_nonboolean_control_evidence_never_qualifies(self):
        # Parsed API, YAML, and environment values are not necessarily bools.
        # Truthiness must not turn the string "false" or integer 1 into proof.
        policy = ProductionAdmissionPolicy()
        for control in policy.required_controls:
            for value in ("false", "true", 1, b"true", {"verified": True}):
                with self.subTest(control=control, value=value):
                    evidence = replace(self._full_evidence(), **{control: value})
                    result = policy.assess(
                        evidence,
                        ProductionPromotionAuthorization(
                            approved=True,
                            authorization_id="chg-verified",
                            authorized_by="release-authority",
                        ),
                    )
                    self.assertFalse(result.technical_ready)
                    self.assertIn(control, result.missing_controls)
                    self.assertFalse(result.promotion_authorized)
                    self.assertFalse(result.enablement_permitted)
                    self.assertEqual(result.state, "PRODUCTION_ADMISSION_BLOCKED")

    def test_truthy_nonboolean_approval_is_not_promotion_authorization(self):
        policy = ProductionAdmissionPolicy()
        for approved in ("false", "true", 1, ["approved"], {"approved": True}):
            with self.subTest(approved=approved):
                result = policy.assess(
                    self._full_evidence(),
                    ProductionPromotionAuthorization(
                        approved=approved,
                        authorization_id="chg-verified",
                        authorized_by="release-authority",
                    ),
                )
                self.assertTrue(result.technical_ready)
                self.assertFalse(result.promotion_authorized)
                self.assertFalse(result.enablement_permitted)
                self.assertEqual(
                    result.state,
                    "PRODUCTION_ADMISSION_QUALIFIED__PROMOTION_AUTHORIZATION_REQUIRED",
                )

    def test_malformed_authorization_identity_fails_closed_without_crashing(self):
        policy = ProductionAdmissionPolicy()
        for field in ("authorization_id", "authorized_by"):
            for value in (1, True, None, ["identity"], {"identity": "x"}):
                with self.subTest(field=field, value=value):
                    fields = {
                        "approved": True,
                        "authorization_id": "chg-verified",
                        "authorized_by": "release-authority",
                    }
                    fields[field] = value
                    result = policy.assess(
                        self._full_evidence(),
                        ProductionPromotionAuthorization(**fields),
                    )
                    self.assertFalse(result.promotion_authorized)
                    self.assertFalse(result.enablement_permitted)
                    self.assertEqual(
                        result.state,
                        "PRODUCTION_ADMISSION_QUALIFIED__PROMOTION_AUTHORIZATION_REQUIRED",
                    )

    def test_partial_authorization_is_not_valid(self):
        decision=ProductionAdmissionPolicy().assess(
            self._full_evidence(),
            ProductionPromotionAuthorization(approved=True),
        )
        self.assertFalse(decision.promotion_authorized)
        self.assertFalse(decision.enablement_permitted)

if __name__=="__main__":
    unittest.main()
