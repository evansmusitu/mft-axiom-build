"""Standalone offline release receipt safety contract; no Blender/provider calls."""
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
TOOL = ROOT / 'creative/god_mode_2099/release_receipt_2099.py'


class GodModeReleaseReceiptTests(unittest.TestCase):
    def fixtures(self, base):
        scene = pathlib.Path(base) / 'scene.blend'
        video = pathlib.Path(base) / 'movie.mp4'
        receipt = pathlib.Path(base) / 'movie.mp4.verified.json'
        scene.write_bytes(b'editable-studio-scene')
        video.write_bytes(b'locally-encoded-movie')
        r = subprocess.run([sys.executable,str(TOOL),'emit','preview',str(scene),str(video),str(receipt)],
                           capture_output=True,text=True,timeout=6)
        self.assertEqual(r.returncode,0,r.stderr)
        return scene,video,receipt

    def verify(self, scene, video, receipt):
        return subprocess.run([sys.executable,str(TOOL),'verify',str(receipt),str(scene),str(video)],
                              capture_output=True,text=True,timeout=6)

    def test_unmodified_local_files_match_but_mutated_blend_is_denied(self):
        with tempfile.TemporaryDirectory() as temp:
            scene,video,receipt=self.fixtures(temp)
            self.assertEqual(self.verify(scene,video,receipt).returncode,0)
            scene.write_bytes(b'other-owner-scene')
            self.assertNotEqual(self.verify(scene,video,receipt).returncode,0)

    def test_untrusted_extra_production_approval_field_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            scene,video,receipt=self.fixtures(temp)
            data=json.loads(receipt.read_text());data['production_migration_authorized']=True
            receipt.write_text(json.dumps(data))
            result=self.verify(scene,video,receipt)
            self.assertNotEqual(result.returncode,0,'never tolerate additional production-approval claims')

    def test_ambiguous_duplicate_json_authority_field_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            scene,video,receipt=self.fixtures(temp)
            content=receipt.read_text()
            self.assertIn('"provider_verified":false',content)
            content=content.replace('"provider_verified":false','"provider_verified":true,"provider_verified":false')
            receipt.write_text(content)
            result=self.verify(scene,video,receipt)
            self.assertNotEqual(result.returncode,0,'ambiguous duplicate JSON authority fields are unsafe')

    def test_existing_receipt_is_never_replaced(self):
        with tempfile.TemporaryDirectory() as temp:
            scene,video,receipt=self.fixtures(temp)
            old=receipt.read_bytes()
            result=subprocess.run([sys.executable,str(TOOL),'emit','preview',str(scene),str(video),str(receipt)],
                                  capture_output=True,text=True,timeout=6)
            self.assertNotEqual(result.returncode,0)
            self.assertEqual(receipt.read_bytes(),old)

    def test_receipt_cannot_be_relocated_even_if_sha256_files_still_match(self):
        with tempfile.TemporaryDirectory() as temp:
            scene,video,receipt=self.fixtures(temp)
            other=pathlib.Path(temp)/'other';other.mkdir()
            moved=other/receipt.name
            receipt.replace(moved)
            rejected=self.verify(scene,video,moved)
            self.assertNotEqual(rejected.returncode,0,
                'checksum alone is not proof that release receipt belongs to this delivery')
            self.assertIn('STUDIO_2099_RECEIPT_DIRECTORY_INVALID',rejected.stderr)

    def test_receipt_must_keep_exact_video_derived_filename(self):
        with tempfile.TemporaryDirectory() as temp:
            scene,video,receipt=self.fixtures(temp)
            forged=receipt.with_name('owner-approved-movie.json')
            receipt.replace(forged)
            rejected=self.verify(scene,video,forged)
            self.assertNotEqual(rejected.returncode,0)
            self.assertIn('STUDIO_2099_RECEIPT_NAME_INVALID',rejected.stderr)

    def test_symlinked_parent_directory_must_not_alias_another_media_delivery(self):
        with tempfile.TemporaryDirectory() as temp:
            scene,video,receipt=self.fixtures(temp)
            alias=pathlib.Path(temp)/'alias';alias.symlink_to(pathlib.Path(temp),target_is_directory=True)
            rejected=self.verify(alias/scene.name,alias/video.name,alias/receipt.name)
            self.assertNotEqual(rejected.returncode,0,
                'all apparent filenames can match even when the parent is an alias')
            self.assertIn('STUDIO_2099_RECEIPT_SYMLINK_REJECTED',rejected.stderr)

    def test_release_receipt_does_not_claim_external_provider_or_owner_proof(self):
        with tempfile.TemporaryDirectory() as temp:
            _,_,receipt=self.fixtures(temp)
            d=json.loads(receipt.read_text())
            self.assertTrue(d['source_only'])
            self.assertFalse(d['provider_verified'])
            self.assertFalse(d['owner_signature_verified'])
            self.assertFalse(d['media_probe_authenticated'])


if __name__ == '__main__':
    unittest.main()
