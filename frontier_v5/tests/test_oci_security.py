"""Hosted scratch-OCI hostile prequalification. Not an independent review."""
from __future__ import annotations
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from frontier_v5.runtime.fabric import AuthorizationError, FrontierError
from frontier_v5.runtime.docker_isolated_sandbox import DockerIsolatedSandbox

IMAGE=os.environ.get('AXIOM_SANDBOX_IMAGE_ID','')
PYTHON='/usr/bin/python3'

class DockerSecurity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not IMAGE.startswith('sha256:') or len(IMAGE)!=71:
            raise AssertionError('explicit pinned scratch OCI image required')

    def sandbox(self):
        return DockerIsolatedSandbox(IMAGE,{PYTHON})

    def test_no_unpinned_or_relative_executables(self):
        with self.assertRaises(ValueError):DockerIsolatedSandbox('python:latest',{PYTHON})
        with self.assertRaises(ValueError):DockerIsolatedSandbox(IMAGE,{'python3'})
        with self.assertRaises(AuthorizationError):self.sandbox().run(['/bin/sh','-c','env'])

    def test_network_and_host_workspace_hidden(self):
        code=("import os,socket;print('HOST_HIDDEN',not os.path.exists('/home/runner/work'));"
              "s=socket.socket();\ntry:s.connect(('1.1.1.1',53));print('NETWORK_LEAK')"
              "\nexcept OSError:print('NETWORK_DENIED')")
        result=self.sandbox().run([PYTHON,'-I','-S','-c',code],timeout=15)
        self.assertIn('HOST_HIDDEN True',result['stdout'])
        self.assertIn('NETWORK_DENIED',result['stdout'])
        self.assertNotIn('NETWORK_LEAK',result['stdout'])
        self.assertEqual(result['returncode'],0)

    def test_host_secret_not_inherited(self):
        with patch.dict(os.environ,{'AXIOM_SYNTHETIC_SECRET':'SYNTHETIC_NEVER_LEAK'}):
            r=self.sandbox().run([PYTHON,'-I','-S','-c',
                "import os;print(os.environ.get('AXIOM_SYNTHETIC_SECRET','ABSENT'))"],timeout=15)
        self.assertEqual(r['stdout'].strip(),'ABSENT')

    def test_root_filesystem_read_only(self):
        code=("from pathlib import Path\ntry:Path('/unapproved-file').write_text('X');print('WRITE_LEAK')"
              "\nexcept OSError:print('WRITE_DENIED')")
        r=self.sandbox().run([PYTHON,'-I','-S','-c',code],timeout=15)
        self.assertIn('WRITE_DENIED',r['stdout'])
        self.assertNotIn('WRITE_LEAK',r['stdout'])

    def test_output_limit_is_not_a_generic_launch_error(self):
        with self.assertRaisesRegex(FrontierError,'OCI sandbox output exceeded limit'):
            self.sandbox().run([PYTHON,'-I','-S','-c','print("X"*180000)'],timeout=15)

    def test_wall_timeout_is_not_a_generic_launch_error(self):
        with self.assertRaisesRegex(FrontierError,'OCI sandbox time limit exceeded'):
            self.sandbox().run([PYTHON,'-I','-S','-c','while True: pass'],timeout=2)

if __name__=='__main__':unittest.main()
