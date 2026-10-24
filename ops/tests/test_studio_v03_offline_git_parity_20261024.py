import hashlib
import pathlib
import sys
import tempfile
import unittest

sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
from studio_v03_offline_git_parity import verify_selected_files

class GitBlobParityTests(unittest.TestCase):
    def setUp(self):
        self.t=tempfile.TemporaryDirectory()
        self.addCleanup(self.t.cleanup)
        self.root=pathlib.Path(self.t.name)
        (self.root/'src').mkdir()
        (self.root/'src'/'a.mjs').write_bytes(b'export const secure = true;\n')
        self.p='src/a.mjs'
        self.raw=(self.root/self.p).read_bytes()
        self.sha1=hashlib.sha1(b'blob '+str(len(self.raw)).encode()+b'\0'+self.raw).hexdigest()

    def test_deterministic_git_byte_parity_sha256_and_length(self):
        a=verify_selected_files(self.root,[self.p],{self.p:self.sha1})
        self.assertEqual(a,verify_selected_files(self.root,[self.p],{self.p:self.sha1}))
        self.assertEqual(a['files'][self.p]['git_blob_sha1'],self.sha1)
        self.assertEqual(a['files'][self.p]['sha256'],hashlib.sha256(self.raw).hexdigest())
        self.assertFalse(a['provider_verified'])

    def test_line_ending_loss_is_detected_before_handoff(self):
        (self.root/self.p).write_bytes(self.raw.rstrip(b'\n'))
        with self.assertRaisesRegex(ValueError,'BLOB_MISMATCH'):
            verify_selected_files(self.root,[self.p],{self.p:self.sha1})

    def test_duplicate_traversal_escape_and_control_character_are_denied(self):
        for entries in [[self.p,self.p],['../elsewhere'],['./src/a.mjs'],
                        ['src/../../a'],['/src/a.mjs'],['src\\a.mjs'],['src/\x00a.mjs']]:
            with self.subTest(entries=entries),self.assertRaisesRegex(ValueError,'PATH_INVALID'):
                verify_selected_files(self.root,entries)

    def test_symlink_to_other_tree_and_internal_symlink_are_denied(self):
        target=self.root/'src'/'linked.mjs'
        target.symlink_to(self.root/self.p)
        with self.assertRaisesRegex(ValueError,'SYMLINK_REJECTED'):
            verify_selected_files(self.root,['src/linked.mjs'])

    def test_root_directory_symlink_is_not_an_authorized_source_root(self):
        alias=self.root.parent/(self.root.name+'-alias')
        alias.symlink_to(self.root,target_is_directory=True)
        self.addCleanup(alias.unlink)
        with self.assertRaisesRegex(ValueError,'ROOT_INVALID'):
            verify_selected_files(alias,[self.p])

    def test_expected_sha_set_must_be_complete_and_frozen(self):
        with self.assertRaisesRegex(ValueError,'EXPECTATIONS_INCOMPLETE'):
            verify_selected_files(self.root,[self.p],{})
        with self.assertRaisesRegex(ValueError,'BLOB_MISMATCH'):
            verify_selected_files(self.root,[self.p],{self.p:'f'*40})

if __name__=='__main__':unittest.main()
