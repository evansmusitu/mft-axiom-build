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
            proxy=item['window_proxy_audit']
            self.assertEqual(proxy['window_count'],3)
            self.assertEqual(proxy['positive_label_windows'],item['positive_future_label_windows'])
            self.assertEqual(proxy['false_alert_windows'],item['model']['fp'])
            self.assertFalse(proxy['overlap_groups_are_unique_incidents'])
            self.assertFalse(proxy['false_alert_streaks_are_operational_alarm_events'])
            self.assertFalse(proxy['trace_digest_proves_source_authenticity'])
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
        self.assertGreaterEqual(fold['window_proxy_audit']['positive_window_overlap_groups'],1)
        self.assertFalse(fold['window_proxy_audit']['overlap_groups_are_unique_incidents'])
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

    def test_verified_seal_changed_before_replay_parse_is_rejected(self):
        module=self.module()
        original=module.verify_holdout_seal
        case=self.fixture

        def swap_after_verification(*args, **kwargs):
            result=original(*args, **kwargs)
            # The earlier fold-coverage scan used original sealed bytes.
            # Even syntactically harmless changes after verification must
            # not become the new unpinned evidence read by the replay.
            case.seal.write_bytes(case.seal.read_bytes()+b' ')
            return result

        with patch.object(module,'verify_holdout_seal',
                          side_effect=swap_after_verification):
            with self.assertRaisesRegex(
                    ValueError, 'holdout_replay_seal_changed_after_verification'):
                self.replay()

    def test_swapped_fold_grids_cannot_claim_original_protocol_digest(self):
        module=self.module()
        original=module.verify_holdout_seal
        case=self.fixture

        def substitute_another_protocol(*args, **kwargs):
            result=original(*args, **kwargs)
            raw=json.loads(case.seal.read_text(encoding='utf-8'))
            # Exactly three 30-second features still exist on this shifted
            # fold. Coverage counts alone would not prove their identity.
            raw['protocol']['folds'][0]['first_feature_time']=(
                case.rows[750]['event_time'])
            raw['protocol']['folds'][0]['last_feature_time']=(
                case.rows[810]['event_time'])
            case.seal.write_text(json.dumps(raw),encoding='utf-8')
            return result

        with patch.object(module,'verify_holdout_seal',
                          side_effect=substitute_another_protocol):
            with self.assertRaisesRegex(
                    ValueError, 'holdout_replay_seal_changed_after_verification'):
                self.replay()

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

    def test_source_manifest_changed_during_second_pass_rejected(self):
        module=self.module()
        original=module._stream_source
        case=self.fixture

        def mutate_manifest(source,state):
            for number,row in enumerate(original(source,state)):
                if number==1200:
                    case.manifest.write_bytes(case.manifest.read_bytes()+b' ')
                yield row

        with patch.object(module,'_stream_source',side_effect=mutate_manifest):
            with self.assertRaisesRegex(ValueError,'holdout_replay_inputs_changed'):
                self.replay()

    def test_invalid_model_scores_do_not_generate_a_research_report(self):
        from types import SimpleNamespace
        module=self.module()
        real_load=module.load_frozen_bundle
        def broken_predictor(*args,**kwargs):
            bundle=real_load(*args,**kwargs)
            return SimpleNamespace(
                manifest=bundle.manifest,
                manifest_sha256=bundle.manifest_sha256,
                predict=lambda examples:[float('nan')]*len(examples))
        with patch.object(module,'load_frozen_bundle',side_effect=broken_predictor):
            with self.assertRaisesRegex(
                    ValueError,'holdout_replay_score_nonfinite_or_out_of_range'):
                self.replay()

    def test_successful_cli_emits_one_deidentified_immutable_research_report(self):
        module=self.module()
        case=self.fixture
        target=case.source.parent/'research_only_four_fold_metrics.json'
        argv=['independent_holdout_replay',
              '--source',str(case.source),'--manifest',str(case.manifest),
              '--mapping',str(case.mapping),'--seal',str(case.seal),
              '--bundle',str(BUNDLE),'--expected-protocol-sha256',case.pin,
              '--output',str(target)]
        with patch.object(sys,'argv',argv):
            module.main()
        output=target.read_text(encoding='utf-8')
        result=json.loads(output)
        self.assertEqual(len(result['folds']),4)
        self.assertTrue(result['model_predictions_evaluated'])
        self.assertFalse(result['production_admission'])
        for private in ('synthetic-test-only', 'synthetic-private-fixture',
                        'source_owner_rights_reference', 'site_id',
                        'rights_basis', 'provenance_reference'):
            self.assertNotIn(private,output)
        with patch.object(sys,'argv',argv):
            with self.assertRaisesRegex(FileExistsError,'holdout_replay_output_exists_or_input'):
                module.main()
        self.assertEqual(target.read_text(encoding='utf-8'),output)

    def test_average_precision_ties_are_not_resolved_by_label_order(self):
        module=self.module()
        for scores,truth,want in [
            ([0.8,0.8,0.2],[True,False,False],0.5),
            ([0.8,0.8,0.2],[False,True,False],0.5),
            ([0.8,0.8,0.2],[True,True,False],1.0),
        ]:
            with self.subTest(scores=scores,truth=truth):
                self.assertAlmostEqual(module._average_precision(scores,truth),want)
        self.assertIsNone(module._average_precision([0,0],[False,False]))
        self.assertIsNone(module._average_precision([1,1],[True,True]))


    def test_observed_hard_warning_cannot_be_suppressed_by_frozen_predictor(self):
        case=self.fixture
        # Insert a REAL measured-threshold crossing inside the synthetic
        # fold's feature grid; future outcomes remain a separate label.
        case.rows[720]['MM263']=1.2
        case.write_source()
        case.protocol['canonical_source_sha256']=case.source_sha
        case.seal_protocol()
        result=self.replay()
        fold=result['folds'][0]
        self.assertGreaterEqual(fold['baseline']['tp']+fold['baseline']['fp'],1)
        self.assertGreaterEqual(fold['model']['tp']+fold['model']['fp'],
                                fold['baseline']['tp']+fold['baseline']['fp'])
        self.assertIs(fold['hard_observed_warning_suppressed'],False)
        self.assertIs(result['production_admission'],False)



if __name__=='__main__':
    unittest.main()
