"""Pinned-model exact preregistered-fold inference on GENERATED synthetic mine-like rows.

No independent source, operational incident or authorized customer is involved.
"""
import importlib
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tests.connect.test_independent_holdout_coverage import HoldoutCoverageTests

BUNDLE = os.environ.get('AXIOM_FROZEN_REAL_BUNDLE_DIR')


@unittest.skipUnless(BUNDLE, 'requires SHA-verified published native model artifact')
class IndependentHoldoutReplayTests(unittest.TestCase):
    def setUp(self):
        self.fixture = HoldoutCoverageTests('test_exact_grids_do_not_certify_model_or_rights')
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)

    @staticmethod
    def module():
        # A missing replay capability is a failing contract, not a passing
        # skip. The RED test must demonstrate the missing engineering seam.
        try:
            return importlib.import_module(
                'benchmarks.mining_adapter.independent_holdout_replay')
        except ModuleNotFoundError as exc:
            raise AssertionError('independent_holdout_replay_capability_missing') from exc

    def replay(self, **overrides):
        module = self.module()
        case = self.fixture
        args = dict(source=case.source, manifest_path=case.manifest,
                    mapping_path=case.mapping, seal_path=case.seal,
                    expected_protocol_sha256=case.pin, bundle_dir=Path(BUNDLE))
        args.update(overrides)
        return module.evaluate_exact_holdout_folds(**args)

    def test_exact_four_folds_are_scored_but_never_admitted(self):
        result = self.replay()
        self.assertEqual(result['schema'],
                         'musitu.axiom.independent_holdout_frozen_replay.v1')
        self.assertEqual(result['protocol_sha256'], self.fixture.pin)
        self.assertEqual(len(result['folds']), 4)
        self.assertTrue(result['model_predictions_evaluated'])
        self.assertEqual(result['complete_fold_grids'], 4)
        self.assertEqual(sum(f['test_examples'] for f in result['folds']), 12)
        for item in result['folds']:
            self.assertEqual(item['test_examples'], 3)
            self.assertEqual(
                sum(item['model'][k] for k in ('tp','tn','fp','fn')), 3)
            self.assertEqual(
                sum(item['baseline'][k] for k in ('tp','tn','fp','fn')), 3)
            self.assertFalse(item['positive_windows_are_independent_events'])
            self.assertFalse(item['production_admission'])
        for field in ('independent_validation','production_admission',
                      'production_methane_prediction_qualified',
                      'original_four_fold_gate_satisfied',
                      'preregistration_predates_label_access_verified',
                      'external_source_authenticated',
                      'operational_safety_qualified',
                      'model_retrained','threshold_recalibrated'):
            self.assertIs(result[field],False,field)
        self.assertEqual(result['folds_with_positive_support'],0)
        self.assertNotIn('site_id',result)
        self.assertNotIn('rights_basis',result)

    def test_positive_windows_are_future_only_and_support_remains_unqualified(self):
        case=self.fixture
        for i in range(940, 950):
            case.rows[i]['MM263']=1.2
        case.write_source()
        case.protocol['canonical_source_sha256']=case.source_sha
        case.seal_protocol()
        result=self.replay()
        fold=result['folds'][0]
        self.assertGreater(fold['positive_future_label_windows'],0)
        self.assertEqual(fold['model']['tp']+fold['model']['fn'],
                         fold['positive_future_label_windows'])
        self.assertFalse(fold['positive_support_threshold_met'])
        self.assertIs(result['production_admission'],False)

    def test_incomplete_fold_grid_fails_closed_without_partial_performance(self):
        case=self.fixture
        case.rows.pop(740)
        case.write_source()
        case.protocol['canonical_source_sha256']=case.source_sha
        case.seal_protocol()
        with self.assertRaisesRegex(ValueError,'holdout_replay_grid_incomplete'):
            self.replay()

    def test_mapping_and_published_model_identity_are_immutable(self):
        case=self.fixture
        case.mapping.write_text('tampered private mapping')
        with self.assertRaisesRegex(ValueError,'holdout_coverage_mapping_pin_mismatch'):
            self.replay()
        case.mapping.write_text('{"synthetic_only":true}\n')
        with tempfile.TemporaryDirectory() as tmp:
            from shutil import copytree
            bundle=copytree(BUNDLE,Path(tmp)/'tampered')
            (bundle/'model.txt').write_bytes(
                (bundle/'model.txt').read_bytes()+b'\n# altered research model')
            with self.assertRaisesRegex(ValueError,'frozen_model_sha256_mismatch'):
                self.replay(bundle_dir=bundle)

    def test_exclusive_output_and_no_input_overwrite(self):
        module=self.module()
        case=self.fixture
        target=case.source.parent/'private-replay-summary.json'
        marker='another writer has already created this evidence'
        target.write_text(marker,encoding='utf-8')
        argv=['independent_holdout_replay',
              '--source',str(case.source),'--manifest',str(case.manifest),
              '--mapping',str(case.mapping),'--seal',str(case.seal),
              '--bundle',str(BUNDLE),'--expected-protocol-sha256',case.pin,
              '--output',str(target)]
        with patch.object(sys,'argv',argv):
            with self.assertRaisesRegex(FileExistsError,
                                        'holdout_replay_output_exists_or_input'):
                module.main()
        self.assertEqual(target.read_text(),marker)


if __name__=='__main__':
    unittest.main()
