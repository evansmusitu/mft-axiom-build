"""Isolated, deterministic mine-source intake adversarial contract tests."""
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from connect.mining_telemetry import MINING_TELEMETRY_SENSORS
import importlib.util
from importlib import import_module


class ExternalSourcePreflightTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.source = self.root / 'partner-private.ndjson'
        self.manifest = self.root / 'source_manifest.json'
        self.start = datetime(2025, 4, 7, tzinfo=timezone.utc)
        self.lines = []
        for i in range(1460):
            row = {k: 0.2 for k in MINING_TELEMETRY_SENSORS if k != 'F_SIDE'}
            row['F_SIDE'] = 'left'
            row['event_time'] = (self.start + timedelta(seconds=i)).isoformat()
            if 940 <= i <= 980 or 1290 <= i <= 1300:
                row['MM263'] = 1.2
            self.lines.append(row)
        self.write_source()

    def write_source(self):
        with self.source.open('w', encoding='utf-8') as f:
            for r in self.lines:
                f.write(json.dumps(r, sort_keys=True, separators=(',', ':')) + '\n')
        self.metadata = {
            'schema': 'musitu.axiom.external_source_manifest.v1',
            'source_format': 'canonical_mining_telemetry_ndjson.v1',
            'source_sha256': hashlib.sha256(self.source.read_bytes()).hexdigest(),
            'site_id': 'partner-mine-17',
            'source_collection_id': 'partner-collection-2025-04',
            'rights_basis': 'Research use authorized by data owner',
            'authorization_reference': 'private owner permission record',
            'provenance_reference': 'partner acquisition log',
            'declared_source_rows': len(self.lines),
            'declared_start_time': self.lines[0]['event_time'],
            'declared_end_time': self.lines[-1]['event_time'],
        }
        self.manifest.write_text(json.dumps(self.metadata), encoding='utf-8')

    def inspect(self):
        return import_module("benchmarks.mining_adapter.external_source_preflight").inspect_external_source(source=self.source, manifest_path=self.manifest)

    def test_real_streaming_windows_and_support_only_never_admit(self):
        self.assertIsNotNone(importlib.util.find_spec("benchmarks.mining_adapter.external_source_preflight"), "External source preflight implementation must exist")
        report = self.inspect()
        self.assertEqual(report['source_rows'], 1460)
        self.assertEqual(report['source_timestamp_discontinuities'], 0)
        self.assertEqual(report['source_integrity'], 'HASH_AND_SCHEMA_VERIFIED')
        self.assertEqual(report['provenance_status'], 'DECLARATIONS_ONLY_NOT_INDEPENDENTLY_VERIFIED')
        self.assertEqual(report['status'], 'RESEARCH_INTAKE_ONLY_NOT_ADMITTED')
        self.assertFalse(report['independent_validation'])
        self.assertFalse(report['production_admission'])
        self.assertEqual(report['required_passing_folds'], 3)
        self.assertEqual(len(report['chronological_support_blocks']), 4)
        self.assertEqual(sum(b['eligible_examples'] for b in report['chronological_support_blocks']), report['eligible_examples'])
        self.assertGreater(report['positive_label_examples'], 0)
        self.assertLessEqual(report['positive_window_overlap_groups'], report['positive_label_examples'])
        self.assertEqual(report['model_evaluation_status'], 'NOT_EXECUTED_NO_FROZEN_MODEL')
        self.assertNotIn('site_id', report)
        self.assertNotIn('authorization_reference', report)
        self.assertNotIn('raw_rows', report)

    def test_refuses_repackaging_public_dataset_as_new_mine(self):
        self.metadata['source_sha256'] = '28e2eed4c4a314daa4319f656a09bb43d8acea603dcb906e31c98049c91a8fdc'
        self.manifest.write_text(json.dumps(self.metadata), encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'source_is_known_development_dataset'):
            self.inspect()

    def test_source_hash_mismatch_fails_closed(self):
        self.metadata['source_sha256'] = 'e'*64
        self.manifest.write_text(json.dumps(self.metadata), encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'source_sha256_mismatch'):
            self.inspect()

    def test_rejects_missing_rights_or_provenance_attestation(self):
        for name in ['rights_basis', 'authorization_reference', 'provenance_reference']:
            with self.subTest(name=name):
                existing = self.metadata[name]
                self.metadata[name] = ' '
                self.manifest.write_text(json.dumps(self.metadata), encoding='utf-8')
                with self.assertRaisesRegex(ValueError, 'declarations_incomplete'):
                    self.inspect()
                self.metadata[name] = existing

    def test_duplicate_or_out_of_order_timestamps_fail_even_when_hash_matches(self):
        self.lines[820]['event_time'] = self.lines[819]['event_time']
        self.write_source()
        with self.assertRaisesRegex(ValueError, 'timestamp_order_invalid'):
            self.inspect()

    def test_missing_required_sensor_fails_even_when_hash_matches(self):
        self.lines[820].pop('MM263')
        self.write_source()
        with self.assertRaisesRegex(ValueError, 'schema_invalid'):
            self.inspect()

    def test_nonfinite_sensor_or_boolean_sensor_is_rejected(self):
        self.lines[810]['MM263'] = float('nan')
        self.write_source()
        with self.assertRaisesRegex(ValueError, 'sensor_not_finite'):
            self.inspect()
        self.lines[810]['MM263'] = True
        self.write_source()
        with self.assertRaisesRegex(ValueError, 'sensor_invalid'):
            self.inspect()

    def test_timestamp_gap_resets_window_and_is_reported(self):
        for item in self.lines[1200:]:
            current = datetime.fromisoformat(item['event_time']) + timedelta(seconds=15)
            item['event_time'] = current.isoformat()
        self.write_source()
        report=self.inspect()
        self.assertEqual(report['source_timestamp_discontinuities'], 1)
        self.assertGreater(report['eligible_examples'], 0)

    def test_declared_observation_span_or_row_count_cannot_be_forged(self):
        self.metadata['declared_source_rows'] += 1
        self.manifest.write_text(json.dumps(self.metadata), encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'declared_source_rows_mismatch'):
            self.inspect()
        self.metadata['declared_source_rows'] -= 1
        self.metadata['declared_end_time'] = '2026-01-01T00:00:00+00:00'
        self.manifest.write_text(json.dumps(self.metadata), encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'declared_time_span_mismatch'):
            self.inspect()

    def test_cli_emits_private_safe_evidence_without_overwriting(self):
        output=self.root / 'safe-evidence.json'
        command=[sys.executable, '-m', 'benchmarks.mining_adapter.external_source_preflight',
                 '--source', str(self.source), '--manifest', str(self.manifest),
                 '--output', str(output)]
        first=subprocess.run(command,capture_output=True,text=True,check=False)
        self.assertEqual(first.returncode,0,first.stderr)
        report=json.loads(output.read_text())
        self.assertEqual(report['source_rows'],1460)
        self.assertFalse(report['independent_validation'])
        self.assertFalse(report['production_admission'])
        before=output.read_bytes()
        second=subprocess.run(command,capture_output=True,text=True,check=False)
        self.assertNotEqual(second.returncode,0)
        self.assertIn('output_already_exists',second.stderr)
        self.assertEqual(output.read_bytes(),before)

    def test_cli_does_not_emit_evidence_after_failure(self):
        output=self.root / 'should-not-exist.json'
        self.metadata['source_sha256']='a'*64
        self.manifest.write_text(json.dumps(self.metadata),encoding='utf-8')
        result=subprocess.run([
            sys.executable,'-m','benchmarks.mining_adapter.external_source_preflight',
            '--source',str(self.source),'--manifest',str(self.manifest),'--output',str(output),
        ],capture_output=True,text=True,check=False)
        self.assertNotEqual(result.returncode,0)
        self.assertFalse(output.exists())

    def test_too_short_data_cannot_claim_prediction_readiness(self):
        self.lines=self.lines[:900]
        self.write_source()
        with self.assertRaisesRegex(ValueError,'no_complete_forecast_windows'):
            self.inspect()

    def test_safety_no_claim_even_if_high_support(self):
        report=self.inspect()
        self.assertTrue(all(block['validation_role']=='DESCRIPTIVE_ONLY' for block in report['chronological_support_blocks']))
        self.assertFalse(report['ready_for_production'])
        self.assertEqual(report['qualification_gate'], 'NOT_EVALUATED')


if __name__ == '__main__':
    unittest.main()
