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
import os,sys,json,pathlib,struct,zlib
if os.path.basename(sys.argv[0]).startswith('blender') and os.environ.get('MOCK_BLENDER_SLEEP'):
 import time
 time.sleep(float(os.environ['MOCK_BLENDER_SLEEP']))
if '--python' in sys.argv and os.environ.get('MOCK_SCENE_POLICY')!='missing':
 args=sys.argv
 out=pathlib.Path(args[args.index('--output')+1])
 if os.environ.get('MOCK_SCENE_POLICY')=='symlink':
  out.symlink_to(os.environ['MOCK_SCENE_SYMLINK_TARGET'])
 else:out.write_bytes(b'offline-synthetic-blend-model')
if '-a' in sys.argv:
 args=sys.argv
 prefix=args[args.index('-o')+1].replace('####','{number:04d}')+'.png'
 omit=180 if os.environ.get('MOCK_FRAME_POLICY')=='missing' else None
 for n in range(1,361):
  if n!=omit:
   frame=pathlib.Path(prefix.format(number=n))
   if n==180 and os.environ.get('MOCK_FRAME_POLICY')=='symlink':
    frame.symlink_to(os.environ['MOCK_FRAME_SYMLINK_TARGET'])
   else:
    width,height=(1080,1920) if os.environ.get('MOCK_PRESET')=='final' else (360,640)
    if n==180 and os.environ.get('MOCK_FRAME_POLICY')=='wrong-size': width+=1
    body=struct.pack('>IIBBBBB',width,height,8,2,0,0,0)
    ihdr=b'IHDR'+body
    data=b'\\x89PNG\\r\\n\\x1a\\n'+struct.pack('>I',13)+ihdr+struct.pack('>I',zlib.crc32(ihdr))
    if n==180 and os.environ.get('MOCK_FRAME_POLICY')=='invalid-header':data=b'not-an-image'
    frame.write_bytes(data)
if os.path.basename(sys.argv[0])=='ffmpeg' and os.environ.get('MOCK_VIDEO_POLICY')!='missing':
 pathlib.Path(sys.argv[-1]).write_bytes(b'fake-mp4')
with open(os.environ['MOCK_LOG'],'a') as out:
 out.write(json.dumps({'program':os.path.basename(sys.argv[0]),'args':sys.argv[1:]})+'\\n')
if os.path.basename(sys.argv[0])=='ffprobe':
 if '-of json' in ' '.join(sys.argv):
  stream={'codec_name':os.environ.get('MOCK_PROBE_CODEC','h264'),
          'width':int(os.environ.get('MOCK_PROBE_WIDTH','360')),
          'height':int(os.environ.get('MOCK_PROBE_HEIGHT','640')),
          'pix_fmt':os.environ.get('MOCK_PROBE_PIXEL','yuv420p'),
          'r_frame_rate':os.environ.get('MOCK_PROBE_FPS','30/1'),
          'avg_frame_rate':os.environ.get('MOCK_PROBE_AVG_FPS','30/1')}
  print(json.dumps({'streams':[stream]}))
 elif 'stream=nb_read_frames' in ' '.join(sys.argv):
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
            self.assertEqual(len(calls),6)
            first=calls[0]['args'];self.assertIn('--python',first)
            self.assertEqual(first[first.index('--python')+1],str(BUILDER))
            self.assertEqual(first[first.index('--output')+1],out)
            self.assertIn('-a',calls[1]['args'])
            self.assertIn('30',calls[2]['args'])
            self.assertTrue(pathlib.Path(out).parent.is_dir())
            self.assertTrue(pathlib.Path(frames).is_dir())
    def test_verified_movie_writes_non_overwriting_local_sha256_receipt(self):
        with tempfile.TemporaryDirectory() as temp:
            scene=pathlib.Path(temp)/'Scene.blend'
            frames=pathlib.Path(temp)/'frames'
            env=self.make_env(temp)
            run=subprocess.run(['bash',str(ENTRY),'preview',str(scene),str(frames)],
                               cwd=temp,env=env,capture_output=True,text=True,timeout=12)
            self.assertEqual(run.returncode,0,run.stderr)
            video=pathlib.Path(temp)/'GOD_MODE_AWAKENING_2099_preview.mp4'
            receipt=pathlib.Path(str(video)+'.verified.json')
            self.assertTrue(receipt.is_file(),'successful render must provide verifiable SHA-256 release receipt')
            data=json.loads(receipt.read_text())
            self.assertEqual(data['schema'],'musitu.studio.v03.godmode-local-release.v1')
            self.assertFalse(data['provider_verified'])
            self.assertEqual(data['scene']['file_name'],'Scene.blend')
            self.assertEqual(data['video']['file_name'],video.name)
            self.assertEqual(data['declared_frame_count'],360)
            validator=ROOT/'creative/god_mode_2099/release_receipt_2099.py'
            verify=subprocess.run(['python3',str(validator),'verify',str(receipt),str(scene),str(video)],
                                  cwd=temp,capture_output=True,text=True,timeout=8)
            self.assertEqual(verify.returncode,0,verify.stderr)
            video.write_bytes(b'modified-movie')
            tampered=subprocess.run(['python3',str(validator),'verify',str(receipt),str(scene),str(video)],
                                  cwd=temp,capture_output=True,text=True,timeout=8)
            self.assertNotEqual(tampered.returncode,0,'mutated movie must not match the receipt')

    def test_existing_receipt_never_triggers_blender_or_gets_overwritten(self):
        with tempfile.TemporaryDirectory() as temp:
            prior=pathlib.Path(temp)/'GOD_MODE_AWAKENING_2099_preview.mp4.verified.json'
            prior.write_bytes(b'previous-owner-proof')
            result,calls=self.run_entry(temp,'preview')
            self.assertNotEqual(result.returncode,0)
            self.assertEqual(calls,[])
            self.assertEqual(prior.read_bytes(),b'previous-owner-proof')

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
            self.assertEqual(len(calls),6)
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

    def test_invalid_png_header_never_reaches_encoder(self):
        with tempfile.TemporaryDirectory() as temp:
            env=self.make_env(temp);env['MOCK_FRAME_POLICY']='invalid-header'
            proc=subprocess.run(['bash',str(ENTRY),'preview'],cwd=temp,env=env,
                                capture_output=True,text=True,timeout=10)
            calls=[json.loads(x) for x in pathlib.Path(env['MOCK_LOG']).read_text().splitlines()]
            self.assertNotEqual(proc.returncode,0,'non-PNG image must fail before video encoding')
            self.assertIn('PNG',proc.stderr)
            self.assertEqual(len(calls),2,'FFmpeg must never see a corrupt PNG header')

    def test_wrong_frame_resolution_never_reaches_encoder(self):
        with tempfile.TemporaryDirectory() as temp:
            env=self.make_env(temp);env['MOCK_FRAME_POLICY']='wrong-size'
            proc=subprocess.run(['bash',str(ENTRY),'preview'],cwd=temp,env=env,
                                capture_output=True,text=True,timeout=10)
            calls=[json.loads(x) for x in pathlib.Path(env['MOCK_LOG']).read_text().splitlines()]
            self.assertNotEqual(proc.returncode,0,'wrong PNG dimensions must fail before expensive FFmpeg')
            self.assertIn('dimension',proc.stderr.lower())
            self.assertEqual(len(calls),2)

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

    def test_blender_success_without_editable_scene_does_not_render_video(self):
        with tempfile.TemporaryDirectory() as temp:
            env=self.make_env(temp)
            env['MOCK_SCENE_POLICY']='missing'
            proc=subprocess.run(['bash',str(ENTRY),'preview'],cwd=temp,env=env,
                                capture_output=True,text=True,timeout=15)
            log=pathlib.Path(env['MOCK_LOG'])
            calls=[json.loads(x) for x in log.read_text().splitlines()] if log.exists() else []
            self.assertNotEqual(proc.returncode,0)
            self.assertIn('scene',proc.stderr.lower())
            self.assertEqual(len(calls),1,'do not start animation or encoding without a saved .blend')

    def test_symlinked_editable_scene_cannot_qualify_video_render(self):
        with tempfile.TemporaryDirectory() as temp:
            env=self.make_env(temp)
            target=pathlib.Path(temp)/'unrelated-original-scene.blend'
            target.write_bytes(b'private-original-unrelated-model')
            env['MOCK_SCENE_POLICY']='symlink'
            env['MOCK_SCENE_SYMLINK_TARGET']=str(target)
            proc=subprocess.run(['bash',str(ENTRY),'preview'],cwd=temp,env=env,
                                capture_output=True,text=True,timeout=15)
            self.assertNotEqual(proc.returncode,0)
            self.assertIn('scene',proc.stderr.lower())
            logs=pathlib.Path(env['MOCK_LOG']).read_text().splitlines()
            self.assertEqual(len(logs),1)
            self.assertEqual(target.read_bytes(),b'private-original-unrelated-model')

    def test_renderer_symlink_frame_is_never_passed_to_video_encoder(self):
        with tempfile.TemporaryDirectory() as temp:
            env=self.make_env(temp)
            secret=pathlib.Path(temp)/'never-encode-this-external-file.txt'
            secret.write_bytes(b'protected-unrelated-local-bytes')
            env['MOCK_FRAME_POLICY']='symlink'
            env['MOCK_FRAME_SYMLINK_TARGET']=str(secret)
            proc=subprocess.run(['bash',str(ENTRY),'preview'],cwd=temp,env=env,
                                capture_output=True,text=True,timeout=15)
            calls=[json.loads(x) for x in pathlib.Path(env['MOCK_LOG']).read_text().splitlines()]
            self.assertNotEqual(proc.returncode,0)
            self.assertIn('frame',proc.stderr.lower())
            self.assertEqual(len(calls),2,'must reject symlink frame before FFmpeg')
            self.assertEqual(secret.read_bytes(),b'protected-unrelated-local-bytes')

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

# Red-first regression cases: 360 decoded frames over 12.00 seconds can still
# be wrong-resolution, wrong-codec, or wrong-frame-rate media.
class GodModeEncodedStreamContractTests(unittest.TestCase):
    make_env=GodModeRenderEntryTests.make_env
    def test_wrong_codec_is_not_a_qualified_2099_movie(self):
        with tempfile.TemporaryDirectory() as temp:
            env=self.make_env(temp);env['MOCK_PROBE_CODEC']='hevc'
            proc=subprocess.run(['bash',str(ENTRY),'preview'],cwd=temp,env=env,
                                capture_output=True,text=True,timeout=25)
            self.assertNotEqual(proc.returncode,0,'only the declared H.264 output qualifies')
            self.assertIn('codec',proc.stderr.lower())
    def test_wrong_dimensions_do_not_qualify(self):
        with tempfile.TemporaryDirectory() as temp:
            env=self.make_env(temp);env['MOCK_PROBE_WIDTH']='128'
            proc=subprocess.run(['bash',str(ENTRY),'preview'],cwd=temp,env=env,
                                capture_output=True,text=True,timeout=25)
            self.assertNotEqual(proc.returncode,0,'vertical preview must be 360x640')
            self.assertIn('codec',proc.stderr.lower())
    def test_wrong_video_fps_does_not_qualify(self):
        with tempfile.TemporaryDirectory() as temp:
            env=self.make_env(temp);env['MOCK_PROBE_FPS']='25/1'
            proc=subprocess.run(['bash',str(ENTRY),'preview'],cwd=temp,env=env,
                                capture_output=True,text=True,timeout=25)
            self.assertNotEqual(proc.returncode,0,'360 frames must be encoded at 30fps')
            self.assertIn('codec',proc.stderr.lower())

class GodModeDeliveryFrameRateTests(unittest.TestCase):
    make_env=GodModeRenderEntryTests.make_env
    def test_average_frame_rate_is_not_allowed_to_disagree_with_declared_30fps(self):
        with tempfile.TemporaryDirectory() as temp:
            env=self.make_env(temp);env['MOCK_PROBE_AVG_FPS']='25/1'
            proc=subprocess.run(['bash',str(ENTRY),'preview'],cwd=temp,env=env,
                                capture_output=True,text=True,timeout=25)
            self.assertEqual(proc.returncode,8)
            self.assertIn('codec',proc.stderr.lower())
    def test_final_mode_is_checked_against_1080_by_1920_not_preview_dimensions(self):
        with tempfile.TemporaryDirectory() as temp:
            env=self.make_env(temp);env['MOCK_PROBE_WIDTH']='1080'
            env['MOCK_PROBE_HEIGHT']='1920'
            env['MOCK_PRESET']='final'
            proc=subprocess.run(['bash',str(ENTRY),'final'],cwd=temp,env=env,
                                capture_output=True,text=True,timeout=25)
            self.assertEqual(proc.returncode,0,proc.stderr)

if __name__=='__main__':unittest.main()
