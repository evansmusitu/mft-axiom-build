"""No automatic Cloudflare production mutation on source changes.

This tests the *workflow dispatch boundary*, not authority to launch.
Real provider credentials, legal approvals and human signoff remain external.
"""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
PRIVILEGED = ['.github/workflows/axiom-d1-canonical-migration.yml','.github/workflows/axiom-d1-production-provision.yml','.github/workflows/axiom-mcp-production-deploy-v2.yml','.github/workflows/axiom-mcp-production-deploy.yml','.github/workflows/axiom-modal-edge-isolated-deploy.yml','.github/workflows/axiom-modal-musitu-parallel-deploy.yml','.github/workflows/axiom-modal-private-deploy.yml','.github/workflows/axiom-modal-production-deploy.yml','.github/workflows/axiom-oauth-production-deploy.yml','.github/workflows/axiom-production-custom-domain-cutover.yml','.github/workflows/axiom-production-entitlement-and-d1-gate.yml','.github/workflows/axiom-real-money-certification-checkout-initiate.yml','.github/workflows/cloudflare-axiom-bootstrap-enable.yml','.github/workflows/cloudflare-axiom-bootstrap.yml','.github/workflows/cloudflare-axiom-stage-domain.yml','.github/workflows/cloudflare-axiom-stage-security-exception.yml','.github/workflows/axiom-cloudflare-staging-deploy-v2.yml','.github/workflows/axiom-cloudflare-staging-deploy.yml','.github/workflows/axiom-musitu-cloudflare-compat-aliases.yml','.github/workflows/musitu-connect-production-runtime-enablement.yml','.github/workflows/axiom-mcp-oauth-gate-v3-cutover-v2.yml','.github/workflows/axiom-mcp-oauth-gate-v3-cutover-v3.yml','.github/workflows/axiom-mcp-oauth-gate-v3-cutover.yml','.github/workflows/axiom-modal-stage-domain-auth-final-v2.yml','.github/workflows/axiom-modal-stage-domain-promotion-v2.yml','.github/workflows/axiom-modal-stage-domain-promotion.yml','.github/workflows/axiom-musitu-d1-live-cutover.yml','.github/workflows/axiom-musitu-modal-backend-cutover.yml','.github/workflows/axiom-musitu-stage-domain-cutover.yml','.github/workflows/axiom-plugin-gate-v4-cutover-v2.yml','.github/workflows/axiom-plugin-gate-v4-cutover-v3.yml','.github/workflows/axiom-plugin-gate-v4-cutover.yml','.github/workflows/axiom-mcp-auth-metering-e2e.yml']
GUARD = "if: github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'"

class PrivilegedDeploymentTriggerTests(unittest.TestCase):
    def test_each_privileged_deployment_is_manual_reviewed_main_only(self):
        for name in PRIVILEGED:
            with self.subTest(path=name):
                content=(ROOT/name).read_text(encoding='utf-8')
                header=content.split('\njobs:\n',1)[0]
                self.assertIn('  workflow_dispatch:',header)
                for unsafe in ('  push:', '  pull_request:', '  schedule:'):
                    self.assertNotIn('\n'+unsafe,header)
                job_lines=re.findall(r'(?m)^  ([a-zA-Z0-9_-]+):$',content.split('\njobs:\n',1)[1])
                self.assertGreater(len(job_lines),0)
                self.assertEqual(content.count(GUARD),len(job_lines),
                                 'Every job with provider credentials must be main-only')
                self.assertIn('permissions:\n  contents: read',header)

    def test_regression_ci_is_noncredentialed_and_covers_all_changed_workflows(self):
        wf=(ROOT/'.github/workflows/musitu-ga-privileged-deploy-safety.yml').read_text(encoding='utf-8')
        self.assertIn('pull_request:',wf)
        self.assertIn("branches: ['main']",wf)
        self.assertIn('python -m unittest tests.connect.test_ga_privileged_deploy_workflows',wf)
        for name in PRIVILEGED:
            self.assertEqual(wf.count("'"+name+"'"),2,name)
        for forbidden in ('CLOUDFLARE_GLOBAL_API_KEY', 'CLOUDFLARE_API_TOKEN',
                          'PAYNOW_INTEGRATION_KEY','workflow_dispatch:','wrangler deploy'):
            self.assertNotIn(forbidden,wf)

if __name__ == '__main__':
    unittest.main()
