import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[3]
WORKFLOW=ROOT/'.github/workflows/axiom-trackb-openhands-ecc-requalification-s0-20261022.yml'

class WorkflowAuthorityTests(unittest.TestCase):
    def test_shallow_checkout_cannot_validate_an_older_parent(self):
        text=WORKFLOW.read_text(encoding='utf-8')
        self.assertIn('git merge-base --is-ancestor c57cf8505ceee91a6b9b93ae6368f54c6b9ae127 HEAD',text)
        checkout=text.split('actions/checkout@')[1].split('- uses: actions/setup-node@')[0]
        self.assertIn('fetch-depth: 0',checkout)
    def test_git_auth_does_not_persist(self):
        self.assertIn('persist-credentials: false',WORKFLOW.read_text())
if __name__=='__main__':unittest.main()
