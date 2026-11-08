"""Credential-free regressions for the public Git snapshot secret-path gate."""
import importlib.util
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).with_name('musitu_whole_product_live_handoff_20261108.py')
spec = importlib.util.spec_from_file_location('musitu_whole_product_live_handoff_20261108', SCRIPT)
pack = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pack)

PUBLIC_RECIPIENT = 'customer_frontier/recovery/recipient-20261106.pem'
PUBLIC_RECIPIENT_OID = 'ec9115c83879290d23cee2eb2932f2f31df5584d'
# The key is publicly committed source; do not ship private keys or generic PEMs.
PUBLIC_KEY_BYTES = subprocess.check_output(('git', 'cat-file', 'blob', PUBLIC_RECIPIENT_OID))


def tree_entry(path, oid=PUBLIC_RECIPIENT_OID, mode='100644'):
    return f'{mode} blob {oid}\t{path}\0'.encode()


class PublicSourcePackagingSafety(unittest.TestCase):
    def scan(self, entries, public_bytes=PUBLIC_KEY_BYTES):
        def fake_git(args):
            if args[:3] == ('git', 'ls-tree', '-rz'):
                return entries
            if args == ('git', 'cat-file', 'blob', PUBLIC_RECIPIENT_OID):
                return public_bytes
            raise AssertionError('Unexpected external command')
        with patch.object(pack.subprocess, 'check_output', side_effect=fake_git):
            return pack.tracked_files_at('snapshot')

    def test_exact_sha_pinned_public_recipient_is_allowed_without_omitting_source(self):
        self.assertEqual(
            self.scan(tree_entry('README.md', 'a'*40) + tree_entry(PUBLIC_RECIPIENT)),
            {'README.md': 'a'*40, PUBLIC_RECIPIENT: PUBLIC_RECIPIENT_OID}
        )

    def test_other_pem_and_private_key_filenames_still_fail_closed(self):
        for path in ('customer_frontier/recovery/private.pem',
                     'customer_frontier/recovery/recipient-20261106-copy.pem',
                     'secrets/private.key', '.env'):
            with self.subTest(path=path), self.assertRaisesRegex(RuntimeError, 'POTENTIAL_PUBLIC_SOURCE_SECRET_PATH'):
                self.scan(tree_entry(path))

    def test_public_recipient_changes_or_trailing_private_material_are_refused(self):
        with self.assertRaisesRegex(RuntimeError, 'POTENTIAL_PUBLIC_SOURCE_SECRET_PATH'):
            self.scan(tree_entry(PUBLIC_RECIPIENT, 'f'*40))
        with self.assertRaisesRegex(RuntimeError, 'POTENTIAL_PUBLIC_SOURCE_SECRET_PATH'):
            self.scan(tree_entry(PUBLIC_RECIPIENT), PUBLIC_KEY_BYTES+b'-----BEGIN PRIVATE KEY-----\n')

    def test_symlink_is_never_packaged_as_regular_source(self):
        with self.assertRaisesRegex(RuntimeError, 'NONREGULAR_PUBLIC_GIT_ENTRY'):
            self.scan(tree_entry(PUBLIC_RECIPIENT, mode='120000'))


if __name__ == '__main__':
    unittest.main()
