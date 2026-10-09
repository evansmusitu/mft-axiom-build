import copy
import unittest
from benchmarks.mining_adapter.external_validation_gate import assess_external_evidence


def metric(tp,fp,fn,tn):
    p=tp/(tp+fp) if tp+fp else 0
    r=tp/(tp+fn) if tp+fn else 0
    return {'tp':tp,'fp':fp,'fn':fn,'tn':tn,'precision':p,'recall':r,
            'specificity':tn/(tn+fp) if tn+fp else 0,
            'f1':2*p*r/(p+r) if p+r else 0,
            'f2':5*p*r/(4*p+r) if 4*p+r else 0}


def report():
    m=metric(460, 1900, 40, 7600)
    m.update({'average_precision':.37,'prevalence':.05,
              'f2_delta_vs_hard_warning':m['f2']-metric(200, 1100, 300, 8400)['f2']})
    return {'schema':'musitu.axiom.frozen_external_mine_evaluation.v1',
            'status':'RESEARCH_ONLY_NOT_ADMITTED','source_sha256':'a'*64,
            'model_manifest_sha256':'b'*64,'model_sha256':'c'*64,'source_manifest_sha256':'d'*64,
            'source_rows':100_000,'eligible_examples':10_000,'test_positives':500,
            'observed_hard_warnings':1300,'hard_warning_preserved':True,
            'model':m,'baseline':metric(200,1100,300,8400),'feature_count':52,
            'model_retrained':False,'threshold_recalibrated':False,
            'preflight':{'source_integrity':'HASH_AND_SCHEMA_VERIFIED',
                        'provenance_status':'DECLARATIONS_ONLY_NOT_INDEPENDENTLY_VERIFIED',
                        'positive_label_examples':500},
            'production_admission':False,'independent_validation':False,
            'admission_gate':'NOT_EVALUATED'}


class ExternalValidationGateTests(unittest.TestCase):
    def test_high_measured_scores_never_grant_independent_status(self):
        result=assess_external_evidence(report())
        self.assertTrue(result['research_performance_meets_predeclared_thresholds'])
        self.assertFalse(result['independent_validation'])
        self.assertFalse(result['production_admission'])
        self.assertEqual(result['status'], 'PENDING_EXTERNAL_PROVENANCE_AND_INDEPENDENT_REVIEW')
        self.assertEqual(result['source_support'], 'SUFFICIENT_FOR_SINGLE_DESCRIPTIVE_COHORT')
        self.assertEqual(result['admission_gate'], 'NOT_AUTHORIZED')
        self.assertFalse(result['original_four_fold_gate_satisfied'])

    def test_tampered_confusion_matrix_and_summary_are_rejected(self):
        for mutation in ('fp','recall','f2'):
            r=report()
            r['model'][mutation] += 1
            with self.subTest(mutation=mutation):
                with self.assertRaisesRegex(ValueError,'confusion_or_metric_mismatch'):
                    assess_external_evidence(r)

    def test_negative_f2_or_insufficient_support_stays_unqualified(self):
        r=report();r['test_positives']=300
        r['preflight']['positive_label_examples']=300
        r['model']=metric(280,1900,20,7800)
        r['baseline']=metric(200,1100,100,8600)
        r['model'].update({'average_precision':.37,'prevalence':.03,
                           'f2_delta_vs_hard_warning':r['model']['f2']-r['baseline']['f2']})
        # Physical baseline/model confusion totals must still match 10k
        r['model']['tn']=7800
        self.assertEqual(sum(r['model'][k] for k in ('tp','fp','fn','tn')),10000)
        result=assess_external_evidence(r)
        self.assertFalse(result['research_performance_meets_predeclared_thresholds'])
        self.assertEqual(result['source_support'],'INSUFFICIENT')
        self.assertFalse(result['independent_validation'])

    def test_will_not_accept_recalibration_or_a_claimed_independent_result(self):
        for attr,value in [('threshold_recalibrated',True),('model_retrained',True),
                           ('production_admission',True),('independent_validation',True)]:
            r=report();r[attr]=value
            with self.subTest(attr=attr):
                with self.assertRaisesRegex(ValueError,'untrusted_evaluation_contract'):
                    assess_external_evidence(r)

    def test_hard_warnings_unverifiable_or_bad_preflight_fail(self):
        for attr,value in [('hard_warning_preserved',False),('observed_hard_warnings',2000)]:
            r=report();r[attr]=value
            with self.subTest(attr=attr):
                with self.assertRaisesRegex(ValueError,'hard_warning'):assess_external_evidence(r)
        r=report();r['preflight']['source_integrity']='DEVELOPMENT_ONLY'
        with self.assertRaisesRegex(ValueError,'preflight'):assess_external_evidence(r)


if __name__=='__main__':unittest.main()
