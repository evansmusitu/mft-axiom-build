"""Fail-closed synthetic source readback tests; no secrets/provider access."""
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from qualification.verify_axiom_public_source_readback import (
    APPROVED_SOURCE, assess_readback, load_manifest,
)

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / 'qualification/verify_axiom_public_source_readback.py'


def fixture(sha, size, *, mutated=False):
    return {
        'schema': 'musitu.axiom.reviewer-fixes.readback.v1',
        'mutation_performed': mutated,
        'workers': {
            'musitu-axiom-mcp': {
                'modules': {'index.mjs': {'sha256': sha, 'bytes': size}}
            }
        }
    }


class AxiomPublicReadbackTests(unittest.TestCase):
    def test_identical_capture_does_not_qualify_public_release(self):
        source = APPROVED_SOURCE.read_bytes()
        record = fixture(hashlib.sha256(source).hexdigest(), len(source))
        proof = assess_readback(record, source)
        self.assertEqual(proof['status'], 'BYTE_IDENTICAL_CAPTURE_NOT_CERTIFIED')
        self.assertTrue(proof['source_byte_match'])
        self.assertFalse(proof['source_provenance_qualified'])
        self.assertFalse(proof['release_authorized'])
        self.assertFalse(proof['commercial_ga_qualified'])

    def test_real_observed_module_mismatch_remains_blocked(self):
        source = APPROVED_SOURCE.read_bytes()
        report = assess_readback(fixture(
            'decaaebad4d8052e7c345e574819204558731d8ab32f8da24205493f24edb08e',
            33292,
        ), source)
        self.assertEqual(report['status'], 'UNRECONCILED_DEPLOYED_SCRIPT')
        self.assertFalse(report['source_byte_match'])
        self.assertFalse(report['release_authorized'])

    def test_mutated_or_malformed_capture_denied_without_raw_values(self):
        source = APPROVED_SOURCE.read_bytes()
        clean = fixture(hashlib.sha256(source).hexdigest(), len(source))
        for case in ('mutated', 'no_worker', 'bad_schema', 'bad_digest', 'zero_size'):
            with self.subTest(case=case):
                data = json.loads(json.dumps(clean))
                if case == 'mutated':
                    data['mutation_performed'] = True
                if case == 'no_worker':
                    del data['workers']['musitu-axiom-mcp']
                if case == 'bad_schema':
                    data['schema'] = 'evil'
                if case == 'bad_digest':
                    data['workers']['musitu-axiom-mcp']['modules']['index.mjs']['sha256'] = 'PRIVATE_NOT_HEX'
                if case == 'zero_size':
                    data['workers']['musitu-axiom-mcp']['modules']['index.mjs']['bytes'] = 0
                report = assess_readback(data, source)
                self.assertEqual(report['status'], 'INVALID_READBACK')
                self.assertNotIn('PRIVATE_NOT_HEX', json.dumps(report))

    def test_manifest_parser_deny_duplicate_and_oversize(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'manifest.json'
            for payload in ('{"schema":"x","schema":"y"}', ' ' * 70000,
                            '{"test":NaN}'):
                with self.subTest(payload_length=len(payload)):
                    path.write_text(payload)
                    with self.assertRaises(ValueError):
                        load_manifest(path)

    def test_cli_fails_closed_for_current_observed_drift(self):
        source = APPROVED_SOURCE.read_bytes()
        data = fixture('decaaebad4d8052e7c345e574819204558731d8ab32f8da24205493f24edb08e',
                       33292)
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            manifest, out = root / 'manifest.json', root / 'report.json'
            manifest.write_text(json.dumps(data))
            result = subprocess.run(
                [sys.executable, str(SCRIPT), '--manifest', str(manifest),
                 '--output', str(out)],
                cwd=ROOT, capture_output=True, text=True, timeout=15)
            self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
            self.assertIn('UNRECONCILED_DEPLOYED_SCRIPT', result.stdout)
            proof = json.loads(out.read_text())
            self.assertEqual(proof['approved_source_sha256'],
                             hashlib.sha256(source).hexdigest())
            self.assertFalse(proof['openai_submission_ready'])
            self.assertFalse(proof['release_authorized'])


if __name__ == '__main__':
    unittest.main()
