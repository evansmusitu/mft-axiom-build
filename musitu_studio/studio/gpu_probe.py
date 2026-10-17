"""Read-only Blender Cycles device discovery, never starts a GPU render.

Run only inside an enterprise-owned/approved host. A GPU name is not proof of
render suitability; performance and CUDA/OptiX render paths need separate tests.
"""
import json
import platform
from pathlib import Path
import sys

import bpy


def probe():
    result = {'schema': 'musitu.blender.gpu-capability-probe.v1',
              'blender': bpy.app.version_string, 'host_arch': platform.machine(),
              'cycles_gpu_usable_verified': False, 'gpu_render_attempted': False,
              'configured_renderer': 'CPU', 'devices': [], 'probe_errors': []}
    try:
        cycles = bpy.context.preferences.addons['cycles'].preferences
        for backend in ('CUDA', 'OPTIX'):
            try:
                cycles.compute_device_type = backend
                cycles.get_devices()
                devices = getattr(cycles, 'devices', [])
                for d in devices:
                    if getattr(d,'type','') != 'CPU':
                        result['devices'].append({'backend': backend,
                          'name': str(getattr(d,'name',''))[:160],
                          'type': str(getattr(d,'type',''))[:40],
                          'use': bool(getattr(d,'use', False))})
            except Exception as exc:
                result['probe_errors'].append({'backend':backend,'reason':type(exc).__name__})
    except Exception as exc:
        result['probe_errors'].append({'backend':'CYCLES','reason':type(exc).__name__})
    return result


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
    if len(args) != 1:
        raise SystemExit('usage: blender -b --python gpu_probe.py -- /existing/output/file.json')
    out = Path(args[0]).absolute()
    if not out.parent.is_dir() or out.exists():
        raise SystemExit('output parent must exist and output must be new')
    x = probe()
    out.write_text(json.dumps(x,indent=2,sort_keys=True)+'\n')
    print('MUSITU_GPU_PROBE=' + json.dumps(x,sort_keys=True))
