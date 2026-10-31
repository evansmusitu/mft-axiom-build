"""Static security contract for one-shot dedicated staging secrets observation."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / '.github/workflows/musitu-connect-hosted-d1-stage-observe-feature.yml'
BRANCH = 'feat/musitu-commercial-ga-phase123-evidence-20261031'
BASE = '06cc5f74fb066c11f8d81390f424e58a2f9c261a'


class StagingReadOnlyWorkflowPolicy(unittest.TestCase):
    def test_staging_workflow_is_branch_scoped_and_not_production_mutating(self):
        src = WORKFLOW.read_text(encoding='utf-8')
        self.assertIn("branches: ['" + BRANCH + "']", src)
        self.assertIn('permissions:\n  contents: read', src)
        self.assertIn("github.ref == 'refs/heads/" + BRANCH + "'", src)
        self.assertIn("github.repository == 'evansmusitu/mft-axiom-build'", src)
        for prohibited in ('CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_GLOBAL_API_KEY',
                           'CLOUDFLARE_EMAIL', 'wrangler', 'd1 execute',
                           'INSERT INTO', 'DELETE FROM', 'UPDATE ', 'DROP TABLE',
                           'contents: write', 'workflow_dispatch:', 'pull_request:'):
            self.assertNotIn(prohibited, src)
        self.assertIn('python qualification/probe_connect_hosted_d1.py', src)
        self.assertIn('python -m unittest tests.connect.test_hosted_d1_readonly', src)

    def test_only_dedicated_staging_credentials_and_pinned_probe_can_run(self):
        src = WORKFLOW.read_text(encoding='utf-8')
        stage_secrets = (
            'MUSITU_CF_STAGING_ACCOUNT_ID',
            'MUSITU_CF_PRODUCTION_ACCOUNT_ID',
            'MUSITU_CF_STAGING_DATABASE_NAME',
            'MUSITU_CF_STAGING_DATABASE_ID',
            'MUSITU_CF_STAGING_READ_TOKEN',
        )
        for key in stage_secrets:
            self.assertIn('${{ secrets.' + key + ' }}', src)
        self.assertEqual(src.count('ref: ' + BASE), 1)
        self.assertIn('persist-credentials: false', src)
        self.assertIn('if-no-files-found: error', src)
        self.assertIn('hosted-d1-readonly-evidence.json', src)
        self.assertIn("needs: [policy]", src)

if __name__ == '__main__':
    unittest.main()
