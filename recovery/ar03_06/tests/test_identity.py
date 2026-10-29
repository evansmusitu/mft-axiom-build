import tempfile
import unittest
from pathlib import Path

from recovery.ar03_06.common import AuthenticationError, AuthorizationError
from recovery.ar03_06.runtime import CandidateRuntime


SECRET = b"candidate-test-secret-not-for-production"


class IdentityOnboardingContractTests(unittest.TestCase):
    def test_self_service_onboarding_key_oauth_recovery_and_audit_chain(self):
        with tempfile.TemporaryDirectory(prefix="axiom-ar03-") as td:
            database = Path(td) / "candidate.sqlite3"
            runtime = CandidateRuntime(database, secret_key=SECRET)
            registration = runtime.onboard(
                "owner@example.test",
                "CorrectHorseBatteryStaple!2026",
                "Synthetic Research",
            )
            self.assertTrue(database.is_file())
            self.assertEqual(registration["role"], "owner")
            self.assertIn("axiom.safe_task.execute", registration["entitlements"])
            self.assertTrue(registration["session_token"])

            context = runtime.identity.authenticate(registration["session_token"])
            self.assertEqual(context.organization_id, registration["organization_id"])
            self.assertEqual(context.authority_source, "SERVER_SESSION")

            oauth = runtime.identity.link_oauth(
                registration["session_token"], "chatgpt", "subject-123", ["axiom.execute"]
            )
            self.assertFalse(oauth["token_material_stored"])

            issued = runtime.identity.issue_api_key(
                registration["session_token"], "local-candidate", ["axiom.safe.execute"]
            )
            self.assertTrue(issued["secret_once"].startswith("axk_"))
            api_context = runtime.identity.authenticate_api_key(issued["secret_once"])
            self.assertEqual(api_context.organization_id, registration["organization_id"])
            self.assertEqual(api_context.authority_source, "SERVER_API_KEY")

            self.assertEqual(runtime.identity.verify_audit(registration["organization_id"])["status"], "PASS")
            recovery = runtime.identity.request_recovery("owner@example.test")
            runtime.identity.complete_recovery(
                recovery["token_once"], "StrongerReplacementPassword!2026"
            )
            with self.assertRaises(AuthenticationError):
                runtime.identity.authenticate(registration["session_token"])
            with self.assertRaises(AuthenticationError):
                runtime.identity.authenticate_api_key(issued["secret_once"])
            replacement = runtime.identity.login(
                "owner@example.test", "StrongerReplacementPassword!2026"
            )
            self.assertEqual(replacement["user_id"], registration["user_id"])
            self.assertEqual(runtime.identity.verify_audit(registration["organization_id"])["status"], "PASS")
            runtime.close()

    def test_cross_tenant_and_revoked_entitlement_fail_closed(self):
        with tempfile.TemporaryDirectory(prefix="axiom-ar03-") as td:
            runtime = CandidateRuntime(Path(td) / "candidate.sqlite3", secret_key=SECRET)
            one = runtime.onboard("one@example.test", "LongPasswordOne!2026", "One")
            two = runtime.onboard("two@example.test", "LongPasswordTwo!2026", "Two")
            with self.assertRaises(AuthorizationError):
                runtime.submit_arithmetic(
                    one["session_token"], two["project_id"], "1+1", idempotency_key="cross-tenant"
                )
            runtime.identity.set_entitlement(
                one["session_token"], "axiom.safe_task.execute", active=False
            )
            with self.assertRaises(AuthorizationError):
                runtime.submit_arithmetic(
                    one["session_token"], one["project_id"], "1+1", idempotency_key="revoked"
                )
            self.assertEqual(
                runtime.submit_arithmetic(
                    two["session_token"], two["project_id"], "3*7", idempotency_key="allowed"
                )["result"],
                21,
            )
            runtime.close()


if __name__ == "__main__":
    unittest.main()
