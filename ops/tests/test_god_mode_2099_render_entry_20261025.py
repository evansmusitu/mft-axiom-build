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
import os,sys,json,pathlib
if '-a' in sys.argv:
 args=sys.argv
 prefix=args[args.index('-o')+1].replace('####','{number:04d}')+'.png'
 omit=180 if os.environ.get('MOCK_FRAME_POLICY')=='missing' else None
 for n in range(1,361):
  if n!=omit:pathlib.Path(prefix.format(number=n)).write_bytes(b'fakepng')
if os.path.basename(sys.argv[0])=='ffmpeg' and os.environ.get('MOCK_VIDEO_POLICY')!='missing':
 pathlib.Path(sys.argv[-1]).write_bytes(b'fake-mp4')
with open(os.environ['MOCK_LOG'],'a') as out:
 out.write(json.dumps({'program':os.path.basename(sys.argv[0]),'args':sys.argv[1:]})+'\\n')
if os.path.basename(sys.argv[0])=='ffprobe':
 sys.stdout.write(os.environ.get('MOCK_PROBE_DURATION','12.000000')+'\\n')
'''
        blend=tools/'blender fake';blend.write_text(mock);blend.chmod(0o755)
        ffmpeg=tools/'ffmpeg';ffmpeg.write_text(mock);ffmpeg.chmod(0o755)
        ffprobe=tools/'ffprobe';ffprobe.write_text(mock);ffprobe.chmod(0o755)
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
            self.assertEqual(len(calls),4)
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


    def test_invalid_thread_budget_rejected_without_starting_paid_or_local_jobs(self):
        for value in ('0','9','999','4;echoBAD','-1'):
            with self.subTest(threads=value),tempfile.TemporaryDirectory() as temp:
                env=self.make_env(temp);env['BLENDER_THREADS']=value
                proc=subprocess.run(['bash',str(ENTRY),'preview'],cwd=temp,env=env,
                                    capture_output=True,text=True,timeout=8)
                log=pathlib.Path(env['MOCK_LOG'])
                self.assertNotEqual(proc.returncode,0)
                self.assertFalse(log.exists(),'no local renderer may run with invalid quota')

    def test_custom_output_folder_keeps_final_video_beside_blend_and_respects_thread_cap(self):
        with tempfile.TemporaryDirectory() as temp:
            home=pathlib.Path(temp)/'owner outputs'
            out=str(home/'Awakened.blend')
            proc,calls=self.run_entry(temp,'preview',out,str(home/'frames'))
            self.assertEqual(proc.returncode,0,proc.stderr)
            self.assertEqual(len(calls),4)
            final=calls[2]['args'][-1]
            self.assertEqual(calls[-1]['program'],'ffprobe')
            self.assertEqual(final,str(home/'GOD_MODE_AWAKENING_2099_preview.mp4'))
            self.assertIn('4',calls[0]['args'])

    def test_missing_frame_rejects_video_before_ffmpeg(self):
        with tempfile.TemporaryDirectory() as temp:
            env=self.make_env(temp);env['MOCK_FRAME_POLICY']='missing'
            proc=subprocess.run(['bash',str(ENTRY),'preview'],cwd=temp,env=env,
                                capture_output=True,text=True,timeout=8)
            calls=[json.loads(x) for x in pathlib.Path(env['MOCK_LOG']).read_text().splitlines()]
            self.assertNotEqual(proc.returncode,0)
            self.assertEqual(len(calls),2,'must never encode a partial 12-second video')
            self.assertIn('frame',proc.stderr.lower())

    def test_existing_video_refused_before_any_expensive_blender_calls(self):
        with tempfile.TemporaryDirectory() as temp:
            video=pathlib.Path(temp)/'GOD_MODE_AWAKENING_2099_preview.mp4'
            video.write_bytes(b'previous finished production video')
            proc,calls=self.run_entry(temp,'preview')
            self.assertNotEqual(proc.returncode,0)
            self.assertEqual(calls,[])
            self.assertEqual(video.read_bytes(),b'previous finished production video')

    def test_existing_blend_refused_before_any_expensive_blender_calls(self):
        with tempfile.TemporaryDirectory() as temp:
            blend=pathlib.Path(temp)/'already.blend';blend.write_bytes(b'valuable model')
            proc,calls=self.run_entry(temp,'preview',str(blend))
            self.assertNotEqual(proc.returncode,0)
            self.assertEqual(calls,[])
            self.assertEqual(blend.read_bytes(),b'valuable model')

    def test_silent_encoder_success_without_written_video_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            env=self.make_env(temp);env['MOCK_VIDEO_POLICY']='missing'
            proc=subprocess.run(['bash',str(ENTRY),'preview'],cwd=temp,env=env,
                                capture_output=True,text=True,timeout=8)
            calls=[json.loads(x) for x in pathlib.Path(env['MOCK_LOG']).read_text().splitlines()]
            self.assertNotEqual(proc.returncode,0,'renderer must prove final MP4 materialized')
            self.assertEqual(len(calls),3)

    def test_video_with_wrong_duration_cannot_be_declared_complete(self):
        with tempfile.TemporaryDirectory() as temp:
            env=self.make_env(temp);env['MOCK_PROBE_DURATION']='11.500000'
            proc=subprocess.run(['bash',str(ENTRY),'preview'],cwd=temp,env=env,
                                capture_output=True,text=True,timeout=8)
            self.assertNotEqual(proc.returncode,0,'a short video is not a 12-second render')
            self.assertIn('duration',proc.stderr.lower())

    def test_declared_scene_duration_is_exactly_12_seconds_without_real_renderer(self):
        import ast
        tree=ast.parse(BUILDER.read_text())
        vals={}
        for node in tree.body:
            if isinstance(node,ast.Assign) and len(node.targets)==1 and isinstance(node.targets[0],ast.Name):
                if node.targets[0].id in ('FPS','FRAME_END'):
                    vals[node.targets[0].id]=ast.literal_eval(node.value)
        self.assertEqual(vals,{'FPS':30,'FRAME_END':360})
        self.assertEqual(vals['FRAME_END']/vals['FPS'],12)

if __name__=='__main__':unittest.main()
