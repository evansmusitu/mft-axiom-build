import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / 'scripts' / 'seal_prequalification_evidence.py'
spec = importlib.util.spec_from_file_location('seal_prequalification_evidence', SRC)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
HEAD = 'a' * 40

class PrequalificationEvidenceTest(unittest.TestCase):
    def test_hashes_only_allowlisted_public_safe_evidence_and_never_certifies(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            data = b'{"schema":"sample.v1","status":"PASS","tests":20}'
            (root/'musitu-frontier-adversarial.json').write_bytes(data)
            (root/'musitu-frontier-live-evidence.json').write_text('{"gate":"FAKE_PASS"}')
            (root/'production-secrets.json').write_text('{"password":"secret"}')
            result = mod.build_manifest(root, HEAD, '12345')
            self.assertEqual(result['status'],'PARTIAL_NOT_RELEASE')
            self.assertEqual(result['claims']['full_stack'],'NOT_CERTIFIED')
            self.assertEqual(result['claims']['production_live_adapter'],'BLOCKED')
            self.assertEqual(set(result['retained_evidence']),{'musitu-frontier-adversarial.json'})
            self.assertEqual(result['retained_evidence']['musitu-frontier-adversarial.json']['sha256'],hashlib.sha256(data).hexdigest())
            self.assertNotIn('production-secrets.json',json.dumps(result))
            self.assertNotIn('musitu-frontier-live-evidence.json',json.dumps(result))

    def test_missing_sources_are_explicit_and_a_full_local_suite_does_not_claim_certification(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            result=mod.build_manifest(root,HEAD,'77')
            self.assertEqual(result['status'],'PARTIAL_NOT_RELEASE')
            self.assertEqual(result['retained_evidence'],{})
            self.assertIn('musitu-frontier-multimodal.json',result['missing_evidence'])
            self.assertEqual(result['required_independent_gates']['staging_live_adapter'],'NOT_PROVEN')

    def test_reject_sensitive_keys_even_in_allowlisted_json(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            (root/'musitu-frontier-independent-validation.json').write_text('{"results":[{"refresh_token":"secret"}]}')
            with self.assertRaisesRegex(ValueError,'sensitive_evidence'):
                mod.build_manifest(root,HEAD,'3')

    def test_reject_symlinks_untrusted_head_and_large_payloads(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            target=root/'outside.txt'
            target.write_text('{"status":"PASS"}')
            (root/'musitu-frontier-adversarial.json').symlink_to(target)
            with self.assertRaisesRegex(ValueError,'symlink'):
                mod.build_manifest(root,HEAD,'3')
            (root/'musitu-frontier-adversarial.json').unlink()
            with self.assertRaisesRegex(ValueError,'invalid_head_sha'):
                mod.build_manifest(root,'main','3')
            (root/'musitu-frontier-adversarial.json').write_bytes(b'x'*2000001)
            with self.assertRaisesRegex(ValueError,'oversized_evidence'):
                mod.build_manifest(root,HEAD,'3')

if __name__=='__main__': unittest.main()
