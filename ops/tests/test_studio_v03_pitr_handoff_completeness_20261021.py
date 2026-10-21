import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from studio_build_new_chat_handoff_20261020 import select

class HandoffCompleteness(unittest.TestCase):
    def test_python_pitr_security_regression_tests_are_exported(self):
        for filename in (
            'ops/tests/test_studio_v03_pitr_disposable_cleanup_20261021.py',
            'ops/tests/test_studio_v03_pitr_runner_guards_20261021.py',
            'ops/tests/test_studio_v03_pitr_handoff_completeness_20261021.py'):
            self.assertTrue(select(filename),filename+' must be in the cross-chat handoff')
    def test_not_all_unrelated_repository_ops_or_tests_are_exported(self):
        self.assertFalse(select('ops/tests/test_unrelated_private_account.py'))
        self.assertFalse(select('ops/passwords.txt'))
    def test_existing_studio_source_is_still_exported(self):
        self.assertTrue(select('musitu_studio/edge/src/v03_entry.mjs'))
        self.assertTrue(select('ops/studio_v03_disposable_safety_20261021.py'))
