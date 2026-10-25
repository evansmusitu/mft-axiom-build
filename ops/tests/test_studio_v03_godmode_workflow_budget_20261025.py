"""Offline contract: expensive God Mode renders need deliberate dispatch."""
from __future__ import annotations
import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
FILES = [
    ROOT / '.github/workflows/god-mode-2099-blender-qualification.yml',
    ROOT / '.github/workflows/god-mode-2099-full-cycles-preview.yml',
]
CHECKOUT = '11bd71901bbe5b1630ceea73d27597364c9af683'
UPLOAD = 'ea165f8d65b6e75b540449e92b4886f43607fa02'

class GodModeWorkflowBudgetTests(unittest.TestCase):
    def test_both_cpu_heavy_workflows_are_manual_only(self):
        for path in FILES:
            with self.subTest(path=path.name):
                txt=path.read_text()
                self.assertRegex(txt, r'(?m)^on:\s*\n  workflow_dispatch:')
                self.assertNotRegex(txt, r'(?m)^  push:|^  schedule:|^  pull_request:')
                self.assertIn('permissions:\n  contents: read',txt)
                self.assertNotIn('secrets.',txt)
                self.assertNotIn('modal ',txt.lower())
                self.assertNotIn('wrangler deploy',txt.lower())

    def test_dependency_actions_are_sha_pinned_and_tokens_never_persist(self):
        for path in FILES:
            with self.subTest(path=path.name):
                txt=path.read_text()
                self.assertIn(f'actions/checkout@{CHECKOUT}',txt)
                self.assertIn(f'actions/upload-artifact@{UPLOAD}',txt)
                self.assertIn('persist-credentials: false',txt)
                uses=re.findall(r'(?m)^\s*(?:-\s*)?uses:\s*([^\s#]+)',txt)
                self.assertEqual(len(uses),2)
                self.assertTrue(all(re.fullmatch(r'[^@\s]+@[0-9a-f]{40}',v) for v in uses))

    def test_render_execution_is_time_bounded(self):
        for path in FILES:
            with self.subTest(path=path.name):
                txt=path.read_text()
                times=[int(v) for v in re.findall(r'(?m)^\s*timeout-minutes: (\d+)',txt)]
                self.assertTrue(times)
                self.assertLessEqual(max(times),75)
                self.assertIn('cancel-in-progress: true',txt)

if __name__=='__main__': unittest.main()
