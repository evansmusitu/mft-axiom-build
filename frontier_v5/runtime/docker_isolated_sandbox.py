"""Strict OCI sandbox candidate. No host mounts/network or product credentials.

The Docker daemon and scratch-image provenance require independent review.
No fallback to host Python is permitted.
"""
from __future__ import annotations
import hashlib
import os
from pathlib import Path
import re
import secrets
import selectors
import signal
import subprocess
import time
from typing import Iterable, Sequence
from .fabric import AuthorizationError, FrontierError

IMAGE=re.compile(r'^sha256:[0-9a-f]{64}$')
MAX_OUTPUT=65536
DOCKER='/usr/bin/docker'

class DockerIsolatedSandbox:
    def __init__(self, image_id: str, allowed_executables: Iterable[str]):
        if not isinstance(image_id,str) or not IMAGE.fullmatch(image_id):
            raise ValueError('pinned OCI image ID required; tags forbidden')
        paths=tuple(allowed_executables)
        if not paths or any(not isinstance(x,str) or not x.startswith('/') or '..' in x.split('/') or '//' in x for x in paths):
            raise ValueError('absolute OCI executable allowlist required')
        self.image_id=image_id
        self.allowed=frozenset(paths)

    def run(self, argv: Sequence[str], timeout: int=30) -> dict:
        if not argv or not all(isinstance(x,str) and '\0' not in x for x in argv) or argv[0] not in self.allowed:
            raise AuthorizationError('OCI executable not allowlisted')
        if not isinstance(timeout,int) or timeout<1 or timeout>60:
            raise AuthorizationError('OCI timeout outside policy')
        if not Path(DOCKER).is_file() or not os.access(DOCKER,os.X_OK):
            raise AuthorizationError('OCI runtime unavailable')
        env={'PATH':'/usr/bin:/bin','HOME':'/','LANG':'C.UTF-8'}
        try:
            check=subprocess.run([DOCKER,'image','inspect','--format','{{.Id}}',self.image_id],
                env=env,cwd='/',stdin=subprocess.DEVNULL,capture_output=True,text=True,timeout=8,check=False)
        except (OSError,subprocess.TimeoutExpired):
            raise AuthorizationError('OCI image pin preflight unavailable') from None
        if check.returncode!=0 or check.stdout.strip()!=self.image_id:
            raise AuthorizationError('OCI image digest mismatched or unavailable')
        name='axiom-disposable-'+secrets.token_hex(10)
        args=[DOCKER,'run','--rm','--name',name,'--pull=never','--network=none',
            '--read-only','--cap-drop=ALL','--security-opt=no-new-privileges',
            '--pids-limit=32','--memory=256m','--cpus=1','--ipc=none',
            '--user=65534:65534','--ulimit=nofile=64:64',
            '--tmpfs=/tmp:rw,nosuid,nodev,noexec,size=16m,mode=1777',
            '--workdir=/','--env=HOME=/','--env=PATH=/usr/bin:/bin',
            '--env=PYTHONDONTWRITEBYTECODE=1',self.image_id,*argv]
        try:
            proc=subprocess.Popen(args,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,close_fds=True,env=env,cwd='/',start_new_session=True)
        except OSError:
            raise AuthorizationError('OCI process launch unavailable') from None
        stdout=bytearray();stderr=bytearray();selector=selectors.DefaultSelector()
        deadline=time.monotonic()+timeout
        selector.register(proc.stdout,selectors.EVENT_READ)
        selector.register(proc.stderr,selectors.EVENT_READ)
        abnormal=False
        try:
            while selector.get_map() or proc.poll() is None:
                remaining=deadline-time.monotonic()
                if remaining<=0:
                    abnormal=True
                    raise FrontierError('OCI sandbox time limit exceeded')
                for key,_ in selector.select(timeout=min(0.2,remaining)):
                    block=os.read(key.fileobj.fileno(),8192)
                    if not block:
                        selector.unregister(key.fileobj)
                        continue
                    (stdout if key.fileobj is proc.stdout else stderr).extend(block)
                    if len(stdout)+len(stderr)>MAX_OUTPUT:
                        abnormal=True
                        raise FrontierError('OCI sandbox output exceeded limit')
            if proc.wait(timeout=max(0.1,deadline-time.monotonic()))!=0:
                raise FrontierError('OCI process nonzero or runtime denied')
            return {'stdout':stdout.decode('utf-8','replace'),'returncode':0,
                'stderr_sha256':hashlib.sha256(stderr).hexdigest(),
                'argv_sha256':hashlib.sha256(repr(list(argv)).encode()).hexdigest(),
                'execution_boundary':'OCI_NO_NETWORK_NO_MOUNTS_READONLY_LOCAL_CANDIDATE'}
        finally:
            selector.close()
            if proc.poll() is None:
                abnormal=True
                try:os.killpg(proc.pid,signal.SIGKILL)
                except ProcessLookupError:pass
                try:proc.wait(timeout=3)
                except subprocess.TimeoutExpired:pass
            proc.stdout.close()
            proc.stderr.close()
            if abnormal:
                try:
                    cleanup=subprocess.run([DOCKER,'rm','-f',name],env=env,cwd='/',
                        stdin=subprocess.DEVNULL,capture_output=True,timeout=10,check=False)
                    if cleanup.returncode!=0 and b'No such container' not in cleanup.stderr:
                        raise FrontierError('OCI sandbox cleanup unconfirmed')
                except (OSError,subprocess.TimeoutExpired):
                    raise FrontierError('OCI sandbox cleanup unconfirmed') from None
