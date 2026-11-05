"""Fail-closed, non-enabling evidence for rejected public telemetry source bytes.

No network is used. A failed provider download/checksum must produce an
immutable, sanitized reason artifact without opening the methane safety gate.
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / '.github/workflows/musitu-connect-real-mine-telemetry.yml'


class TelemetryAcquisitionFailureTests(unittest.TestCase):
    def invoke(self, output, *, http_status='401', reason='OPENML_CHECKSUM_MISMATCH'):
        return subprocess.run([
            sys.executable, '-m', 'qualification.telemetry_source_failure',
            '--output', str(output), '--mendeley-http-status', http_status,
            '--reason', reason,
        ], cwd=ROOT, capture_output=True, text=True, timeout=10)

    def test_checksum_mismatch_emits_immutable_non_enabling_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'acquisition.json'
            result = self.invoke(path)
            self.assertEqual(result.returncode, 0, result.stderr)
            item = json.loads(path.read_text(encoding='utf-8'))
            self.assertEqual(item['schema'], 'musitu.connect.public_telemetry_acquisition_failure.v1')
            self.assertEqual(item['source_dataset_id'], 'yd7vw4c5mk')
            self.assertEqual(item['openml_dataset_id'], 42701)
            self.assertEqual(item['mendeley_http_status'], '401')
            self.assertEqual(item['reason'], 'OPENML_CHECKSUM_MISMATCH')
            self.assertEqual(item['status'], 'PUBLIC_SOURCE_BYTES_NOT_VERIFIED')
            for field in ('source_integrity_verified', 'source_ingestion_qualified',
                          'independent_mine_validation', 'customer_admission_authorized',
                          'production_methane_prediction_authorized'):
                self.assertIs(item[field], False, field)
            self.assertNotIn('Bearer', path.read_text())
            self.assertNotIn('token', path.read_text().lower())
            self.assertEqual(set(item), {
                'schema', 'source_dataset_id', 'openml_dataset_id',
                'mendeley_http_status', 'reason', 'status',
                'source_integrity_verified', 'source_ingestion_qualified',
                'independent_mine_validation', 'customer_admission_authorized',
                'production_methane_prediction_authorized',
            })

    def test_missing_http_response_is_explicit_and_never_reported_as_401(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'unavailable.json'
            result = self.invoke(path, http_status='000',
                                 reason='PUBLIC_SOURCE_ACQUISITION_INCOMPLETE')
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(path.read_text())['mendeley_http_status'], '000')

    def test_untrusted_codes_and_free_text_never_reach_artifact_or_logs(self):
        invalid = [
            ('401\nAuthorization: Bearer secret', 'OPENML_CHECKSUM_MISMATCH'),
            ('Bearer secret', 'OPENML_CHECKSUM_MISMATCH'),
            ('200', 'Bearer secret'),
            ('401', 'UNREVIEWED_SOURCE_APPROVED'),
            ('-1', 'OPENML_CHECKSUM_MISMATCH'),
            ('099', 'OPENML_CHECKSUM_MISMATCH'),
        ]
        with tempfile.TemporaryDirectory() as directory:
            for index, (status, reason) in enumerate(invalid):
                with self.subTest(index=index):
                    path = Path(directory) / f'bad_{index}.json'
                    result = self.invoke(path, http_status=status, reason=reason)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertFalse(path.exists())
                    self.assertNotIn('Bearer secret', result.stderr + result.stdout)
                    self.assertNotIn('Authorization:', result.stderr + result.stdout)

    def test_existing_evidence_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'evidence.json'
            path.write_text('PRESERVE_EXISTING_ARTIFACT', encoding='utf-8')
            result = self.invoke(path)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(path.read_text(), 'PRESERVE_EXISTING_ARTIFACT')

    def test_workflow_archives_failures_and_never_bypasses_checksum_validation(self):
        workflow = WORKFLOW.read_text(encoding='utf-8')
        self.assertIn('tests.connect.test_telemetry_source_failure', workflow)
        self.assertIn('qualification/telemetry_source_failure.py', workflow)
        self.assertIn('OpenMLHashException', workflow)
        self.assertIn('OPENML_CHECKSUM_MISMATCH', workflow)
        self.assertIn('source_acquisition_failure.json', workflow)
        self.assertIn('if: always()', workflow)
        self.assertIn('retention-days: 90', workflow)
        self.assertIn('sha256sum "$SOURCE_PATH"', workflow)
        self.assertIn('real_telemetry/*.json', workflow)
        self.assertIn('CUSTOMER_RELEASE_AUTHORIZED=false', workflow)


if __name__ == '__main__':
    unittest.main()
