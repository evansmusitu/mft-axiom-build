"""Safety contract for the new offline-only Studio security qualification.

No Cloudflare / Neon / Modal token is ever required by this workflow.
This does not qualify hosted provider infrastructure or full Edge runtime tests.
"""
import pathlib
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[2]
CI=ROOT/'.github/workflows/studio-v03-offline-security-qualification-20261024.yml'

class OfflineCIContract(unittest.TestCase):
    def test_narrow_scoped_branch_and_read_only_token(self):
        source=CI.read_text()
        self.assertIn('experiments/studio-enterprise-v03-sqlite-do-20261018',source)
        self.assertIn('permissions:\n  contents: read',source)
        self.assertNotIn('contents: write',source)
        self.assertIn('cancel-in-progress: false',source)
        self.assertIn("'musitu_studio/neon/**'",source)

    def test_all_studio_offline_suites_included(self):
        source=CI.read_text()
        for cmd in [
            'node --test musitu_studio/neon/tests/*.test.mjs',
            'node --test musitu_studio/edge/tests/v03_glb_*.test.mjs',
            "python -m unittest discover -s ops/tests -p 'test_studio_*.py' -v",
        ]:
            self.assertIn(cmd,source)
        self.assertIn('v03_scene_preview.test.mjs',source)

    def test_forbidden_provider_writes_and_token_injection_absent(self):
        source=CI.read_text().lower()
        for forbidden in ['secrets.', 'cloudflare_api_token', 'neon_api_key',
            'modal_token', 'wrangler deploy', 'neonctl',
            'curl ', 'npm install', 'npm ci', 'docker ', 'actions/upload-artifact']:
            self.assertNotIn(forbidden,source,forbidden)

if __name__=='__main__':
    unittest.main()
