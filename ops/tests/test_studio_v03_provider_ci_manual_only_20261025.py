"""Non-provider, source-only regression contract for two historic Studio workflows.

A push must not initiate a Cloudflare-token provider probe or a larger handoff
job. Manual dispatch is a permission to request verification, not authorization
for any deployment, production cutover or billable rendering.
"""
from __future__ import annotations
import pathlib
import re
import unittest
import json

ROOT = pathlib.Path(__file__).resolve().parents[2]
WORKFLOWS = {
    'studio-complete-new-chat-handoff-20261020.yml': 12,
    'studio-v03-release-readonly-qualification-20261022.yml': 4,
}
ALLOWED_ACTIONS = {'actions/checkout', 'actions/setup-node',
                   'actions/setup-python', 'actions/upload-artifact'}


class ProviderCIRequiresManualDispatch(unittest.TestCase):
    def test_provider_secret_workflows_never_auto_trigger_on_branch_changes(self):
        for filename in WORKFLOWS:
            with self.subTest(filename=filename):
                content = (ROOT / '.github/workflows' / filename).read_text()
                self.assertIn('secrets.CLOUDFLARE_API_TOKEN', content)
                self.assertRegex(content, r'(?m)^on:\s*\n\s+workflow_dispatch:')
                # These are not valid if any auto trigger is still present.
                self.assertNotRegex(content, r'(?m)^\s{2}(?:push|pull_request|schedule|workflow_run):')
                self.assertIn('permissions: {contents: read}', content)
                self.assertNotRegex(content, r'(?mi)^\s+contents:\s*write')
                self.assertNotIn('wrangler deploy', content.lower())
                self.assertNotIn('modal deploy', content.lower())

    def test_workflows_pin_actions_and_checkout_never_persists_credentials(self):
        for filename in WORKFLOWS:
            with self.subTest(filename=filename):
                content = (ROOT / '.github/workflows' / filename).read_text()
                uses = re.findall(r'(?m)^\s*-\s*uses:\s*([^\s#]+)', content)
                self.assertTrue(uses, 'must enumerate all dependencies')
                self.assertTrue(all(re.fullmatch(r'([^@]+)@[a-f0-9]{40}', v) for v in uses),uses)
                self.assertTrue(all(x.split('@')[0] in ALLOWED_ACTIONS for x in uses), uses)
                self.assertIn('persist-credentials: false', content)

    def test_cheap_neon_source_contract_remains_offline_and_sha_pinned(self):
        neon = (ROOT / '.github/workflows/studio-v03-neon-schema-contract-20261021.yml').read_text()
        self.assertIn('on:\n  push:',neon)
        self.assertIn('permissions: {contents: read}',neon)
        self.assertNotIn('secrets.',neon)
        self.assertNotIn('wrangler deploy',neon.lower())
        self.assertIn('persist-credentials: false',neon)
        uses = re.findall(r'(?m)^\s*-\s*uses:\s*([^\s#]+)',neon)
        self.assertEqual(len(uses),2)
        self.assertTrue(all(re.fullmatch(r'[^@]+@[a-f0-9]{40}',u) for u in uses))

    def test_manual_handoff_assembles_exact_sha_pinned_edge_lockfile(self):
        import sys
        sys.path.insert(0,str(ROOT/'ops'))
        from studio_v03_restore_edge_lockfile import verify_lock_bytes, EXPECTED_SHA256
        self.assertEqual(EXPECTED_SHA256,
            '10f3c5d53d27ee3743a8e507089eb937af73f4a2c672573bdae958c9a3c5c9df')
        raw = verify_lock_bytes(ROOT)
        manifest = json.loads((ROOT / 'musitu_studio/edge/package.json').read_text())
        locked = json.loads(raw)
        self.assertEqual(locked['lockfileVersion'], 3)
        self.assertEqual(locked['packages']['']['dependencies'],manifest['dependencies'])
        self.assertEqual(locked['packages']['']['devDependencies'],manifest['devDependencies'])
        workflow = (ROOT / '.github/workflows/studio-complete-new-chat-handoff-20261020.yml').read_text()
        self.assertIn('python ops/studio_v03_restore_edge_lockfile.py', workflow)
        self.assertIn('npm ci --ignore-scripts --no-audit --no-fund', workflow)
        self.assertNotIn('npm install', workflow)

    def test_locked_dependency_fragments_reject_any_modified_byte(self):
        import sys
        from tempfile import TemporaryDirectory
        from shutil import copy2
        sys.path.insert(0,str(ROOT/'ops'))
        from studio_v03_restore_edge_lockfile import verify_lock_bytes
        with TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            dest = root/'ops/verified_edge_lock_parts';dest.mkdir(parents=True)
            for source in (ROOT/'ops/verified_edge_lock_parts').glob('*.part'):
                copy2(source,dest/source.name)
            first = dest/'edge-lock-v3.000.part'
            raw = first.read_bytes()
            first.write_bytes(bytes([raw[0]^1])+raw[1:])
            with self.assertRaisesRegex(ValueError,'LOCK_SHA256_MISMATCH'):
                verify_lock_bytes(root)

    def test_changed_pinned_lock_fragments_trigger_offline_qualification(self):
        ci = (ROOT / '.github/workflows/studio-v03-offline-security-qualification-20261024.yml').read_text()
        self.assertIn("'ops/verified_edge_lock_parts/**'",ci)
        self.assertIn("'ops/studio_v03_*.py'",ci)
        self.assertNotIn('secrets.',ci)

    def test_workflows_bound_compute_and_skip_on_plain_code_push(self):
        for filename, maximum_minutes in WORKFLOWS.items():
            with self.subTest(filename=filename):
                content = (ROOT / '.github/workflows' / filename).read_text()
                minutes = [int(v) for v in re.findall(r'(?m)^\s+timeout-minutes:\s*(\d+)',content)]
                self.assertTrue(minutes)
                self.assertLessEqual(max(minutes),maximum_minutes)
                self.assertIn('cancel-in-progress: false', content)


if __name__ == '__main__':
    unittest.main()
