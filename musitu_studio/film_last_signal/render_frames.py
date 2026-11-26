import bpy,sys
from pathlib import Path
out=Path(sys.argv[-3]);a=int(sys.argv[-2]);b=int(sys.argv[-1])
s=bpy.context.scene;p=bpy.context.preferences.addons['cycles'].preferences
p.compute_device_type='CUDA';p.refresh_devices()
gpu=[d for d in p.devices if d.type=='CUDA' and 'Tesla T4' in d.name]
if not gpu:raise RuntimeError('Tesla T4 CUDA not present')
for d in p.devices:d.use=d in gpu
if any(d.use and d.type!='CUDA' for d in p.devices):raise RuntimeError('CPU enabled')
s.render.engine='CYCLES';s.cycles.device='GPU';s.render.use_persistent_data=True
if (s.render.resolution_x,s.render.resolution_y,s.render.resolution_percentage,s.render.fps,s.frame_end)!=(1080,1920,100,30,5400):raise RuntimeError('bad source')
print('CUDA_ONLY Tesla T4 Blender '+bpy.app.version_string,flush=True)
for f in range(a,b+1):
    s.frame_set(f);s.render.filepath=str(out/('frame_%06d.png'%f));bpy.ops.render.render(write_still=True)
    print('CUDA_FRAME_DONE %d'%f,flush=True)
