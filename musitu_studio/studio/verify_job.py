"""Independent verification of Blender-produced artifacts for the job schema."""
import hashlib
import json
from pathlib import Path
import struct
import sys

try:
    from .job_schema import load_job
except ImportError:
    from job_schema import load_job


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def verify(job_path, outdir):
    job = load_job(job_path)
    p = Path(outdir)
    record = json.loads((p / 'evidence.json').read_text())
    assert record['schema'] == 'musitu.blender.job-evidence.v1'
    assert record['result'] == 'PASS' and record['job_id'] == job['job_id']
    assert record['input_sha256'] == sha256(job_path)
    assert record['renderer'] == 'CYCLES_CPU' and record['gpu_verified'] is False
    expected = {'scene.blend', 'scene.glb', 'preview.png'}
    assert set(record['files']) == expected
    for name, d in record['files'].items():
        f = p / name
        assert f.is_file() and f.stat().st_size == d['bytes'] and d['bytes'] > 1024
        assert sha256(f) == d['sha256']
    assert (p / 'scene.blend').read_bytes().startswith(b'BLENDER')
    png = (p / 'preview.png').read_bytes()
    assert png[:8] == b'\x89PNG\r\n\x1a\n'
    assert struct.unpack('>II', png[16:24]) == (320, 200)
    glb = (p / 'scene.glb').read_bytes()
    magic, version, total = struct.unpack('<4sII', glb[:12])
    assert (magic, version, total) == (b'glTF', 2, len(glb))
    jslen, tag = struct.unpack('<I4s', glb[12:20])
    assert tag == b'JSON'
    doc = json.loads(glb[20:20+jslen])
    assert len(doc.get('meshes', [])) == len(job['objects'])
    if job.get('animations'):
        assert len(doc.get('animations', [])) >= 1
    result = {'result': 'PASS', 'job_id': job['job_id'], 'verified_meshes': len(doc['meshes']),
              'verified_animation_clips': len(doc.get('animations', [])),
              'sha256': {name: sha256(p / name) for name in sorted(expected)}}
    (p / 'verification.json').write_text(json.dumps(result, indent=2, sort_keys=True) + '\n')
    print('MUSITU_JOB_VERIFIED ' + json.dumps(result, sort_keys=True), flush=True)
    return result


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('Usage: python verify_job.py JOB.json OUTDIR')
    verify(sys.argv[1], sys.argv[2])
