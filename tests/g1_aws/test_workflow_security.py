"""Negative fixtures exercise dangerous credential, token and artifact boundaries."""
import pathlib
import tempfile
import unittest

from ops.g1_aws.workflow_security import audit

SAFE = '''name: fixture
on: {pull_request: {branches: [main]}}
permissions: {contents: read}
concurrency: {group: fixture, cancel-in-progress: true}
jobs:
  check:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5
        with: {persist-credentials: false}
      - run: python -m unittest
'''


class WorkflowBoundaryTests(unittest.TestCase):
    def check_fixture(self, text):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            directory = root / '.github/workflows'
            directory.mkdir(parents=True)
            (directory / 'test.yml').write_text(text)
            return audit(root)

    def test_read_only_unprivileged_pr_is_allowed(self):
        self.assertTrue(self.check_fixture(SAFE)['passed'])

    def test_unpinned_action_is_rejected(self):
        self.assertFalse(self.check_fixture(SAFE.replace('34e114876b0b11c390a56381ad16ebd13914f8d5', 'v4'))['passed'])

    def test_persisted_checkout_credentials_are_rejected(self):
        self.assertFalse(self.check_fixture(SAFE.replace('persist-credentials: false', 'persist-credentials: true'))['passed'])

    def test_privileged_pr_code_cannot_receive_a_secret(self):
        changed = SAFE.replace('run: python -m unittest', 'run: python -m unittest\n        env: {TOKEN: "${{ secrets.PROVIDER_TOKEN }}"}')
        self.assertFalse(self.check_fixture(changed)['passed'])

    def test_untrusted_privileged_trigger_and_unbounded_token_are_rejected(self):
        self.assertFalse(self.check_fixture(SAFE.replace('pull_request:', 'pull_request_target:'))['passed'])
        self.assertFalse(self.check_fixture(SAFE.replace('{contents: read}', 'write-all'))['passed'])

    def test_root_artifact_upload_is_rejected(self):
        changed = SAFE + '''      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02
        with: {path: '.', include-hidden-files: true}
'''
        self.assertFalse(self.check_fixture(changed)['passed'])

    def test_repository_workflows_satisfy_static_boundary_rules(self):
        result = audit()
        self.assertTrue(result['passed'], result['errors'])
        self.assertGreaterEqual(result['workflow_count'], 222)
