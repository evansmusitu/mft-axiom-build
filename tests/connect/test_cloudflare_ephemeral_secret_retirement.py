"""Feature-branch credential-discovery workflows must be retired after observations."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
TEMPORARY = (
    '.github/workflows/musitu-connect-hosted-d1-stage-observe-feature.yml',
    '.github/workflows/musitu-cloudflare-existing-token-readonly-feature.yml',
)


class TemporaryCredentialWorkflowRetirementTests(unittest.TestCase):
    def test_feature_branch_does_not_retain_secret_using_push_workflows(self):
        for rel in TEMPORARY:
            with self.subTest(path=rel):
                self.assertFalse((ROOT / rel).exists(),
                                 'credential-bearing push workflow must be retired after evidence capture')

    def test_qualified_next_step_is_manual_main_only_and_non_enabling(self):
        doc = (ROOT / 'docs/operations/musitu-connect-cloudflare-stage-qualification-20261031.md')
        self.assertTrue(doc.is_file())
        text = doc.read_text(encoding='utf-8')
        for marker in ('41179878070', '41180311824',
                       'MUSITU_CF_STAGING_ACCOUNT_ID',
                       'MUSITU_CF_PRODUCTION_ACCOUNT_ID',
                       'MUSITU_CF_STAGING_DATABASE_ID',
                       'MUSITU_CF_STAGING_READ_TOKEN',
                       'NOT_DEMONSTRATED', 'no production D1 writes',
                       'musitu-connect-hosted-d1-readonly.yml'):
            with self.subTest(marker=marker):
                self.assertIn(marker, text)

if __name__ == '__main__':
    unittest.main()
