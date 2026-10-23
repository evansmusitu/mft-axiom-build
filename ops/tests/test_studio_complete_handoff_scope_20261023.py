"""Regression: complete Studio archives must retain actual editor tests and Blender proof."""
import importlib.util
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('studio_handoff_builder',ROOT/'ops/studio_build_new_chat_handoff_20261020.py')
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class CompleteHandoffScopeTests(unittest.TestCase):
    def test_editor_export_production_test_included(self):
        self.assertTrue(mod.select('ops/tests/test_studio_offline_keyframe_export_20261022.py'))
        self.assertTrue(mod.select('ops/tests/test_studio_complete_handoff_scope_20261023.py'))
    def test_isolated_blender_proof_included(self):
        self.assertTrue(mod.select('creative/god_mode_2099/build_awaken_2099.py'))
        self.assertTrue(mod.select('creative/god_mode_2099/render.sh'))
        self.assertTrue(mod.select('.github/workflows/god-mode-2099-full-cycles-preview.yml'))
    def test_no_unrelated_axiom_or_secrets(self):
        for p in ['axiom_private/secrets.py','.env','creative/another_project/main.py',
                  'ops/tests/test_non_studio.py','.github/workflows/deploy-main.yml']:
            with self.subTest(path=p):self.assertFalse(mod.select(p))
if __name__=='__main__':unittest.main()
