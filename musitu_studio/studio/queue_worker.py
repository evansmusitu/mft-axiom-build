"""Offline queue consumer for one approved, isolated CPU worker.

Set MUSITU_WORKER_ISOLATED=1 only inside a separately verified network-denied
rootless container or equivalently restricted VM. This flag is not itself a sandbox.
"""
import argparse
import hashlib
import json
import fcntl
import os
from pathlib import Path
import sys
import time
import traceback

from .enterprise_worker import execute
from .store import StudioStore


def execute_one(store, blender):
    job = store.claim()
    if job is None:
        return None
    try:
        code, receipt, location = execute(
            Path(job['input_path']), job['job_sha256'], store.root/'runs',
            blender, timeout_seconds=180, cpu_threads=2)
        receipt_file=location/'worker_receipt.json'
        receipt_hash=hashlib.sha256(receipt_file.read_bytes()).hexdigest()
        is_good = code==0 and receipt['state']=='VERIFIED'
        store.finish(job['id'], is_good, receipt_hash,
                     failure=str(receipt.get('failure','RUN_FAILED')) if not is_good else '')
    except Exception as exc:
        store.finish(job['id'], False, failure=f'{type(exc).__name__}:{str(exc)[:180]}')
        is_good=False
    return {'job_id':job['id'],'state':'VERIFIED' if is_good else 'FAILED'}


def main(argv=None):
    p=argparse.ArgumentParser(description='MUSITU approved-host offline Blender queue worker')
    p.add_argument('--data',type=Path,default=Path(os.getenv('MUSITU_STUDIO_DATA','./studio-data')))
    p.add_argument('--blender',type=Path,required=True)
    p.add_argument('--once',action='store_true',help='Process one approved job and quit')
    p.add_argument('--dev-ci-proof',action='store_true',help='GitHub CI software verification only (not production)')
    args=p.parse_args(argv)
    if not args.dev_ci_proof and os.getenv('MUSITU_WORKER_ISOLATED')!='1':
        p.error('Worker isolation must be externally enforced; see Docker/Podman configuration')
    if os.getenv('MUSITU_STUDIO_ADMIN_TOKEN'):
        p.error('Admin credentials must not exist in worker process environment')
    store=StudioStore(args.data)
    # Prevent concurrent processes from prematurely failing a legitimately
    # running job during startup recovery; one approved worker per store.
    lock_file=(store.root/'worker.lock').open('a+')
    try:
        fcntl.flock(lock_file.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError:
        p.error('Another worker holds the offline queue lock')
    recovered=store.recover_interrupted()
    print('MUSITU_WORKER_START',json.dumps({'interrupted_failed':recovered,'gpu_verified':False}),flush=True)
    while True:
        result=execute_one(store,args.blender)
        if result:print('MUSITU_WORKER_JOB',json.dumps(result,sort_keys=True),flush=True)
        if args.once:return 0 if result is None or result['state']=='VERIFIED' else 1
        if result is None:time.sleep(2)

if __name__=='__main__':sys.exit(main())
