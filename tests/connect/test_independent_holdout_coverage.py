"""Synthetic-only adversarial tests for pinned exact-fold coverage; not mine evidence."""
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from benchmarks.mining_adapter.independent_holdout_protocol import (
    FROZEN_MANIFEST_SHA, FROZEN_MODEL_SHA, FROZEN_THRESHOLD,
    seal_holdout_protocol,
)
from benchmarks.mining_adapter.independent_holdout_coverage import inspect_fold_coverage
from connect.mining_telemetry import MINING_TELEMETRY_SENSORS

START = datetime(2025, 1, 1, tzinfo=timezone.utc)


def stamp(i):
    return (START + timedelta(seconds=i)).isoformat()


class HoldoutCoverageTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        d = Path(tmp.name)
        self.source, self.manifest, self.mapping = [d / n for n in ('raw.ndjson', 'manifest.json', 'mapping.json')]
        self.seal, self.draft = d / 'seal.json', d / 'draft.json'
        self.mapping.write_text('{"synthetic_only":true}\n')
        self.rows = []
        for i in range(5400):
            row = {k: 0.2 for k in MINING_TELEMETRY_SENSORS if k != 'F_SIDE'}
            row['F_SIDE'] = 'left'
            row['event_time'] = stamp(i)
            if 1200 <= i <= 1210:
                row['MM263'] = 1.1
            self.rows.append(row)
        self.write_source()
        self.protocol = {
            'schema': 'musitu.axiom.independent_holdout_protocol.v1',
            'candidate_alias': 'anonymous-synthetic-test',
            'source_lineage_identifier': 'synthetic-private-fixture',
            'canonical_source_sha256': self.source_sha,
            'frozen_model_manifest_sha256': FROZEN_MANIFEST_SHA,
            'frozen_model_sha256': FROZEN_MODEL_SHA,
            'sensor_mapping_sha256': hashlib.sha256(self.mapping.read_bytes()).hexdigest(),
            'source_owner_rights_reference': 'unverified-test-only',
            'provenance_reference': 'unverified-test-only',
            'source_start_time': stamp(0), 'source_end_time': stamp(5399),
            'history_seconds': 600, 'label_horizon_start_seconds': 180,
            'label_horizon_end_seconds': 360, 'sample_stride_seconds': 30,
            'observed_methane_warning_threshold': 1.0,
            'frozen_model_score_threshold': FROZEN_THRESHOLD,
            'minimum_positive_windows_per_supported_fold': 500,
            'required_supported_folds': 3, 'required_recall': 0.90,
            'required_precision': 0.10, 'required_f2_gain_fraction': 0.05,
            'holdout_training_prohibited': True,
            'folds': [
                {'fold': i+1, 'first_feature_time': stamp(720+i*1020),
                 'last_feature_time': stamp(780+i*1020)} for i in range(4)
            ],
        }
        self.seal_protocol()

    def write_source(self):
        with self.source.open('w') as f:
            for row in self.rows:
                f.write(json.dumps(row, sort_keys=True, separators=(',', ':'))+'\n')
        self.source_sha = hashlib.sha256(self.source.read_bytes()).hexdigest()
        self.manifest.write_text(json.dumps({
            'schema': 'musitu.axiom.external_source_manifest.v1',
            'source_format': 'canonical_mining_telemetry_ndjson.v1',
            'source_sha256': self.source_sha,
            'site_id': 'synthetic-test-only', 'source_collection_id': 'synthetic-test-only',
            'rights_basis': 'unverified-test-only',
            'authorization_reference': 'unverified-test-only',
            'provenance_reference': 'unverified-test-only',
            'declared_source_rows': len(self.rows),
            'declared_start_time': self.rows[0]['event_time'],
            'declared_end_time': self.rows[-1]['event_time'],
        }))

    def seal_protocol(self):
        self.draft.write_text(json.dumps(self.protocol))
        self.seal.unlink(missing_ok=True)
        self.pin = seal_holdout_protocol(protocol_path=self.draft,
                                          output_path=self.seal)['protocol_sha256']

    def audit(self):
        return inspect_fold_coverage(source=self.source, manifest_path=self.manifest,
                                     mapping_path=self.mapping, seal_path=self.seal,
                                     expected_protocol_sha256=self.pin)

    def test_exact_grids_do_not_certify_model_or_rights(self):
        result = self.audit()
        self.assertEqual(result['complete_fold_grids'], 4)
        self.assertEqual(result['source_timestamp_discontinuities'], 0)
        self.assertEqual(result['supported_folds'], 0)
        self.assertTrue(all(x['observed_on_grid_feature_windows'] == 3 for x in result['folds']))
        self.assertFalse(result['independent_validation'])
        self.assertFalse(result['production_admission'])
        self.assertFalse(result['model_predictions_evaluated'])
        self.assertNotIn('site_id', result)
        self.assertNotIn('rights_basis', result)

    def test_missing_on_grid_second_blocks_fold_completeness(self):
        # A 1-second discontinuity resets the 600-second feature history.
        self.rows.pop(740)
        self.write_source()
        self.protocol['canonical_source_sha256'] = self.source_sha
        self.protocol['source_end_time'] = stamp(5399)
        self.seal_protocol()
        result = self.audit()
        self.assertFalse(result['folds'][0]['grid_complete_no_extra_phase'])
        self.assertLess(result['complete_fold_grids'], 4)
        self.assertGreater(result['source_timestamp_discontinuities'], 0)

    def test_manifest_modified_during_sealed_audit_fails_closed(self):
        from unittest.mock import patch
        import benchmarks.mining_adapter.independent_holdout_coverage as auditor
        original_stream = auditor._stream_source

        def mutate_manifest(source, state):
            for index, row in enumerate(original_stream(source, state)):
                if index == 700:
                    # A syntactically valid manifest with different bytes is
                    # not the pinned input read before this scan.
                    self.manifest.write_text(self.manifest.read_text() + ' ')
                yield row

        with patch.object(auditor, '_stream_source', mutate_manifest):
            with self.assertRaisesRegex(ValueError, 'holdout_coverage_input_changed_or_manifest_mismatch'):
                self.audit()

    def test_source_and_mapping_frozen_sha_mismatch_are_rejected(self):
        self.mapping.write_text('changed')
        with self.assertRaisesRegex(ValueError, 'mapping_pin_mismatch'):
            self.audit()
        self.mapping.write_text('{"synthetic_only":true}\n')
        self.rows[4000]['MM263'] = 0.9
        self.write_source()
        with self.assertRaisesRegex(ValueError, 'source_pin_mismatch'):
            self.audit()

    def test_unpinned_modified_seal_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'protocol_sha256_mismatch'):
            inspect_fold_coverage(source=self.source, manifest_path=self.manifest,
                                  mapping_path=self.mapping, seal_path=self.seal,
                                  expected_protocol_sha256='a'*64)

    def test_cli_writes_once_and_never_overwrites_evidence(self):
        output = self.draft.parent / 'private-safe-report.json'
        cmd = [sys.executable, '-m', 'benchmarks.mining_adapter.independent_holdout_coverage',
               '--source', str(self.source), '--manifest', str(self.manifest),
               '--mapping', str(self.mapping), '--seal', str(self.seal),
               '--expected-protocol-sha256', self.pin, '--output', str(output)]
        result = subprocess.run(cmd, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        first = output.read_bytes()
        self.assertFalse(json.loads(first)['production_admission'])
        second = subprocess.run(cmd, capture_output=True, text=True)
        self.assertNotEqual(second.returncode, 0)
        self.assertIn('output_exists_or_input', second.stderr)
        self.assertEqual(output.read_bytes(), first)


if __name__ == '__main__':
    unittest.main()
