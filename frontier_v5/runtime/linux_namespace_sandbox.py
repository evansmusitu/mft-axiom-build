"""Fail-closed Linux namespace candidate for *disposable*, no-credential test programs.

NOT production certified. A reviewed rootfs is supplied out of band. There is no
fallback to host subprocess execution. No host mounts or network namespace peers.
"""
from __future__ import annotations
import hashlib
import os
from pathlib import Path, PurePosixPath
import resource
import selectors
import shutil
import signal
import subprocess
import tempfile
import time
from typing import Iterable, Sequence

from .fabric import AuthorizationError, FrontierError

MAX_OUTPUT=65536
UNSHARE='/usr/bin/unshare'


def rootfs_digest(root: Path) -> str:
    if not root.is_dir() or root.is_symlink():
        raise AuthorizationError('isolated filesystem unavailable')
    out=hashlib.sha256()
    for p in sorted(root.rglob('*')):
        if p.is_symlink():
            raise AuthorizationError('sandbox rootfs symlink denied')
        if not p.is_file():
            continue
        if not p.resolve().is_relative_to(root.resolve()):
            raise AuthorizationError('sandbox rootfs path escaped')
        out.update(str(p.relative_to(root)).encode()+b'\0')
        with p.open('rb') as f:
            for part in iter(lambda:f.read(1048576),b''):
                out.update(part)
    return out.hexdigest()


class LinuxNamespaceSandbox:
    """Runs explicitly allowlisted rootfs executables in a user/mount/net/PID jail.

    Filesystem provided to a process is a fresh copy of a reviewed rootfs.
    This candidate has no independent review, seccomp BPF, or cgroup policy.
    """
    def __init__(self, rootfs: Path | str, rootfs_sha256: str, allowed_executables: Iterable[str]):
        self.rootfs=Path(rootfs).resolve(strict=True)
        if not isinstance(rootfs_sha256,str) or len(rootfs_sha256)!=64 or not all(c in '0123456789abcdef' for c in rootfs_sha256):
            raise ValueError('reviewed rootfs digest required')
        self.sha256=rootfs_sha256
        paths=tuple(allowed_executables)
        if not paths or any(not x.startswith('/') or '/..' in x or '//' in x for x in paths):
            raise ValueError('absolute rootfs executable paths required')
        self.allowed=frozenset(paths)

    def run(self, argv: Sequence[str], timeout: int=30) -> dict:
        if not argv or not isinstance(argv[0],str) or argv[0] not in self.allowed:
            raise AuthorizationError('sandbox executable not allowlisted')
        if timeout < 1 or timeout > 60:
            raise AuthorizationError('sandbox timeout outside policy')
        if not Path(UNSHARE).is_file() or not os.access(UNSHARE, os.X_OK):
            raise AuthorizationError('Linux namespace runtime unavailable')
        if rootfs_digest(self.rootfs)!=self.sha256:
            raise AuthorizationError('sandbox image digest drift')
        # Private copy contains only independently reviewed files, never host roots.
        with tempfile.TemporaryDirectory(prefix='axiom-disposable-jail-') as td:
            jail=Path(td)/'rootfs'
            shutil.copytree(self.rootfs,jail,symlinks=False)
            if rootfs_digest(jail)!=self.sha256:
                raise AuthorizationError('sandbox image copy drift')
            target=jail/argv[0].lstrip('/')
            if not target.is_file() or not os.access(target,os.X_OK):
                raise AuthorizationError('sandbox binary missing')
            args=[UNSHARE,'--user','--map-root-user','--mount','--pid','--fork','--net','--kill-child','--root',str(jail),'--wd','/',*argv]
            env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','HOME':'/'}
            def limits():
                resource.setrlimit(resource.RLIMIT_CPU,(timeout+2,timeout+3))
                resource.setrlimit(resource.RLIMIT_FSIZE,(1048576,1048576))
                resource.setrlimit(resource.RLIMIT_CORE,(0,0))
                resource.setrlimit(resource.RLIMIT_NOFILE,(64,64))
            proc=subprocess.Popen(args, stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,env=env,cwd='/',close_fds=True,start_new_session=True,
                preexec_fn=limits)
            selector=selectors.DefaultSelector()
            selector.register(proc.stdout, selectors.EVENT_READ)
            selector.register(proc.stderr, selectors.EVENT_READ)
            output=bytearray();errors=bytearray();deadline=time.monotonic()+timeout
            try:
                while selector.get_map() or proc.poll() is None:
                    remaining=deadline-time.monotonic()
                    if remaining<=0:
                        raise FrontierError('sandbox time limit exceeded')
                    for key,_ in selector.select(timeout=min(remaining,0.2)):
                        block=os.read(key.fileobj.fileno(),8192)
                        if not block:
                            selector.unregister(key.fileobj)
                            continue
                        target_buf=output if key.fileobj is proc.stdout else errors
                        target_buf.extend(block)
                        if len(output)+len(errors)>MAX_OUTPUT:
                            raise FrontierError('sandbox output exceeded limit')
                rc=proc.wait(timeout=max(0.1,deadline-time.monotonic()))
                if rc!=0:
                    # Never expose untrusted process stderr or runtime secrets in CI.
                    if b'unshare failed: Operation not permitted' in errors:
                        raise AuthorizationError('linux namespace blocked by host kernel policy')
                    if b'error while loading shared libraries' in errors:
                        raise AuthorizationError('sandbox root filesystem missing runtime libraries')
                    raise FrontierError('sandbox process denied or exited nonzero')
                return {'argv_sha256':hashlib.sha256(repr(list(argv)).encode()).hexdigest(),
                        'stdout':output.decode('utf-8','replace'),
                        'stderr_sha256':hashlib.sha256(errors).hexdigest(), 'returncode':rc,
                        'execution_boundary':'LINUX_USER_MOUNT_PID_NET_NS_CHROOT_LOCAL_CANDIDATE'}
            finally:
                selector.close()
                if proc.poll() is None:
                    try:os.killpg(proc.pid, signal.SIGKILL)
                    except ProcessLookupError:pass
                    proc.wait(timeout=3)
                proc.stdout.close();proc.stderr.close()
