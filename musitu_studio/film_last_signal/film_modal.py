"""Dedicated private film app. Never changes existing Studio apps."""
import modal,pathlib,subprocess,tempfile,hashlib,json,shutil,os,sys,re,time
HERE=pathlib.Path(__file__).resolve().parent
ARCHIVE='blender-4.5.14-linux-x64.tar.xz'
DIGEST='9ba871ff2ecd36526b77432745980b7e6664ecd0c7ca11c48849073dcfe06da3'
BLENDER='/opt/blender-4.5.14-linux-x64/blender'
app=modal.App('musitu-studio-last-signal-20261126')
volume=modal.Volume.from_name('musitu-studio-last-signal-20261126',create_if_missing=True)
image=(modal.Image.debian_slim(python_version='3.11')
    .apt_install('curl','xz-utils','libx11-6','libxkbcommon0','libxi6','libxrender1','libxfixes3','libgl1','libegl1','libsm6','libglib2.0-0','libxext6','libxrandr2','libxinerama1','libxcursor1','libgomp1','ffmpeg')
    .run_commands("set -e; cd /opt; curl -fLsS --retry 3 --max-time 180 -o "+ARCHIVE+" https://download.blender.org/release/Blender4.5/"+ARCHIVE+"; echo '"+DIGEST+"  "+ARCHIVE+"' | sha256sum -c -; tar -xJf "+ARCHIVE+"; rm "+ARCHIVE)
    .pip_install('Pillow==11.3.0','numpy==2.2.6')
    .add_local_dir(HERE,'/opt/film',copy=True)
    .add_local_file(HERE.parents[1]/'creative/god_mode_2099/build_awaken_2099.py','/opt/film/build_awaken_2099.py',copy=True))
def root(run):
    if not re.fullmatch('[0-9a-f]{40}',run):raise ValueError('commit sha required')
    return pathlib.Path('/film')/run
def sha(p):
    with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def write_json(p,obj):
    t=p.with_suffix('.tmp');t.write_text(json.dumps(obj,sort_keys=True,indent=2)+'\n');os.replace(t,p)
def command(args,timeout):
    return subprocess.run(args,check=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=timeout).stdout
def validate(folder,a,b,scene_hash):
    sys.path.insert(0,'/opt/film')
    from contract import validate_receipt
    from PIL import Image
    rec=json.loads((folder/'receipt.json').read_text());validate_receipt(rec,a,b)
    if rec['scene_sha256']!=scene_hash or rec['gpu_peak_utilization']<=0 or sha(folder/'render.log')!=rec['log_sha256']:raise ValueError('GPU evidence mismatch')
    if {p.name for p in folder.glob('*.png')}!={f'frame_{f:06d}.png' for f in range(a,b+1)}:raise ValueError('frame set mismatch')
    for entry in rec['frames']:
        p=folder/f"frame_{entry['frame']:06d}.png"
        if sha(p)!=entry['sha256'] or p.stat().st_size!=entry['bytes']:raise ValueError('frame digest mismatch')
        with Image.open(p) as im:
            if im.size!=(1080,1920) or im.format!='PNG':raise ValueError('bad frame geometry')
            im.verify()
    return rec
@app.function(image=image,cpu=4,memory=8192,timeout=1800,volumes={'/film':volume},max_containers=1)
def prepare(run):
    volume.reload();p=root(run);p.mkdir(parents=True,exist_ok=True)
    blend=p/'LAST_SIGNAL.blend';receipt=p/'source.json'
    if receipt.exists():
        rec=json.loads(receipt.read_text())
        if sha(blend)!=rec['scene_sha256']:raise ValueError('existing scene corrupted')
        return rec
    with tempfile.TemporaryDirectory() as tmp:
        f=pathlib.Path(tmp)/'LAST_SIGNAL.blend'
        log=command([BLENDER,'-b','--factory-startup','--python-exit-code','2','--python','/opt/film/build_film.py','--',str(f)],1500)
        if not f.is_file() or 'LAST_SIGNAL_SCENE_SAVED' not in log:raise RuntimeError(log[-3000:])
        shutil.copyfile(f,blend);(p/'build.log').write_text(log)
    rec={'commit':run,'scene_sha256':sha(blend),'frames':5400,'fps':30,'resolution':[1080,1920],'characters':['ASTRA','KADE','MIRA']}
    write_json(receipt,rec);volume.commit();return rec
@app.function(image=image,gpu='T4',cpu=4,memory=16384,timeout=3600,max_containers=8,retries=2,volumes={'/film':volume})
def render_batch(run,a,b):
    sys.path.insert(0,'/opt/film')
    from contract import ranges
    from PIL import Image
    if (a,b) not in ranges():raise ValueError('unexpected batch')
    volume.reload();p=root(run);source=json.loads((p/'source.json').read_text());blend=p/'LAST_SIGNAL.blend';scene_hash=source['scene_sha256']
    if sha(blend)!=scene_hash:raise ValueError('scene hash mismatch')
    dst=p/'batches'/f'{a:06d}-{b:06d}';dst.mkdir(parents=True,exist_ok=True)
    if (dst/'receipt.json').exists():return validate(dst,a,b,scene_hash)
    with tempfile.TemporaryDirectory() as tmp:
        t=pathlib.Path(tmp);log=t/'render.log'
        gpu=command(['nvidia-smi','--query-gpu=name,uuid,driver_version','--format=csv,noheader'],20).strip()
        if 'Tesla T4' not in gpu:raise RuntimeError('unexpected GPU '+gpu)
        peak=0;observations=0
        with log.open('w') as fp:
            fp.write('NVIDIA_SMI '+gpu+'\n');fp.flush()
            proc=subprocess.Popen([BLENDER,'-b',str(blend),'--python-exit-code','2','--python','/opt/film/render_frames.py','--',str(t),str(a),str(b)],stdout=fp,stderr=subprocess.STDOUT)
            try:
                while proc.poll() is None:
                    try:
                        v=command(['nvidia-smi','--query-gpu=utilization.gpu','--format=csv,noheader,nounits'],10)
                        peak=max(peak,max(int(x.strip()) for x in v.splitlines()));observations+=1
                    except (ValueError,subprocess.SubprocessError):pass
                    time.sleep(1)
            finally:
                if proc.poll() is None:proc.kill();proc.wait()
        text=log.read_text(errors='replace')
        if proc.returncode or 'CUDA_ONLY Tesla T4 Blender 4.5.14' not in text or peak<=0 or set(map(int,re.findall(r'^CUDA_FRAME_DONE (\d+)$',text,re.M)))!=set(range(a,b+1)):
            shutil.copyfile(log,dst/'failed-render.log');volume.commit();raise RuntimeError('CUDA batch not verified: '+text[-2500:])
        rows=[]
        for f in range(a,b+1):
            name=f'frame_{f:06d}.png';file=t/name
            with Image.open(file) as im:
                if im.size!=(1080,1920) or im.format!='PNG':raise ValueError('bad image')
                im.verify()
            rows.append({'frame':f,'sha256':sha(file),'bytes':file.stat().st_size});shutil.copyfile(file,dst/name)
        shutil.copyfile(log,dst/'render.log')
        rec={'start':a,'end':b,'renderer':'CYCLES_CUDA','device':'Tesla T4','gpu_identity':gpu,'gpu_peak_utilization':peak,'gpu_observations':observations,'scene_sha256':scene_hash,'log_sha256':sha(log),'frames':rows}
        write_json(dst/'receipt.json',rec);validate(dst,a,b,scene_hash);volume.commit();return rec
def soundtrack(path):
    import numpy as np,wave
    rate=48000;rng=np.random.default_rng(2099)
    chords=[(55,82.41,130.81),(49,73.42,110),(65.41,98,146.83),(43.65,65.41,103.83),(55,82.41,164.81),(73.42,110,146.83)]
    with wave.open(str(path),'wb') as w:
        w.setnchannels(2);w.setsampwidth(2);w.setframerate(rate)
        for sec in range(180):
            t=np.arange(rate)/rate+sec;chord=chords[sec//30];u=t%30
            env=np.minimum(1,u/2)*np.minimum(1,(30-u)/2)*np.minimum(1,t/4)*np.minimum(1,(180-t)/5)
            pad=sum(np.sin(2*np.pi*f*t+.3*np.sin(2*np.pi*.09*t)) for f in chord)*.065
            pulse=np.sin(2*np.pi*chord[0]*2*t)*np.exp(-7*(t%.5))*(.04 if sec<60 else .10)
            wind=rng.normal(0,.005,rate)
            stereo=np.column_stack(((pad+pulse+wind)*env,(pad*.94+pulse+wind)*env))
            w.writeframes((np.clip(stereo,-1,1)*32767).astype('<i2').tobytes())
@app.function(image=image,cpu=8,memory=16384,timeout=14400,volumes={'/film':volume},max_containers=1)
def assemble(run):
    sys.path.insert(0,'/opt/film')
    from contract import ranges
    volume.reload();p=root(run);source=json.loads((p/'source.json').read_text());scene_hash=source['scene_sha256']
    if sha(p/'LAST_SIGNAL.blend')!=scene_hash:raise ValueError('scene mismatch')
    with tempfile.TemporaryDirectory() as tmp:
        t=pathlib.Path(tmp);seq=t/'seq';seq.mkdir();receipts=[]
        for a,b in ranges():
            folder=p/'batches'/f'{a:06d}-{b:06d}';receipts.append(validate(folder,a,b,scene_hash))
            for f in range(a,b+1):
                name=f'frame_{f:06d}.png';(seq/name).symlink_to(folder/name)
        audio=t/'original_score.wav';soundtrack(audio);movie=t/'THE_LAST_SIGNAL.mp4'
        command(['ffmpeg','-v','error','-y','-framerate','30','-start_number','1','-i',str(seq/'frame_%06d.png'),'-i',str(audio),'-map','0:v:0','-map','1:a:0','-frames:v','5400','-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-t','180','-movflags','+faststart',str(movie)],10800)
        probe=json.loads(command(['ffprobe','-v','error','-count_frames','-show_streams','-show_format','-of','json',str(movie)],1800))
        v=next(x for x in probe['streams'] if x['codec_type']=='video')
        if (v['codec_name'],v['width'],v['height'],v['r_frame_rate'],int(v['nb_read_frames']))!=('h264',1080,1920,'30/1',5400) or abs(float(v['duration'])-180)>.034 or not any(x['codec_type']=='audio' for x in probe['streams']):raise ValueError('final validation failed')
        command(['ffmpeg','-v','error','-xerror','-i',str(movie),'-f','null','-'],1800)
        shutil.copyfile(movie,p/'THE_LAST_SIGNAL.mp4');shutil.copyfile(audio,p/'original_score.wav')
        manifest={'status':'VERIFIED','source':source,'batches':receipts,'mp4_sha256':sha(movie),'mp4_bytes':movie.stat().st_size,'audio_sha256':sha(audio),'ffprobe':probe}
        write_json(p/'completeness_manifest.json',manifest);volume.commit();return {'status':'VERIFIED','mp4_sha256':manifest['mp4_sha256'],'frames':5400,'duration':180}
@app.function(image=image,cpu=1,memory=2048,timeout=86400,volumes={'/film':volume},max_containers=1)
def produce(run):
    sys.path.insert(0,'/opt/film')
    from contract import ranges
    volume.reload();p=root(run)
    if (p/'completeness_manifest.json').exists():return {'status':'VERIFIED_EXISTING'}
    write_json(p/'status.json',{'state':'RENDERING','commit':run});volume.commit()
    try:
        failures=[]
        for result in render_batch.starmap([(run,a,b) for a,b in ranges()],return_exceptions=True):
            if isinstance(result,Exception):failures.append(str(result)[:300])
        if failures:raise RuntimeError('failed batches '+str(failures[:8]))
        result=assemble.remote(run)
        volume.reload();write_json(p/'status.json',result);volume.commit();return result
    except Exception as exc:
        volume.reload();write_json(p/'status.json',{'state':'FAILED_RESUMABLE','error':str(exc)[:2000]});volume.commit();raise
