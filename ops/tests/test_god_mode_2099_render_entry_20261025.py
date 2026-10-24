"""Offline-only God Mode CLI routing contract; never invokes actual Blender/FFmpeg."""
from __future__ import annotations
import json, os, pathlib, subprocess, tempfile, unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
ENTRY = ROOT / 'creative' / 'god_mode_2099' / 'render.sh'
BUILDER = ROOT / 'creative' / 'god_mode_2099' / 'build_awaken_2099.py'

class GodModeRenderEntryTests(unittest.TestCase):
    def make_env(self, temp):
        tools = pathlib.Path(temp) / 'mock tools';tools.mkdir()
        # Only record argv; never load Blender or invoke a real video encoder.
        mock = '''#!/usr/bin/env python3
import os,sys,json
with open(os.environ['MOCK_LOG'],'a') as out:
 out.write(json.dumps({'program':os.path.basename(sys.argv[0]),'args':sys.argv[1:]})+'\\n')
'''
        blend=tools/'blender fake';blend.write_text(mock);blend.chmod(0o755)
        ffmpeg=tools/'ffmpeg';ffmpeg.write_text(mock);ffmpeg.chmod(0o755)
        env=os.environ.copy();env['BLENDER']=str(blend)
        env['MOCK_LOG']=str(pathlib.Path(temp)/'calls.jsonl')
        env['PATH']=str(tools)+os.pathsep+env.get('PATH','')
        return env
    def run_entry(self,temp,*args):
        env=self.make_env(temp)
        proc=subprocess.run(['bash',str(ENTRY),*args],cwd=temp,env=env,
                            capture_output=True,text=True,timeout=8)
        log=pathlib.Path(env['MOCK_LOG'])
        calls=[json.loads(x) for x in log.read_text().splitlines()] if log.exists() else []
        return proc,calls
    def test_invoked_from_foreign_cwd_uses_real_checked_in_builder_path(self):
        self.assertTrue(BUILDER.is_file())
        with tempfile.TemporaryDirectory() as temp:
            out=str(pathlib.Path(temp)/'offline out'/'2099.blend')
            frames=str(pathlib.Path(temp)/'frames for Android')
            proc,calls=self.run_entry(temp,'preview',out,frames)
            self.assertEqual(proc.returncode,0,proc.stderr)
            self.assertEqual(len(calls),3)
            first=calls[0]['args'];self.assertIn('--python',first)
            self.assertEqual(first[first.index('--python')+1],str(BUILDER))
            self.assertEqual(first[first.index('--output')+1],out)
            self.assertIn('-a',calls[1]['args'])
            self.assertIn('30',calls[2]['args'])
            self.assertTrue(pathlib.Path(out).parent.is_dir())
            self.assertTrue(pathlib.Path(frames).is_dir())
    def test_invalid_mode_fails_without_starting_any_renderer(self):
        with tempfile.TemporaryDirectory() as temp:
            proc,calls=self.run_entry(temp,'production-deploy')
            self.assertNotEqual(proc.returncode,0)
            self.assertEqual(calls,[])

if __name__=='__main__':unittest.main()
