import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SOURCE=Path(__file__).resolve().parents[1] / 'studio_v03_export_offline_keyframe_editor_20261022.py'

class OfflineKeyframeExportTests(unittest.TestCase):
    def test_content_has_controls_but_no_cloud_submission(self):
        spec=importlib.util.spec_from_file_location('studio_offline',SOURCE)
        mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
        text=mod.render()
        for expected in ('id="scene-track-set"','id="scene-track-remove"','id="scene-undo"',
                         'id="scene-redo"','Validate locally (no submission)','connect-src \'none\''):
            self.assertIn(expected,text)
        self.assertNotIn('<script src=',text)
        self.assertNotIn('Submit for controlled approval →</button>',text)
        self.assertNotIn('id="project-select"',text)
        self.assertNotIn('id="device"',text)
        self.assertIn('createSceneHistory',text)
        self.assertIn('setRotationTrack',text)

    def test_cli_build_deterministic_and_offline(self):
        with tempfile.TemporaryDirectory() as tmp:
            a,b=Path(tmp)/'first.html',Path(tmp)/'second.html'
            for output in (a,b):
                subprocess.run([sys.executable,str(SOURCE),'--output',str(output)],
                               check=True,capture_output=True,text=True)
            self.assertEqual(a.read_bytes(),b.read_bytes())
            self.assertLess(a.stat().st_size,131072)

if __name__=='__main__':unittest.main()
