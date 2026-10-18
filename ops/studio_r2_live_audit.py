"""Bounded, read-only audit of the dedicated Studio R2 CAS pilot.

The JSON state and binary artifacts are transient; neither their bytes nor job IDs,
user titles, scene JSON, headers, secrets or raw CLI errors enter the receipt.
This does NOT establish any real Android/Access/browser-origin evidence.
"""
import hashlib
import json
import os
import pathlib
import re
import subprocess
import tempfile
from datetime import datetime, timezone

BUCKET = 'musitu-studio-v02-assets'
STATE = 'studio-control/v1/state.json'
OUTPUT = pathlib.Path('studio-r2-state-readonly-audit-20261018.json')
FILES = ('scene.blend', 'scene.glb', 'preview.png')
UUID = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\Z')
SHA = re.compile(r'[a-f0-9]{64}\Z')
LIMIT = 6_000_000


def summarize_state(raw):
    if not isinstance(raw, bytes) or not 0 < len(raw) <= LIMIT:
        raise ValueError('state size invalid')
    try:
        state = json.loads(raw)
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError('invalid state JSON') from exc
    if not isinstance(state, dict):
        raise ValueError('invalid state envelope')
    for field, maximum in (('projects', 100), ('jobs', 100), ('audit', 500)):
        if not isinstance(state.get(field), list) or len(state[field]) > maximum:
            raise ValueError('state field invalid')
    rev = state.get('revision')
    if type(rev) is not int or rev < 0:
        raise ValueError('invalid revision')
    jobs = state['jobs']
    if any(not isinstance(j, dict) for j in jobs):
        raise ValueError('invalid job')
    counts = {x: sum(j.get('state') == x for j in jobs) for x in
              ('COMPLETED', 'RUNNING', 'APPROVED', 'PENDING_APPROVAL', 'FAILED', 'DISPATCHING')}
    receipt = {
        'state_read': True,
        'revision': rev,
        'project_count': len(state['projects']),
        'job_count': len(jobs),
        'audit_event_count': len(state['audit']),
        'completed_count': counts['COMPLETED'],
        'running_count': counts['RUNNING'],
        'pending_approval_count': counts['PENDING_APPROVAL'],
        'approved_count': counts['APPROVED'],
        'failed_count': counts['FAILED'],
        'dispatching_count': counts['DISPATCHING'],
        'browser_initiated_verified': False,
        'staff_identity_verified': False,
    }
    completed = [j for j in reversed(jobs) if j.get('state') == 'COMPLETED']
    manifest = {}
    if completed:
        job = completed[0]
        uid = job.get('id')
        assets = job.get('assets')
        if not isinstance(uid, str) or not UUID.fullmatch(uid) or not isinstance(assets, dict) or set(assets) != set(FILES):
            raise ValueError('completed job has invalid manifest')
        for name in FILES:
            meta = assets[name]
            if not isinstance(meta, dict) or meta.get('key') != f'jobs/{uid}/{name}' or \
                    type(meta.get('bytes')) is not int or not 1024 <= meta['bytes'] <= 5_000_000 or \
                    not isinstance(meta.get('sha256'), str) or not SHA.fullmatch(meta['sha256']):
                raise ValueError('completed job has unsafe artifact metadata')
            manifest[name] = {'key': meta['key'], 'bytes': meta['bytes'], 'sha256': meta['sha256']}
    return receipt, manifest


def check_asset(name, content, metadata):
    if name not in FILES or not isinstance(content, bytes) or not isinstance(metadata, dict):
        return False
    if len(content) != metadata.get('bytes') or hashlib.sha256(content).hexdigest() != metadata.get('sha256'):
        return False
    if name == 'scene.blend':
        return content.startswith(b'BLENDER')
    if name == 'scene.glb':
        return content.startswith(b'glTF') and len(content) >= 12 and int.from_bytes(content[8:12], 'little') == len(content)
    return content.startswith(b'\x89PNG\r\n\x1a\n')


def remote_get(key, destination):
    # Fixed bucket, derived keys validated above. No subprocess shell and no stdout logging.
    cmd = ['npx', '--no-install', 'wrangler', 'r2', 'object', 'get', f'{BUCKET}/{key}',
           '--remote', '--file', str(destination), '--config', 'wrangler.jsonc']
    try:
        process = subprocess.run(cmd, cwd='musitu_studio/edge', capture_output=True,
                                 text=True, check=False, timeout=70)
        return process.returncode == 0 and destination.is_file()
    except (OSError, subprocess.TimeoutExpired):
        return False


def main():
    report = {
        'schema': 'musitu.studio.r2-live-state-readonly-audit.v1',
        'checked_at_utc': datetime.now(timezone.utc).isoformat(),
        'bucket': BUCKET, 'state_key': STATE,
        'read_only': True, 'storage_or_configuration_mutated': False,
        'browser_initiated_verified': False, 'gpu_qualification': False,
        'outcome': 'NOT_EXECUTED',
    }
    if not (os.getenv('CLOUDFLARE_API_TOKEN') or os.getenv('CF_API_TOKEN')):
        report['outcome'] = 'CLOUDFLARE_TOKEN_UNAVAILABLE'
    else:
        with tempfile.TemporaryDirectory(prefix='studio-r2-readonly-') as tmp:
            path = pathlib.Path(tmp)
            state_file = path / 'state.json'
            if not remote_get(STATE, state_file):
                report['outcome'] = 'STATE_ABSENT_OR_R2_READ_DENIED'
            else:
                try:
                    summary, manifest = summarize_state(state_file.read_bytes())
                except (OSError, ValueError):
                    report['outcome'] = 'STATE_SCHEMA_OR_INTEGRITY_INVALID'
                else:
                    report.update(summary)
                    if not manifest:
                        report['outcome'] = 'STATE_READ_NO_COMPLETED_ASSETS_TO_CHECK'
                    else:
                        checks = {}
                        for name in FILES:
                            f = path / name
                            downloaded = remote_get(manifest[name]['key'], f)
                            checked = False
                            if downloaded and f.stat().st_size <= 5_000_000:
                                checked = check_asset(name, f.read_bytes(), manifest[name])
                            checks[name] = {'downloaded': downloaded, 'sha256_size_header_valid': checked}
                        report['latest_completed_artifacts'] = checks
                        report['outcome'] = ('LAST_COMPLETED_R2_ASSETS_VALID' if
                            all(c['sha256_size_header_valid'] for c in checks.values()) else
                            'LAST_COMPLETED_R2_ASSETS_UNAVAILABLE_OR_INVALID')
    OUTPUT.write_text(json.dumps(report, indent=2, sort_keys=True) + '\n')
    print('STUDIO_R2_READONLY_AUDIT=' + json.dumps(report, sort_keys=True))


if __name__ == '__main__':
    main()
