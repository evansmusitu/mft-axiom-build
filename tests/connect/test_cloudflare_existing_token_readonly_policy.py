"""No legacy Cloudflare credential can run arbitrary repository code or mutate production."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / '.github/workflows/musitu-cloudflare-existing-token-readonly-feature.yml'

class ExistingCloudflareTokenPolicy(unittest.TestCase):
    def test_only_exact_repo_branch_push_can_verify_existing_token(self):
        source = WORKFLOW.read_text(encoding='utf-8')
        self.assertIn("branches: ['feat/musitu-commercial-ga-phase123-evidence-20261031']", source)
        self.assertIn("github.ref == 'refs/heads/feat/musitu-commercial-ga-phase123-evidence-20261031'", source)
        self.assertIn("github.repository == 'evansmusitu/mft-axiom-build'", source)
        self.assertIn('permissions:\n  contents: read', source)
        self.assertIn('https://api.cloudflare.com/client/v4/accounts/93f395f5121954671f92fffa453d6b61/tokens/verify', source)
        self.assertIn("method='GET'", source)
        self.assertIn('https://api.cloudflare.com/client/v4/accounts/93f395f5121954671f92fffa453d6b61/d1/database?page=1&per_page=10', source)
        self.assertIn('CLOUDFLARE_D1_METADATA=ACCESSIBLE_PRODUCTION_ACCOUNT_ONLY', source)
        self.assertEqual(source.count('${{ secrets.CLOUDFLARE_API_TOKEN }}'), 1)
        for forbidden in ('CLOUDFLARE_GLOBAL_API_KEY', 'wrangler', '/d1/database/',
                          '/workers/', 'exec(', 'eval(', 'subprocess', 'shell=True',
                          'workflow_dispatch:', 'pull_request:', 'contents: write',
                          'POST', 'PUT', 'PATCH', 'DELETE'):
            self.assertNotIn(forbidden, source)

    def test_secret_job_does_not_checkout_or_execute_repository_files(self):
        source = WORKFLOW.read_text(encoding='utf-8')
        job = source.split('\n  token-verify:\n', 1)[1]
        self.assertNotIn('actions/checkout', job)
        self.assertNotIn('python -m ', job)
        self.assertIn('needs: [policy]', job)
        self.assertIn('CLOUDFLARE_READONLY_TOKEN=ACTIVE_NOT_STAGING_QUALIFIED', job)
        self.assertNotIn('print(doc)', job)
        self.assertNotIn('print(token)', job)

if __name__ == '__main__':
    unittest.main()
