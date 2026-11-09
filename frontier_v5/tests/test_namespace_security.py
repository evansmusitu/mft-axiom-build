"""Hostile local candidate tests: these do not substitute for independent review."""
from __future__ import annotations
import hashlib
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from frontier_v5.runtime.fullstack_base import SandboxedComputerAdapter
from frontier_v5.runtime.fabric import AuthorizationError, FrontierError

ROOTFS = Path(os.environ.get('AXIOM_SANDBOX_ROOTFS', '/nonexistent/MISSING_EXPLICIT_SANDBOX_ROOTFS'))

def digest(p: Path) -> str:
    import hashlib
    out=hashlib.sha256()
    for q in sorted(p.rglob('*')):
        if not q.is_file(): continue
        out.update(str(q.relative_to(p)).encode() + b'\0')
        with q.open('rb') as f:
            for part in iter(lambda:f.read(1048576),b''):out.update(part)
    return out.hexdigest()

class NamespaceSecurity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not ROOTFS.is_dir():raise AssertionError('AXIOM_SANDBOX_ROOTFS must point at a reviewed disposable test image')
        cls.root_hash=digest(ROOTFS)

    def adapter(self,root):
        return SandboxedComputerAdapter(root, {'/usr/bin/python3'}, sandbox_rootfs=ROOTFS, rootfs_sha256=self.root_hash)

    def test_requires_namespace_provider_for_execution(self):
        with tempfile.TemporaryDirectory() as work:
            a=SandboxedComputerAdapter(work, {'/usr/bin/python3'})
            with self.assertRaises(AuthorizationError):a.run(['/usr/bin/python3','-I','-S','-c','print(123)'])

    def test_real_chroot_and_network_namespace_hide_host_and_block_egress(self):
        with tempfile.TemporaryDirectory() as work:
            a=self.adapter(work)
            payload="import os,socket; print('FILESYSTEM_DENIED', not os.path.exists('/mnt/data')); s=socket.socket();\ntry:s.connect(('1.1.1.1',53));print('NETWORK_LEAK')\nexcept OSError:print('NETWORK_DENIED')"
            r=a.run(['/usr/bin/python3','-I','-S','-c',payload])
            self.assertIn('FILESYSTEM_DENIED True',r['stdout'])
            self.assertIn('NETWORK_DENIED',r['stdout'])
            self.assertNotIn('NETWORK_LEAK',r['stdout'])

    def test_secret_and_host_path_hidden(self):
        with tempfile.TemporaryDirectory() as work:
            a=self.adapter(work)
            with patch.dict(os.environ,{'AXIOM_SYNTHETIC_SECRET':'SYNTHETIC_NEVER_LEAK'}):
                r=a.run(['/usr/bin/python3','-I','-S','-c',"import os;print(os.getenv('AXIOM_SYNTHETIC_SECRET','ABSENT'))"])
            self.assertEqual(r['stdout'].strip(),'ABSENT')

    def test_unapproved_executable_rejected(self):
        with tempfile.TemporaryDirectory() as work:
            a=self.adapter(work)
            with self.assertRaises(AuthorizationError):a.run(['/bin/dash','-c','echo rogue'])
            with self.assertRaises(AuthorizationError):a.run(['python3','-c','print(42)'])

    def test_untrusted_environment_rejected(self):
        with tempfile.TemporaryDirectory() as work:
            a=self.adapter(work)
            with self.assertRaises(AuthorizationError):a.run(['/usr/bin/python3','-I','-S','-c','print(42)'],env={'SECRET':'canary'})

    def test_wrong_rootfs_hash_fails_closed(self):
        with tempfile.TemporaryDirectory() as work:
            a=SandboxedComputerAdapter(work,{'/usr/bin/python3'},sandbox_rootfs=ROOTFS,rootfs_sha256='0'*64)
            with self.assertRaises(AuthorizationError):a.run(['/usr/bin/python3','-I','-S','-c','print(42)'])

    def test_unbounded_output_denied(self):
        with tempfile.TemporaryDirectory() as work:
            a=self.adapter(work)
            with self.assertRaises(FrontierError):a.run(['/usr/bin/python3','-I','-S','-c','print("X"*150000)'])

    def test_timeout_denied(self):
        with tempfile.TemporaryDirectory() as work:
            a=self.adapter(work)
            with self.assertRaises(FrontierError):a.run(['/usr/bin/python3','-I','-S','-c','while True: pass'],timeout=1)

if __name__=='__main__':unittest.main()
