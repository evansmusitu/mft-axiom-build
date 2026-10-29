"""Legacy live Worker patch jobs must never be triggered by routine GitHub pushes."""
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[2]
DANGEROUS=[
    '.github/workflows/axiom-live-metering-durability-patch.yml',
    '.github/workflows/axiom-live-request-id-propagation-patch.yml',
    '.github/workflows/axiom-modal-edge-service-compat-patch.yml',
    '.github/workflows/axiom-metering-identity-diagnostic.yml',
]
MANUAL="if: github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'"

class LegacyPatchDispatchTests(unittest.TestCase):
    def test_live_worker_patch_jobs_are_manual_only(self):
        for rel in DANGEROUS:
            with self.subTest(workflow=rel):
                s=(ROOT/rel).read_text(encoding='utf-8')
                head=s.split('\njobs:\n',1)[0]
                self.assertIn('workflow_dispatch:',head)
                self.assertNotIn('\n  push:',head)
                self.assertNotIn('\n  pull_request:',head)
                self.assertNotIn('\n  schedule:',head)
                self.assertIn('permissions:\n  contents: read',head)
                self.assertEqual(s.count(MANUAL),1)

    def test_readonly_regression_workflow_covers_every_patch(self):
        s=(ROOT/'.github/workflows/musitu-ga-legacy-live-patch-guard.yml').read_text()
        self.assertIn("branches: ['main']",s)
        self.assertIn('pull_request:',s)
        self.assertIn('python -m unittest tests.connect.test_ga_legacy_live_patch_guard',s)
        for rel in DANGEROUS:
            self.assertEqual(s.count("'"+rel+"'"),2,rel)
        self.assertNotIn('secrets.',s)
        self.assertNotIn('CLOUDFLARE_GLOBAL_API_KEY',s)
        self.assertNotIn('workflow_dispatch:',s)

if __name__=='__main__':
    unittest.main()
