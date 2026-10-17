"""Run a restricted declarative job inside genuine Blender 4.5 LTS.

Only accepted JSON properties and primitive operations reach bpy. No scene Python,
third-party assets, plug-ins, external commands or provider integrations.
This is an integration-test proof, NOT a public or production render service.
"""
import hashlib
import os
import json
import math
from pathlib import Path
import sys
import time
import traceback

import bpy
from mathutils import Vector
# Blender --python does not consistently add script directory to sys.path.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from job_schema import load_job

PALETTE = {
    'teal': ((0.012, 0.29, 0.36), 0.25, 0.38),
    'copper': ((0.81, 0.32, 0.06), 0.5, 0.31),
    'ivory': ((0.82, 0.84, 0.79), 0.0, 0.66),
    'graphite': ((0.052, 0.066, 0.082), 0.17, 0.53),
    'blueglass': ((0.13, 0.45, 0.65), 0.22, 0.18),
    'rubber': ((0.018, 0.02, 0.027), 0.0, 0.9),
    'wood': ((0.34, 0.14, 0.05), 0.0, 0.75),
}


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for c in iter(lambda: f.read(1024 * 1024), b''):
            h.update(c)
    return h.hexdigest()


def setup_scene(job):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene['musitu_test_only'] = True
    scene['job_id'] = job['job_id']
    scene.unit_settings.system = 'METRIC'
    scene.frame_start = 1
    scene.frame_end = job.get('frame_end', 24)
    mats = {}
    for key, (rgb, metal, rough) in PALETTE.items():
        m = bpy.data.materials.new('MUSITU_' + key)
        m.diffuse_color = (*rgb, 1)
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Base Color'].default_value = (*rgb, 1)
        bsdf.inputs['Metallic'].default_value = metal
        bsdf.inputs['Roughness'].default_value = rough
        mats[key] = m
    by_name = {}
    for item in job['objects']:
        dims = item['dimensions']
        if item['type'] == 'cube':
            bpy.ops.mesh.primitive_cube_add(size=1)
        elif item['type'] == 'cylinder':
            bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.5, depth=1)
        else:
            bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=0.5)
        o = bpy.context.object
        o.name = item['name']
        o.location = item['location']
        o.dimensions = dims
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        o.data.materials.append(mats[item['material']])
        by_name[o.name] = o
    for anim in job.get('animations', []):
        ob = by_name[anim['object']]
        idx = 'XYZ'.index(anim['axis'])
        ob.rotation_mode = 'XYZ'
        ob.rotation_euler[idx] = 0
        ob.keyframe_insert(data_path='rotation_euler', frame=anim['start'])
        ob.rotation_euler[idx] = math.radians(anim['degrees'])
        ob.keyframe_insert(data_path='rotation_euler', frame=anim['end'])
    # Lighting and camera are fixed, not user-supplied executable settings.
    bpy.ops.object.camera_add(location=(7, -10, 7))
    camera = bpy.context.object
    camera.name = 'STUDIO_camera'
    target = Vector((0, 0, 1.0))
    camera.rotation_euler = (target - camera.location).to_track_quat('-Z', 'Y').to_euler()
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = 13.0
    scene.camera = camera
    for name, position, watts in [('STUDIO_key', (3, -6, 9), 1000), ('STUDIO_fill', (-5, 0, 7), 800)]:
        bpy.ops.object.light_add(type='AREA', location=position)
        lamp = bpy.context.object
        lamp.name = name
        lamp.data.energy = watts
        lamp.data.shape = 'DISK'
        lamp.data.size = 5
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    if os.environ.get('STUDIO_RENDER_DEVICE', 'CPU') == 'GPU':
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'CUDA'
        prefs.get_devices()
        gpu_devices = [d for d in prefs.devices if d.type == 'CUDA']
        if not gpu_devices:
            raise RuntimeError('CUDA GPU requested but no Blender Cycles CUDA device detected')
        for d in prefs.devices:
            d.use = d.type == 'CUDA'
        scene.cycles.device = 'GPU'
        scene['musitu_gpu_device_names'] = ', '.join(d.name for d in gpu_devices)[:250]
    scene.cycles.samples = 8
    scene.render.resolution_x = 320
    scene.render.resolution_y = 200
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.frame_set(1)
    return scene


def main():
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    if len(args) != 4 or args[0] != '--job' or args[2] != '--outdir':
        raise SystemExit('Usage: blender -b --python execute_job.py -- --job FILE.json --outdir DIR')
    job_path = Path(args[1]).resolve()
    out = Path(args[3]).resolve()
    # Validate complete input before creating or altering output files.
    job = load_job(job_path)
    out.mkdir(parents=True, exist_ok=True)
    evidence = {'schema': 'musitu.blender.job-evidence.v1', 'job_id': job['job_id'],
                'input_sha256': sha256(job_path), 'result': 'FAIL',
                'blender_version': bpy.app.version_string, 'renderer': 'CYCLES_CPU',
                'gpu_verified': False, 'submitted_at_unix': int(time.time())}
    try:
        scene = setup_scene(job)
        cuda_requested = os.environ.get('STUDIO_RENDER_DEVICE', 'CPU') == 'GPU'
        evidence['renderer'] = 'CYCLES_CUDA' if cuda_requested else 'CYCLES_CPU'
        evidence['gpu_verified'] = False
        evidence['gpu_device_names'] = str(scene.get('musitu_gpu_device_names', ''))[:250]
        blend = out / 'scene.blend'
        glb = out / 'scene.glb'
        png = out / 'preview.png'
        scene.render.filepath = str(png)
        bpy.ops.wm.save_as_mainfile(filepath=str(blend))
        result = bpy.ops.export_scene.gltf(filepath=str(glb), export_format='GLB', export_animations=True)
        if 'FINISHED' not in result:
            raise RuntimeError('glTF export did not finish')
        bpy.ops.render.render(write_still=True)
        for p in (blend, glb, png):
            if not p.is_file() or p.stat().st_size <= 1024:
                raise RuntimeError('Missing/empty expected artifact ' + p.name)
        evidence.update(result='PASS', gpu_verified=bool(cuda_requested), meshes=len([o for o in bpy.data.objects if o.type == 'MESH']),
                        animated_tracks=len(job.get('animations', [])),
                        files={p.name: {'bytes': p.stat().st_size, 'sha256': sha256(p)}
                               for p in (blend, glb, png)})
    except Exception as exc:
        evidence['error'] = str(exc)
        evidence['traceback'] = traceback.format_exc()[-3000:]
        raise
    finally:
        (out / 'evidence.json').write_text(json.dumps(evidence, indent=2, sort_keys=True) + '\n')
        print('MUSITU_JOB_EVIDENCE=' + json.dumps(evidence, sort_keys=True), flush=True)


if __name__ == '__main__':
    main()
