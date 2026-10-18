"""Prevent API-specific emulator CI from collecting incompatible OS tests."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[3]
WORKFLOW_DIR = ROOT / '.github' / 'workflows'

class DeviceSuiteScopeTest(unittest.TestCase):
    def check_test_selection(self, workflow: str, expected: str) -> None:
        source = (WORKFLOW_DIR / workflow).read_text(encoding='utf-8')
        executions = [line.strip() for line in source.splitlines()
                      if re.search(r'\bgradle\b.*:app:connectedDebugAndroidTest', line)
                      and not line.strip().startswith('#')]
        self.assertEqual(len(executions), 1,
                         f'{workflow} must invoke the emulator suite exactly once')
        self.assertIn('-Pandroid.testInstrumentationRunnerArguments.class=' + expected,
                      executions[0], f'{workflow} must select only its target-API tests')
        self.assertNotIn('com.musitu.store.V2AndroidApi30VisibilityTest', executions[0],
                         f'{workflow} must not run API30 assertions on older Android')

    def test_api24_selects_only_matching_install_tests(self):
        self.check_test_selection('musitu-store-v2-api24-consent-install.yml',
            'com.musitu.store.V2RealApkInstrumentedTest,com.musitu.store.V2UserConsentInstallerTest')

    def test_api26_selects_only_api26_tests(self):
        self.check_test_selection('musitu-store-v2-api26-permission.yml',
            'com.musitu.store.V2AndroidApi26PermissionTest')

if __name__ == '__main__':
    unittest.main()
