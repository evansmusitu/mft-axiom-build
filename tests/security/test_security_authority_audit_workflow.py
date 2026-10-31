"""Static S0 threat guard for AXIOM Cloudflare secret-backed read-only audit.

These tests prove source structure only. They do not certify GitHub environment
protection, Cloudflare account independence, MFA, B27 or deployment safety.
"""
from pathlib import Path
import re
import unittest

ROOT=Path(__file__).resolve().parents[2]
FILE=ROOT/".github/workflows/axiom-security-authority-secret-readonly-20261031.yml"

class SecurityAuthorityWorkflowSafety(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source=FILE.read_text(encoding="utf-8")
        cls.job=cls.source.split("\n  provider-account-readonly:\n",1)[1]

    def test_no_automatic_push_credentials(self):
        self.assertNotRegex(self.source, r"(?m)^  push:\s*$")
        self.assertIn("  pull_request:",self.source)
        self.assertIn("  workflow_dispatch:",self.source)

    def test_only_main_manual_job_can_receive_secrets(self):
        header=self.job.split("\n    env:\n",1)[0]
        self.assertRegex(header,r"if:\s*github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'")
        self.assertNotIn("secrets.",self.source.split("\n  provider-account-readonly:\n",1)[0])

    def test_readonly_secret_scoping(self):
        self.assertIn("secrets.MUSITU_CF_STAGING_READ_TOKEN",self.job)
        self.assertIn("secrets.MUSITU_CF_STAGING_ACCOUNT_ID",self.job)
        self.assertNotIn("secrets.CLOUDFLARE_GLOBAL_API_KEY",self.source)
        self.assertNotIn("secrets.CLOUDFLARE_API_TOKEN",self.source)

    def test_static_review_has_no_credentialed_steps(self):
        static=self.source.split("\n  static-review:\n",1)[1].split("\n  provider-account-readonly:\n",1)[0]
        self.assertIn("github.event_name == 'pull_request'",static)
        self.assertIn("persist-credentials: false",static)
        self.assertNotIn("secrets.",static)

    def test_provider_queries_get_only_and_fail_closed(self):
        self.assertIn("method='GET'",self.job)
        for fragment in ["method='POST'","method='PUT'","method='PATCH'","method='DELETE'"]:
            self.assertNotIn(fragment,self.job)
        self.assertIn("ACCOUNT_METADATA_GET_NOT_AUTHORIZED_OR_NOT_VERIFIED",self.job)
        self.assertIn("REQUIRED_STAGING_GITHUB_SECRETS_MISSING",self.job)

    def test_no_self_authorized_release_or_b27_upgrade(self):
        for status in [
            "'independent_custody_certified':False",
            "'operator_mfa_certified':False",
            "'independent_b27_rollback_certified':False",
            "'b27_historical_status':'FAILED_IN_SYNTHETIC_ATTACK'",
            "'release_authorized':False",
        ]: self.assertIn(status,self.job)

if __name__=="__main__":
    unittest.main()
