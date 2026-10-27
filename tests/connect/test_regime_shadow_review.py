"""Independent review of archived, previously spent regime-shadow evidence."""
import copy
import json
import os
import unittest
from pathlib import Path

from benchmarks.mining_adapter.regime_shadow_review import review_regime_shadow


def counts(tp=9, fp=10, fn=1, tn=80):
    precision = tp / (tp + fp) if tp + fp else 0
    recall = tp / (tp + fn) if tp + fn else 0
    return {
        'tp': tp, 'tn': tn, 'fp': fp, 'fn': fn,
        'precision': precision, 'recall': recall,
        'specificity': tn / (tn + fp) if tn + fp else 0,
        'f1': 2*precision*recall/(precision+recall) if precision+recall else 0,
        'f2': 5*precision*recall/(4*precision+recall) if 4*precision+recall else 0,
    }


def sample_report():
    folds=[]
    for i in range(4):
        m=counts()
        sh=counts(tp=8, fp=14, fn=2, tn=76)
        folds.append({
            'fold':i,'test_examples':100,'test_positives':10,
            'temporal_leakage_check':True,'online_recalibration_leakage_check':True,
            'model':m,'baseline':counts(0,0,10,90),
            'research_only_regime_shadow':{
                'evaluation_role':'RESEARCH_ONLY_REGIME_CALIBRATION',
                'qualified_for_admission':False,'independent_validation':False,
                'leakage_safe':True, 'metrics':sh,'fallback_predictions':15,
                'threshold_updates':1, 'regime_example_counts':{'low':60,'elevated':40},
                'hard_warnings':2,
                'policy':{'hard_observed_warning':'never_suppressed'},
                'update_audit':[{'prediction_time':'2020-01-01T00:10:00+00:00',
                                 'latest_label_window_end_used':'2020-01-01T00:09:59+00:00'}],
            }
        })
    return {
        'schema':'musitu.axiom.predictive.lightgbm_challenger.v1',
        'status':'RESEARCH_ONLY_NOT_ADMITTED','production_admission':False,
        'independent_validation':False,
        'source_sha256':'28e2eed4c4a314daa4319f656a09bb43d8acea603dcb906e31c98049c91a8fdc',
        'existing_gate_diagnostic_only':{
            'gate':'REAL_MINE_METHANE_BACKTEST_FAILED','backtest_qualified':False,
            'maximum_support_eligible_folds':0},
        'execution':{
            'dataset_id':'yd7vw4c5mk','dataset_version':1,'doi':'10.17632/yd7vw4c5mk.1',
            'license':'CC BY 4.0','transport_source':'openml:42701',
            'source_sha256':'28e2eed4c4a314daa4319f656a09bb43d8acea603dcb906e31c98049c91a8fdc',
            'source_rows':9_199_930,'eligible_examples':306_601,'credentials_used':False,
            'errors':[], 'history_seconds':600,'horizon_start_seconds':180,
            'horizon_end_seconds':360,'folds':folds,
        },
    }


class RegimeShadowReviewTests(unittest.TestCase):
    def test_archive_review_fails_closed_and_rejects_degrading_shadow(self):
        report=review_regime_shadow(sample_report())
        self.assertEqual(report['selection_decision'],'DO_NOT_PROMOTE')
        self.assertFalse(report['independent_validation'])
        self.assertFalse(report['production_admission'])
        self.assertEqual(report['model_false_positives'],40)
        self.assertEqual(report['shadow_false_positives'],56)
        self.assertEqual(report['false_positive_delta'],16)
        self.assertEqual(report['support_eligible_folds'],0)
        self.assertEqual(report['folds'][0]['delta_true_positives'],-1)
        self.assertLess(report['median_f2_delta'],0)

    def test_forged_model_or_shadow_summary_is_rejected(self):
        for field in ('model','research_only_regime_shadow'):
            with self.subTest(field=field):
                report=sample_report()
                metrics=report['execution']['folds'][0][field]
                if field!='model':metrics=metrics['metrics']
                metrics['f2']=.999
                with self.assertRaisesRegex(ValueError,'metric_mismatch'):
                    review_regime_shadow(report)

    def test_label_and_example_counts_cannot_be_forged(self):
        report=sample_report()
        report['execution']['folds'][1]['test_positives']=99
        with self.assertRaisesRegex(ValueError,'confusion_mismatch'):
            review_regime_shadow(report)

    def test_rejects_unresolved_label_in_shadow_update_audit(self):
        report=sample_report()
        report['execution']['folds'][0]['research_only_regime_shadow']['update_audit'][0]['latest_label_window_end_used']='2020-01-01T00:10:00+00:00'
        with self.assertRaisesRegex(ValueError,'future_label'):
            review_regime_shadow(report)

    def test_rejects_false_hard_warning_attestation_and_bogus_fallback(self):
        report=sample_report()
        report['execution']['folds'][0]['research_only_regime_shadow']['policy']['hard_observed_warning']='optional'
        with self.assertRaisesRegex(ValueError,'hard_warning'):
            review_regime_shadow(report)
        report=sample_report()
        report['execution']['folds'][2]['research_only_regime_shadow']['fallback_predictions']=1000
        with self.assertRaisesRegex(ValueError,'support_metadata'):
            review_regime_shadow(report)

    def test_rejects_wrong_sha_identity_or_production_claim(self):
        report=sample_report()
        report['source_sha256']='0'*64
        with self.assertRaisesRegex(ValueError,'source_identity'):
            review_regime_shadow(report)
        report=sample_report()
        report['production_admission']=True
        with self.assertRaisesRegex(ValueError,'research_only'):
            review_regime_shadow(report)

    def test_actual_gitHub_archive_evidence_when_provided(self):
        location=os.environ.get('AXIOM_REGIME_EVIDENCE_PATH')
        if not location:self.skipTest('pinned archived evidence path not provided')
        p=Path(location)
        if not p.is_file():self.fail('explicitly configured archived evidence is missing')
        report=review_regime_shadow(json.loads(p.read_text()))
        self.assertLess(report['shadow_median_f2'],report['model_median_f2'])
        self.assertEqual(report['support_eligible_folds'],2)
        self.assertEqual(report['false_positive_delta'],480)
        self.assertEqual(report['selection_decision'],'DO_NOT_PROMOTE')


if __name__=='__main__':
    unittest.main()
