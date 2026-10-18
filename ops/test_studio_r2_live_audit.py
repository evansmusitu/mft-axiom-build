import hashlib
import json
import unittest
from studio_r2_live_audit import summarize_state, check_asset


class ReadOnlyAuditTests(unittest.TestCase):
    def test_completed_job_emits_allowlisted_counts_not_private_state(self):
        ident = 'a' * 8 + '-aaaa-4aaa-aaaa-' + 'a' * 12
        files = {name: {'key': f'jobs/{ident}/{name}', 'sha256': 'b' * 64, 'bytes': 1024}
                 for name in ('scene.blend', 'scene.glb', 'preview.png')}
        data = {'revision': 7, 'projects': [{'title': 'PRIVATE CONFIDENTIAL'}],
                'jobs': [{'id': ident, 'state': 'COMPLETED', 'assets': files, 'error': 'secret'}],
                'audit': [{'details': {'token': 'hidden'}}]}
        result, manifest = summarize_state(json.dumps(data).encode('utf-8'))
        self.assertEqual(result['completed_count'], 1)
        self.assertEqual(result['revision'], 7)
        self.assertEqual(result['browser_initiated_verified'], False)
        self.assertEqual(len(manifest), 3)
        for private in ('PRIVATE', 'CONFIDENTIAL', 'hidden', 'secret', ident):
            self.assertNotIn(private, str(result))
        self.assertEqual(sorted(manifest), ['preview.png', 'scene.blend', 'scene.glb'])

    def test_reject_path_traversal_and_corrupt_job_records(self):
        j = 'a' * 8 + '-aaaa-4aaa-aaaa-' + 'a' * 12
        bad = {'revision': 1, 'projects': [], 'audit': [], 'jobs': [
            {'id': j, 'state': 'COMPLETED', 'assets': {'scene.blend': {
                'key': f'jobs/{j}/../../private', 'bytes': 1024, 'sha256': 'b' * 64}}}]}
        with self.assertRaises(ValueError):
            summarize_state(json.dumps(bad).encode('utf-8'))

    def test_exact_binary_integrity_and_header_not_mocked(self):
        blob = bytearray(1024)
        blob[:7] = b'BLENDER'
        metadata = {'bytes': 1024, 'sha256': hashlib.sha256(blob).hexdigest()}
        self.assertTrue(check_asset('scene.blend', bytes(blob), metadata))
        blob[999] = 99
        self.assertFalse(check_asset('scene.blend', bytes(blob), metadata))
        self.assertFalse(check_asset('scene.glb', bytes(blob), metadata))

    def test_noncompleted_jobs_cannot_claim_artifact_or_browser_proof(self):
        data = {'revision': 0, 'projects': [], 'audit': [], 'jobs': [
            {'state': 'RUNNING', 'id': 'private-uuid'}, {'state': 'PENDING_APPROVAL'}]}
        result, manifest = summarize_state(json.dumps(data).encode())
        self.assertEqual(manifest, {})
        self.assertEqual(result['running_count'], 1)
        self.assertEqual(result['completed_count'], 0)
        self.assertFalse(result['browser_initiated_verified'])


if __name__ == '__main__':
    unittest.main()
