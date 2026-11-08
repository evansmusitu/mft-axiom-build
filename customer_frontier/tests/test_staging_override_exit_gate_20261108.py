"""Credential-free acceptance regression for the exact-host staging Cloudflare candidate.

This file runs in the existing isolated customer-frontier test gate.
It mocks all Cloudflare access: NO API keys, provider requests, or writes.
"""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "qualification"))
import staging_override_newtoken as candidate


class StagingHealthExitGate(unittest.TestCase):
    def invoke(self, status, attempted=()):
        # The helper never calls a network service: both the token-accepting
        # client and the whole provider run are replaced before main executes.
        receipt = {
            "status": status,
            "production_oauth_touched": False,
            "customer_identity_qualified": False,
            "release_qualified": False,
        }
        client = SimpleNamespace(attempted=list(attempted))
        with tempfile.TemporaryDirectory() as tmp:
            old = os.getcwd()
            try:
                os.chdir(tmp)
                with patch.object(candidate, "Client", return_value=client), patch.object(
                    candidate, "run", return_value=receipt
                ):
                    code = candidate.main()
                observed = json.loads(Path("axiom-staging-configuration-oneuse.json").read_text())
                self.assertFalse(observed["release_qualified"])
                self.assertFalse(observed["customer_identity_qualified"])
                self.assertFalse(observed["production_oauth_touched"])
                return code, observed
            finally:
                os.chdir(old)

    def test_edge_challenge_pending_must_fail_ci_even_if_rule_was_published(self):
        # Regression: the prior CLI returned success (0) while HTTPS was still
        # challenged/403. It must retain evidence but NOT green-light the gate.
        code, receipt = self.invoke("HOST_RULE_PUBLISHED_HTTPS_PENDING", ("ONE_LIVE_PUT",))
        self.assertEqual(receipt["status"], "HOST_RULE_PUBLISHED_HTTPS_PENDING")
        self.assertNotEqual(code, 0)
        self.assertFalse(receipt["ambiguous_live_write"])

    def test_only_full_200_health_and_two_503_auth_denials_can_pass_cli(self):
        code, receipt = self.invoke("EXACT_STAGE_HTTPS_200_AND_AUTH_503_PASS", ("ONE_LIVE_PUT",))
        self.assertEqual(code, 0)
        self.assertFalse(receipt["release_qualified"])

    def test_unknown_provider_write_result_remains_failed_and_flagged(self):
        code, receipt = self.invoke("PROVIDER_WRITE_READBACK_MISMATCH_REVIEW_REQUIRED", ("ONE_LIVE_PUT",))
        self.assertNotEqual(code, 0)
        self.assertTrue(receipt["ambiguous_live_write"])


if __name__ == "__main__":
    unittest.main()
