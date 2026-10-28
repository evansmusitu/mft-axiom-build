"""The PR38 offline CI is isolated, source-only and not an approval to deploy."""
import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / '.github/workflows/studio-v03-pr38-offline-proof-20261028.yml'
BRANCH = 'experiments/studio-v03-offline-test-reliability-20261027'

class IsolatedOfflineProofContract(unittest.TestCase):
    def test_push_only_for_exact_isolated_branch(self):
        yaml = WORKFLOW.read_text()
        self.assertIn('on:\n  push:\n    branches:\n      - '+BRANCH+'\n',yaml)
        self.assertIn("'.github/workflows/studio-v03-pr38-offline-proof-20261028.yml'",yaml)
        for forbidden in ('workflow_dispatch:','pull_request_target:','schedule:','repository_dispatch:','workflow_run:'):
            self.assertNotIn(forbidden,yaml)
        self.assertIn("assert os.environ['GITHUB_REF_NAME']=='"+BRANCH+"'",yaml)

    def test_no_provider_tokens_or_writes(self):
        yaml = WORKFLOW.read_text().lower()
        self.assertIn('permissions:\n  contents: read',yaml)
        self.assertIn('persist-credentials: false',yaml)
        self.assertIn('runs-on: ubuntu-24.04',yaml)
        self.assertIn('timeout-minutes: 12',yaml)
        for forbidden in ('secrets.', 'cloudflare_api_token', 'neon_api_key',
                          'modal_token', 'wrangler ', 'neonctl', 'modal deploy',
                          'curl ', 'npm install', 'npm ci', 'docker ',
                          'actions/upload-artifact','contents: write','id-token: write'):
            self.assertNotIn(forbidden,yaml,forbidden)
        self.assertEqual(len(re.findall(r'(?m)^\s*-\s*uses:',yaml)),3)
        self.assertTrue(all(re.fullmatch(r'[\w./-]+@[a-f0-9]{40}',x)
          for x in re.findall(r'(?m)^\s*-\s*uses:\s*([^\s#]+)',yaml)))

    def test_qualification_includes_every_offline_suite(self):
        yaml = WORKFLOW.read_text()
        for command in (
            'node --test musitu_studio/neon/tests/*.test.mjs',
            'node --test musitu_studio/edge/tests/v03_glb_*.test.mjs musitu_studio/edge/tests/v03_scene_preview.test.mjs',
            "python -m unittest discover -s ops/tests -p 'test_studio_*.py' -v",
            'result = qualify(Path.cwd(), group_size=3, timeout_seconds=150)'):
            self.assertIn(command,yaml)
        for name in ('session.test.mjs','validation.test.mjs',
                     'v03_do_adapter.test.mjs','v03_scene_import_submission.test.mjs',
                     'v03_pitr_cron_diagnostic.test.mjs'):
            self.assertIn('musitu_studio/edge/tests/'+name,yaml)
        self.assertNotIn('remote_r2_modal_real.mjs',yaml)
        self.assertNotIn("python -m unittest discover -s ops/tests -p 'test_god_mode_2099_*.py'",yaml)

if __name__=='__main__':
    unittest.main()
