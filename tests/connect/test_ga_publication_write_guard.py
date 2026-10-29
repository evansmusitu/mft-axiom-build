"""Review packages cannot autonomously publish source or deploy live MCP/OAuth.

Non-enabling CI: source reviews and externally approved rollout remain separate.
"""
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[2]
REVIEW_WORKFLOWS=['.github/workflows/axiom-chatgpt-app-submission-package.yml','.github/workflows/axiom-oauth-userinfo-v2-rollout.yml','.github/workflows/axiom-plugin-docs-publication-fix.yml']
GUARD="if: github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'"

class PublicPackageWriteGuardTests(unittest.TestCase):
    def test_review_package_workflows_do_not_push_to_main_or_deploy(self):
        for rel in REVIEW_WORKFLOWS:
            with self.subTest(path=rel):
                s=(ROOT/rel).read_text(encoding='utf-8')
                h=s.split('\njobs:\n')[0]
                self.assertIn('  workflow_dispatch:',h)
                self.assertNotIn('\n  push:',h)
                self.assertNotIn('\n  schedule:',h)
                self.assertNotIn('\n  pull_request:',h)
                self.assertIn('permissions:\n  contents: read',h)
                self.assertNotIn('contents: write',s)
                self.assertNotIn('git push',s)
                self.assertNotIn('CLOUDFLARE_GLOBAL_API_KEY',s)
                self.assertNotIn('wrangler deploy',s)
                self.assertIn('actions/upload-artifact@v4',s)
                self.assertEqual(s.count(GUARD),1)

    def test_non_enabling_ci_rechecks_repository_write_policy(self):
        f=(ROOT/'.github/workflows/musitu-ga-publication-package-guard.yml').read_text()
        self.assertIn('pull_request:',f)
        self.assertIn("branches: ['main']",f)
        self.assertIn('python -m unittest tests.connect.test_ga_publication_write_guard',f)
        for path in REVIEW_WORKFLOWS:
            self.assertEqual(f.count("'"+path+"'"),2,path)
        self.assertNotIn('secrets.',f)
        self.assertNotIn('workflow_dispatch:',f)

if __name__=='__main__':
    unittest.main()
