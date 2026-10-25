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


    def test_godmode_script_and_mock_tests_trigger_offline_qualification(self):
        source=CI.read_text()
        self.assertIn("'creative/god_mode_2099/**'",source)
        self.assertIn("'ops/tests/test_god_mode_2099_*.py'",source)
        self.assertIn("'ops/studio_v03_*.py'",source)
        self.assertIn("python -m unittest discover -s ops/tests -p 'test_god_mode_2099_*.py' -v",source)
        self.assertIn("'musitu_studio/edge/src/**'",source)


    def test_local_only_edge_security_subset_explicitly_qualified(self):
        source=CI.read_text()
        for name in ('session.test.mjs','validation.test.mjs',
                     'v03_do_adapter.test.mjs','v03_scene_import_submission.test.mjs',
                     'v03_pitr_cron_diagnostic.test.mjs'):
            self.assertIn('musitu_studio/edge/tests/'+name,source)
        self.assertIn('Pure offline Edge identity-independent and client submission tests',source)
        self.assertNotIn('remote_r2_modal_real.mjs',source)


    def test_supply_chain_actions_are_immutable_and_checkout_token_not_persisted(self):
        import re
        source=CI.read_text()
        pins={
            'actions/checkout':'11bd71901bbe5b1630ceea73d27597364c9af683',
            'actions/setup-node':'49933ea5288caeca8642d1e84afbd3f7d6820020',
            'actions/setup-python':'a26af69be951a213d495a4c3e4e4022e16d87065',
        }
        for action,sha in pins.items():
            self.assertIn(f'uses: {action}@{sha}',source)
        self.assertIn('persist-credentials: false',source)
        uses=re.findall(r'(?m)^\s*-\s*uses:\s*([^\s#]+)',source)
        self.assertEqual(len(uses),3)
        self.assertTrue(all(re.fullmatch(r'[^@\s]+@[0-9a-f]{40}',use) for use in uses))

if __name__=='__main__':
    unittest.main()
