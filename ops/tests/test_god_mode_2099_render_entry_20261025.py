"""Offline-only God Mode CLI routing contract; never invokes actual Blender/FFmpeg."""
from __future__ import annotations
import json, os, pathlib, subprocess, tempfile, unittest, time

ROOT = pathlib.Path(__file__).resolve().parents[2]
ENTRY = ROOT / 'creative' / 'god_mode_2099' / 'render.sh'
BUILDER = ROOT / 'creative' / 'god_mode_2099' / 'build_awaken_2099.py'

class GodModeRenderEntryTests(unittest.TestCase):
    def make_env(self, temp):
        tools = pathlib.Path(temp) / 'mock tools';tools.mkdir()
        # Only record argv; never load Blender or invoke a real video encoder.
        mock = '''#!/usr/bin/env python3
import os,sys,json,pathlib
if os.path.basename(sys.argv[0]).startswith('blender') and os.environ.get('MOCK_BLENDER_SLEEP'):
 import time
 time.sleep(float(os.environ['MOCK_BLENDER_SLEEP']))
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
 if 'stream=nb_read_frames' in ' '.join(sys.argv):
  sys.stdout.write(os.environ.get('MOCK_PROBE_FRAMES','360')+'\\n')
 else:
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
            self.assertEqual(len(calls),5)
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
            self.assertEqual(len(calls),5)
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

    def test_exact_duration_with_missing_encoded_video_frame_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            env=self.make_env(temp);env['MOCK_PROBE_FRAMES']='359'
            proc=subprocess.run(['bash',str(ENTRY),'preview'],cwd=temp,env=env,
                                capture_output=True,text=True,timeout=8)
            self.assertNotEqual(proc.returncode,0,'360 source images do not prove 360 encoded frames')
            self.assertIn('frame',proc.stderr.lower())

    def test_missing_encoded_video_stream_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            env=self.make_env(temp);env['MOCK_PROBE_FRAMES']='N/A'
            result=subprocess.run(['bash',str(ENTRY),'preview'],cwd=temp,env=env,
                                  capture_output=True,text=True,timeout=8)
            self.assertEqual(result.returncode,7)
            self.assertIn('exactly 360 frames',result.stderr)

    def test_extra_encoded_video_stream_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            env=self.make_env(temp);env['MOCK_PROBE_FRAMES']='360\n360'
            result=subprocess.run(['bash',str(ENTRY),'preview'],cwd=temp,env=env,
                                  capture_output=True,text=True,timeout=8)
            self.assertEqual(result.returncode,7)
            self.assertIn('exactly 360 frames',result.stderr)

    def test_running_render_exclusively_reserves_frame_directory_before_blender(self):
        with tempfile.TemporaryDirectory() as temp:
            env=self.make_env(temp)
            env['MOCK_BLENDER_SLEEP']='0.5'
            out=str(pathlib.Path(temp)/'first.blend')
            frames=str(pathlib.Path(temp)/'shared_frames')
            first=subprocess.Popen(['bash',str(ENTRY),'preview',out,frames],
                cwd=temp,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
            try:
                lock=pathlib.Path(frames)/'.musitu_2099_render.lock'
                deadline=time.monotonic()+3
                while not lock.exists() and time.monotonic()<deadline:
                    if first.poll() is not None:break
                    time.sleep(0.015)
                self.assertTrue(lock.is_dir(),'the first Blender invocation must hold the atomic lock')
                second=subprocess.run(['bash',str(ENTRY),'preview',
                    str(pathlib.Path(temp)/'second.blend'),frames],cwd=temp,env=env,
                    capture_output=True,text=True,timeout=20)
                self.assertNotEqual(second.returncode,0)
                self.assertIn('lock',second.stderr.lower())
                stdout,stderr=first.communicate(timeout=45)
                self.assertEqual(first.returncode,0,stderr)
                self.assertFalse(lock.exists(),'successful render releases its own lock')
            finally:
                if first.poll() is None:
                    first.kill();first.communicate()

    def test_distinct_frame_directories_cannot_race_on_same_scene_output(self):
        with tempfile.TemporaryDirectory() as temp:
            env=self.make_env(temp);env['MOCK_BLENDER_SLEEP']='0.45'
            scene=str(pathlib.Path(temp)/'valuable_scene.blend')
            first=subprocess.Popen(['bash',str(ENTRY),'preview',scene,
                str(pathlib.Path(temp)/'frames_a')],cwd=temp,env=env,
                stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
            try:
                time.sleep(.15)
                second=subprocess.run(['bash',str(ENTRY),'preview',scene,
                    str(pathlib.Path(temp)/'frames_b')],cwd=temp,env=env,
                    capture_output=True,text=True,timeout=15)
                self.assertNotEqual(second.returncode,0,'parallel launch may not clobber the same .blend')
                self.assertIn('lock',second.stderr.lower())
                _,stderr=first.communicate(timeout=20)
                self.assertEqual(first.returncode,0,stderr)
                self.assertFalse(pathlib.Path(scene+'.musitu_2099.lock').exists())
            finally:
                if first.poll() is None:first.kill();first.communicate()

    def test_distinct_scene_paths_cannot_race_on_same_video_destination(self):
        with tempfile.TemporaryDirectory() as temp:
            env=self.make_env(temp);env['MOCK_BLENDER_SLEEP']='0.45'
            first=subprocess.Popen(['bash',str(ENTRY),'preview',
                str(pathlib.Path(temp)/'first.blend'),str(pathlib.Path(temp)/'frames_a')],
                cwd=temp,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
            try:
                time.sleep(.15)
                second=subprocess.run(['bash',str(ENTRY),'preview',
                    str(pathlib.Path(temp)/'second.blend'),str(pathlib.Path(temp)/'frames_b')],
                    cwd=temp,env=env,capture_output=True,text=True,timeout=15)
                self.assertNotEqual(second.returncode,0,'parallel launch may not race to encode one MP4')
                self.assertIn('lock',second.stderr.lower())
                _,stderr=first.communicate(timeout=20)
                self.assertEqual(first.returncode,0,stderr)
                video=pathlib.Path(temp)/'GOD_MODE_AWAKENING_2099_preview.mp4'
                self.assertTrue(video.is_file())
                self.assertFalse(pathlib.Path(str(video)+'.musitu_2099.lock').exists())
            finally:
                if first.poll() is None:first.kill();first.communicate()

    def test_stale_render_lock_never_allows_blender_and_is_not_removed(self):
        with tempfile.TemporaryDirectory() as temp:
            env=self.make_env(temp)
            frames=pathlib.Path(temp)/'frames'; frames.mkdir()
            lock=frames/'.musitu_2099_render.lock';lock.mkdir()
            proc=subprocess.run(['bash',str(ENTRY),'preview',
                str(pathlib.Path(temp)/'render.blend'),str(frames)],cwd=temp,env=env,
                capture_output=True,text=True,timeout=8)
            self.assertNotEqual(proc.returncode,0)
            self.assertTrue(lock.is_dir(),'never delete an existing operator lock')
            self.assertFalse(pathlib.Path(env['MOCK_LOG']).exists(),
                'the Blender process must never start under a foreign lock')

    def test_foreign_scene_and_video_locks_are_never_removed(self):
        with tempfile.TemporaryDirectory() as temp:
            env=self.make_env(temp)
            output=pathlib.Path(temp)/'scene.blend'
            video=pathlib.Path(temp)/'GOD_MODE_AWAKENING_2099_preview.mp4'
            for target in (output,video):
                with self.subTest(resource=target.name):
                    foreign=pathlib.Path(str(target)+'.musitu_2099.lock')
                    foreign.mkdir()
                    result=subprocess.run(['bash',str(ENTRY),'preview',str(output),
                        str(pathlib.Path(temp)/'frames')],cwd=temp,env=env,
                        capture_output=True,text=True,timeout=12)
                    self.assertNotEqual(result.returncode,0)
                    self.assertIn('lock',result.stderr.lower())
                    self.assertTrue(foreign.is_dir())
                    self.assertFalse(pathlib.Path(env['MOCK_LOG']).exists())
                    foreign.rmdir()

    def test_failed_render_cleans_only_its_own_scene_video_and_frame_locks(self):
        with tempfile.TemporaryDirectory() as temp:
            env=self.make_env(temp);env['MOCK_FRAME_POLICY']='missing'
            output=pathlib.Path(temp)/'scene.blend'
            video=pathlib.Path(temp)/'GOD_MODE_AWAKENING_2099_preview.mp4'
            frames=pathlib.Path(temp)/'frames'
            result=subprocess.run(['bash',str(ENTRY),'preview',str(output),str(frames)],
                cwd=temp,env=env,capture_output=True,text=True,timeout=15)
            self.assertNotEqual(result.returncode,0)
            for lock in (pathlib.Path(str(output)+'.musitu_2099.lock'),
                         pathlib.Path(str(video)+'.musitu_2099.lock'),
                         frames/'.musitu_2099_render.lock'):
                self.assertFalse(lock.exists(),f'only newly held lock can be removed: {lock}')
            self.assertTrue((frames/'frame_0001.png').is_file(),
                            'never erase the partial output after a failed render')

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
