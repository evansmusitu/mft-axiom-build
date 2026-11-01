"""Synthetic-only numeric token fidelity tests for direct external source intake."""
import hashlib
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from benchmarks.mining_adapter.external_source_preflight import (
    _load_unique_json, _read_manifest, inspect_external_source,
)
from connect.mining_telemetry import MINING_TELEMETRY_SENSORS


class ExternalSourceNumericFidelityTests(unittest.TestCase):
    def test_rejects_excess_precision_fraction(self):
        with self.assertRaisesRegex(ValueError, 'external_source_numeric_precision_loss'):
            _load_unique_json('{"MM263":0.12345678901234567890123456789}')

    def test_rejects_integer_rounded_by_float_feature_builder(self):
        with self.assertRaisesRegex(ValueError, 'external_source_numeric_precision_loss'):
            _load_unique_json('{"MM263":9007199254740993}')

    def test_rejects_exponent_underflow_and_overflow(self):
        for literal in ('1e-400', '1e400', '-1e400'):
            with self.subTest(literal=literal):
                with self.assertRaisesRegex(ValueError, 'external_source_numeric_precision_loss'):
                    _load_unique_json('{"MM263":' + literal + '}')

    def test_rejects_nonstandard_json_constants_in_nested_payloads(self):
        for literal in ('NaN', 'Infinity', '-Infinity'):
            with self.subTest(literal=literal):
                with self.assertRaisesRegex(ValueError, 'external_source_nonfinite_json_constant'):
                    _load_unique_json('{"nested":{"extra":' + literal + '}}')

    def test_preserves_ordinary_numeric_and_scientific_tokens(self):
        raw = _load_unique_json('{"MM263":2e-1,"MM264":9007199254740992,"F_SIDE":1}')
        self.assertEqual(raw['MM263'], 0.2)
        self.assertEqual(raw['MM264'], 9007199254740992)
        self.assertEqual(raw['F_SIDE'], 1)
        self.assertIs(type(raw['MM264']), int)

    def test_direct_pinned_stream_rejects_precision_loss_without_admission(self):
        with tempfile.TemporaryDirectory() as tmp:
            source, manifest = Path(tmp) / 'mine.ndjson', Path(tmp) / 'manifest.json'
            start = datetime(2025, 1, 1, tzinfo=timezone.utc)
            with source.open('w', encoding='utf-8') as output:
                for second in range(1250):
                    row = {sensor: 0.2 for sensor in MINING_TELEMETRY_SENSORS if sensor != 'F_SIDE'}
                    row.update(F_SIDE='left', event_time=(start+timedelta(seconds=second)).isoformat())
                    output.write(json.dumps(row, sort_keys=True, separators=(',', ':')) + '\n')
            manifest_obj = {
                'schema': 'musitu.axiom.external_source_manifest.v1',
                'source_format': 'canonical_mining_telemetry_ndjson.v1',
                'site_id': 'synthetic-fixture', 'source_collection_id': 'synthetic-fixture',
                'rights_basis': 'fictional fixture', 'authorization_reference': 'fictional fixture',
                'provenance_reference': 'fictional fixture',
                'declared_source_rows': 1250,
                'declared_start_time': start.isoformat(),
                'declared_end_time': (start+timedelta(seconds=1249)).isoformat(),
            }
            manifest_obj['source_sha256'] = hashlib.sha256(source.read_bytes()).hexdigest()
            manifest.write_text(json.dumps(manifest_obj))
            valid = inspect_external_source(source=source, manifest_path=manifest)
            self.assertEqual(valid['status'], 'RESEARCH_INTAKE_ONLY_NOT_ADMITTED')
            self.assertFalse(valid['independent_validation'])
            self.assertFalse(valid['production_admission'])

            original = source.read_text(encoding='utf-8')
            self.assertIn('"MM263":0.2', original)
            source.write_text(original.replace('"MM263":0.2',
                               '"MM263":0.12345678901234567890123456789', 1), encoding='utf-8')
            manifest_obj['source_sha256'] = hashlib.sha256(source.read_bytes()).hexdigest()
            manifest.write_text(json.dumps(manifest_obj))
            with self.assertRaisesRegex(ValueError, 'external_source_numeric_precision_loss'):
                inspect_external_source(source=source, manifest_path=manifest)

            manifest_obj['extra_audit_measurement'] = float('nan')
            manifest.write_text(json.dumps(manifest_obj))
            with self.assertRaisesRegex(ValueError, 'external_source_nonfinite_json_constant'):
                _read_manifest(manifest)


if __name__ == '__main__':
    unittest.main()
