"""Tests for the no-leakage, no-promotion side-by-side research comparator."""
import copy
import unittest

from benchmarks.mining_adapter.methane_challenger_comparison import compare_development_runs


def metrics(tp, fp, fn, tn):
    recall=tp/(tp+fn) if tp+fn else 0.0
    precision=tp/(tp+fp) if tp+fp else 0.0
    return {'tp':tp,'fp':fp,'fn':fn,'tn':tn,'recall':recall,
            'precision':precision,
            'f2':5*precision*recall/(4*precision+recall) if 4*precision+recall else 0.0}


def source(f2_true_positives=5):
    folds=[]
    for i in range(4):
        common={'fold':i, 'train_examples':1000, 'calibration_examples':200,
                'test_examples':100, 'test_positives':10,
                'train_positives':90, 'calibration_positives':25,
                'test_start':f'2014-05-{i+1:02d}T00:00:00+00:00',
                'test_end':f'2014-05-{i+1:02d}T01:00:00+00:00',
                'temporal_leakage_check':True,
                'online_recalibration_leakage_check':True,
                'baseline':metrics(5,20,5,70)}
        folds.append(common)
    meta={'source_sha256':'28e2eed4c4a314daa4319f656a09bb43d8acea603dcb906e31c98049c91a8fdc',
          'source_rows':9_199_930,'eligible_examples':306_601,
          'dataset_id':'yd7vw4c5mk','dataset_version':1,
          'doi':'10.17632/yd7vw4c5mk.1','license':'CC BY 4.0',
          'transport_source':'openml:42701',
          'feature_count':54,'history_seconds':600,
          'horizon_start_seconds':180,'horizon_end_seconds':360,
          'credentials_used':False,'errors':[]}
    ref=copy.deepcopy(meta);candidate=copy.deepcopy(meta)
    for i,common in enumerate(folds):
        reference=copy.deepcopy(common);reference['model']=metrics(8,42,2,48)
        competitor=copy.deepcopy(common);competitor['model']=metrics(9,21,1,69)
        ref.setdefault('folds',[]).append(reference)
        candidate.setdefault('folds',[]).append(competitor)
    return {'execution':ref},{'execution':candidate,
                             'status':'RESEARCH_ONLY_NOT_ADMITTED',
                             'production_admission':False,
                             'independent_validation':False}


class MethaneChallengerComparisonTests(unittest.TestCase):
    def test_compares_identical_source_folds_and_real_count_metrics(self):
        before,after=source()
        result=compare_development_runs(before,after)
        self.assertEqual(result['status'],'RESEARCH_ONLY_NOT_ADMITTED')
        self.assertFalse(result['independent_validation'])
        self.assertFalse(result['production_admission'])
        self.assertEqual(len(result['folds']),4)
        self.assertEqual(result['folds'][0]['delta_false_positives'],-21)
        self.assertEqual(result['folds'][0]['delta_true_positives'],1)
        self.assertGreater(result['median_delta_f2'],0)
        self.assertEqual(result['source_rows'],9_199_930)
        self.assertEqual(result['support_eligible_folds'],0)

    def test_rejects_changed_time_split_and_label_support(self):
        before,after=source()
        after['execution']['folds'][0]['test_start']='2014-07-01T00:00:00+00:00'
        with self.assertRaisesRegex(ValueError,'fold_mismatch'):
            compare_development_runs(before,after)
        before,after=source()
        after['execution']['folds'][1]['test_positives']+=1
        with self.assertRaisesRegex(ValueError,'fold_mismatch'):
            compare_development_runs(before,after)

    def test_rejects_mismatched_or_forged_source_identity(self):
        before,after=source()
        after['execution']['source_sha256']='a'*64
        with self.assertRaisesRegex(ValueError,'source_mismatch'):
            compare_development_runs(before,after)
        before,after=source()
        before['execution']['source_sha256']='a'*64
        after['execution']['source_sha256']='a'*64
        with self.assertRaisesRegex(ValueError,'unqualified_source'):
            compare_development_runs(before,after)

    def test_rejects_tampered_confusion_counts_or_metrics(self):
        before,after=source()
        after['execution']['folds'][0]['model']['fp']=-1
        with self.assertRaisesRegex(ValueError,'confusion_invalid'):
            compare_development_runs(before,after)
        before,after=source()
        after['execution']['folds'][0]['model']['f2']=0.999
        with self.assertRaisesRegex(ValueError,'metric_mismatch'):
            compare_development_runs(before,after)

    def test_requires_research_only_candidate_and_full_leakage_audit(self):
        before,after=source()
        after['production_admission']=True
        with self.assertRaisesRegex(ValueError,'admission_not_research_only'):
            compare_development_runs(before,after)
        before,after=source()
        after['execution']['folds'][3]['online_recalibration_leakage_check']=False
        with self.assertRaisesRegex(ValueError,'temporal_check_missing'):
            compare_development_runs(before,after)


if __name__=='__main__':
    unittest.main()
