"""Offline race-contract tests for immutable Studio Edge npm lock reconstruction.

No network, npm install, provider credentials, or production paths are touched.
"""
from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
from shutil import copy2
from tempfile import NamedTemporaryFile, TemporaryDirectory
from unittest import TestCase, mock
import sys

SOURCE = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(SOURCE / 'ops'))
import studio_v03_restore_edge_lockfile as lockfile


class AtomicEdgeLockRestoreTests(TestCase):
    def prepare(self, base: Path) -> Path:
        parts = base / 'ops' / 'verified_edge_lock_parts'
        parts.mkdir(parents=True)
        for name in lockfile.FRAGMENTS:
            copy2(SOURCE / 'ops' / 'verified_edge_lock_parts' / name, parts / name)
        edge = base / 'musitu_studio' / 'edge'
        edge.mkdir(parents=True)
        copy2(SOURCE / 'musitu_studio' / 'edge' / 'package.json', edge / 'package.json')
        return edge / 'package-lock.json'

    def test_clean_install_is_idempotent_and_exact_sha(self):
        import hashlib
        with TemporaryDirectory() as folder:
            base=Path(folder)
            target=self.prepare(base)
            with mock.patch.object(lockfile, '__file__', str(base/'ops'/'studio_v03_restore_edge_lockfile.py')):
                lockfile.restore()
                first=target.read_bytes()
                lockfile.restore()
                self.assertEqual(target.read_bytes(),first)
            self.assertEqual(hashlib.sha256(first).hexdigest(),lockfile.EXPECTED_SHA256)
            self.assertEqual(list(target.parent.glob('.studio-lock-*')),[])

    def test_concurrent_lockfile_creation_is_never_overwritten(self):
        with TemporaryDirectory() as folder:
            base = Path(folder)
            target = self.prepare(base)
            marker = b'concurrent-writer-customer-lock-must-survive'
            original_named_temporary_file = NamedTemporaryFile

            @contextmanager
            def inject_between_check_and_install(*args, **kwargs):
                with original_named_temporary_file(*args, **kwargs) as file:
                    yield file
                # The competing writer appears AFTER initial target.exists()
                # and BEFORE the final atomic placement operation.
                target.write_bytes(marker)

            with (mock.patch.object(lockfile, '__file__', str(base / 'ops' / 'studio_v03_restore_edge_lockfile.py')),
                  mock.patch.object(lockfile.tempfile, 'NamedTemporaryFile', inject_between_check_and_install)):
                with self.assertRaises(FileExistsError):
                    lockfile.restore()
            self.assertEqual(target.read_bytes(), marker)
            self.assertEqual(list(target.parent.glob('.studio-lock-*')), [])

    def test_concurrent_symlink_creation_cannot_be_replaced(self):
        with TemporaryDirectory() as folder:
            base = Path(folder)
            target = self.prepare(base)
            valuable = base / 'valuable-original-bytes.txt'
            valuable.write_bytes(b'leave-this-real-existing-file-intact')
            original_named_temporary_file = NamedTemporaryFile

            @contextmanager
            def inject_symlink(*args, **kwargs):
                with original_named_temporary_file(*args, **kwargs) as file:
                    yield file
                target.symlink_to(valuable)

            with (mock.patch.object(lockfile, '__file__', str(base / 'ops' / 'studio_v03_restore_edge_lockfile.py')),
                  mock.patch.object(lockfile.tempfile, 'NamedTemporaryFile', inject_symlink)):
                with self.assertRaises(FileExistsError):
                    lockfile.restore()
            self.assertTrue(target.is_symlink())
            self.assertEqual(valuable.read_bytes(), b'leave-this-real-existing-file-intact')
            self.assertEqual(list(target.parent.glob('.studio-lock-*')), [])


if __name__ == '__main__':
    from unittest import main
    main()
