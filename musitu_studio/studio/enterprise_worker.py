"""Single-use, fail-closed Blender job runner for an already-approved host.

This application is not a sandbox on its own. In production it MUST execute in
an externally restricted, rootless container with no network, a read-only source,
no secrets, and enforced memory/CPU/PID/storage quotas. GPU remains disabled.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import resource
import subprocess
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parent))
from job_schema import MAX_JOB_BYTES, load_job
from verify_job import verify

WORKER_SCHEMA = 'musitu.blender.worker-receipt.v1'
SHA256 = re.compile(r'^[a-f0-9]{64}$')
EXIT_INPUT = 2
EXIT_RUNTIME = 3
EXIT_OUTPUT = 4
MAX_SECONDS = 600
MAX_THREADS = 2
MAX_OUTPUT_MIB = 64


def digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(1024 * 1024), b''):
            h.update(b)
    return h.hexdigest()


def validate_request(job_path, expected_sha256, root, blender):
    if not SHA256.fullmatch(expected_sha256):
        raise ValueError('Exact lowercase 64-character SHA-256 required')
    if job_path.is_symlink() or not job_path.is_file():
        raise ValueError('Job input must be a regular non-symlink file')
    if job_path.stat().st_size > MAX_JOB_BYTES:
        raise ValueError('Oversized job input')
    if digest(job_path) != expected_sha256:
        raise ValueError('Job SHA-256 mismatch (unapproved or altered input)')
    job = load_job(job_path)
    if root.is_symlink():
        raise ValueError('Output root must not be a symlink')
    if not root.is_dir():
        raise ValueError('Output root must already exist')
    if blender.is_symlink() or not blender.is_file():
        raise ValueError('Blender must be an explicit regular executable, not a symlink')
    if not os.access(blender, os.X_OK):
        raise ValueError('Blender executable is not executable')
    return job


def limited_child():
    # Only supplementary limits. Production isolation MUST use container cgroups.
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    max_file = MAX_OUTPUT_MIB * 1024 * 1024
    resource.setrlimit(resource.RLIMIT_FSIZE, (max_file, max_file))


def execute(job_path, expected_sha256, output_root, blender, *,
            timeout_seconds=180, cpu_threads=2):
    job_path = Path(job_path).absolute()
    root = Path(output_root).absolute()
    blender = Path(blender).absolute()
    if type(timeout_seconds) is not int or not 1 <= timeout_seconds <= MAX_SECONDS:
        raise ValueError('Timeout must be an integer from 1 to 600 seconds')
    if type(cpu_threads) is not int or not 1 <= cpu_threads <= MAX_THREADS:
        raise ValueError('CPU threads must be an integer from 1 to 2')
    job = validate_request(job_path, expected_sha256, root, blender)
    job_id = job['job_id']
    # mkdir is atomic; never reuse an ID, overwrite an artifact or erase failures.
    work = root / job_id
    work.mkdir(mode=0o700, exist_ok=False)
    output = work / 'artifacts'
    output.mkdir(mode=0o700)
    start = time.monotonic()
    receipt = {
        'schema': WORKER_SCHEMA, 'job_id': job_id,
        'job_sha256': expected_sha256, 'state': 'FAILED',
        'execution_mode': 'CPU_ONLY', 'gpu_verified': False,
        'timeout_seconds': timeout_seconds, 'cpu_threads': cpu_threads,
        'started_unix': int(time.time()), 'worker_isolation': 'HOST_REQUIRES_EXTERNAL_SANDBOX',
    }
    cmd = [str(blender), '--background', '--factory-startup', '--threads', str(cpu_threads),
           '--python', str(Path(__file__).resolve().parent / 'execute_job.py'), '--',
           '--job', str(job_path), '--outdir', str(output)]
    child_env = {'HOME': str(work), 'TMPDIR': str(work), 'PATH': '/usr/local/bin:/usr/bin:/bin',
                 'OMP_NUM_THREADS': str(cpu_threads), 'OPENBLAS_NUM_THREADS': '1',
                 'BLENDER_USER_CONFIG': str(work / 'config')}
    child_env['LANG'] = 'C.UTF-8'
    code = EXIT_RUNTIME
    try:
        # No shell, no inherited credentials, no user-controlled command fields.
        with (work / 'blender.log').open('wb') as log:
            try:
                result = subprocess.run(cmd, env=child_env, cwd=str(work),
                                        stdout=log, stderr=subprocess.STDOUT,
                                        timeout=timeout_seconds, preexec_fn=limited_child,
                                        check=False)
            except subprocess.TimeoutExpired:
                receipt['failure'] = 'TIMEOUT'
                raise RuntimeError('Blender exceeded maximum execution time')
        receipt['process_returncode'] = result.returncode
        if result.returncode != 0:
            raise RuntimeError('Blender returned nonzero exit code')
        # Blender sometimes exits 0 after a Python failure, so evidence validation
        # and independent artifact verification are mandatory.
        attestation = verify(job_path, output)
        receipt['verification'] = attestation
        receipt['state'] = 'VERIFIED'
        code = 0
    except Exception as exc:
        receipt['failure'] = receipt.get('failure') or type(exc).__name__
        receipt['failure_detail'] = str(exc)[:256]
        if receipt['failure'] in ('AssertionError','FileNotFoundError','JSONDecodeError'):
            code = EXIT_OUTPUT
    finally:
        receipt['elapsed_seconds'] = round(time.monotonic() - start, 3)
        receipt['finished_unix'] = int(time.time())
        (work / 'worker_receipt.json').write_text(json.dumps(receipt, sort_keys=True, indent=2)+'\n')
    return code, receipt, work


def main(argv=None):
    p = argparse.ArgumentParser(description='MUSITU approved-host CPU-only Blender job worker')
    p.add_argument('--job', type=Path, required=True)
    p.add_argument('--expected-sha256', required=True)
    p.add_argument('--output-root', type=Path, required=True)
    p.add_argument('--blender', type=Path, required=True)
    p.add_argument('--timeout-seconds', type=int, default=180)
    p.add_argument('--cpu-threads', type=int, default=2)
    p.add_argument('--device', default='CPU', choices=['CPU'])
    args = p.parse_args(argv)
    try:
        code, receipt, _ = execute(args.job, args.expected_sha256, args.output_root,
                                   args.blender, timeout_seconds=args.timeout_seconds,
                                   cpu_threads=args.cpu_threads)
        print(json.dumps(receipt, sort_keys=True))
        return code
    except (ValueError, OSError) as exc:
        print('REJECTED: ' + str(exc)[:256], file=sys.stderr)
        return EXIT_INPUT


if __name__ == '__main__':
    sys.exit(main())
