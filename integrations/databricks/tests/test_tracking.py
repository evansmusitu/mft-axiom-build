import unittest
from tracking import compute_verdict_metrics, run_one_time_mlflow_tracking, mk_experiment_path

SAMPLE=[
    {'case_id':'math-exact-1','should_pass':True},
    {'case_id':'rounding-1','should_pass':True},
    {'case_id':'finance-mismatch-1','should_pass':False},
    {'case_id':'bad-nan','should_pass':False},
]
def verdict(row): return {'passed':row['should_pass'],'code':'PASS' if row['should_pass'] else 'MISMATCH'}

class TrackingTests(unittest.TestCase):
    def test_four_synthetic_cases_and_evidence_hash(self):
        v=compute_verdict_metrics(SAMPLE,verdict)
        self.assertEqual(v['total_cases'],4)
        self.assertEqual(v['correct_classifications'],4)
        self.assertEqual(v['wrong_result_detected'],2)
        self.assertEqual(v['correct_result_accepted'],2)
        self.assertEqual(v['classification_rate'],1.0)
        self.assertEqual(len(v['sha256']),64)

    def test_reject_bad_classification(self):
        with self.assertRaisesRegex(RuntimeError,'classification'):
            compute_verdict_metrics(SAMPLE,lambda row:{'passed':True})

    def test_reject_case_tampering(self):
        with self.assertRaises(ValueError):
            compute_verdict_metrics([{'case_id':'tampered','should_pass':True}],verdict)
        with self.assertRaises(ValueError):
            compute_verdict_metrics(SAMPLE[:2],verdict)

    def test_private_experiment_path(self):
        self.assertEqual(mk_experiment_path('alice@example.com'),
            '/Users/alice@example.com/MUSITU_AXIOM_PRIVATE_PILOT_20261027/MLflow_Numeric_Verification')
        with self.assertRaises(ValueError): mk_experiment_path('../Shared')

    def test_readback_of_single_experiment_and_run(self):
        calls=[]
        def api(method,path,payload=None,params=None):
            calls.append((method,path,payload,params))
            if path.endswith('/Me'): return {'userName':'alice@example.com'}
            if path.endswith('/get-by-name'): return None
            if path.endswith('/experiments/create'): return {'experiment_id':'12'}
            if path.endswith('/runs/create'): return {'run':{'info':{'run_id':'run-abc','experiment_id':'12'}}}
            if path.endswith('/runs/log-batch'): return {}
            if path.endswith('/runs/update'): return {}
            if path.endswith('/runs/get'):
                return {'run':{'info':{'run_id':'run-abc','status':'FINISHED'},
                        'data':{'metrics':calls[4][2]['metrics']}}}
            raise AssertionError(path)
        result=run_one_time_mlflow_tracking(api,SAMPLE,verdict)
        self.assertEqual(result['run_id'],'run-abc')
        self.assertEqual(result['experiment_id'],'12')
        self.assertEqual([p for method,p,_,_ in calls if method=='POST'],[
            '/api/2.0/mlflow/experiments/create', '/api/2.0/mlflow/runs/create',
            '/api/2.0/mlflow/runs/log-batch', '/api/2.0/mlflow/runs/update'])
        self.assertEqual(calls[2][2]['name'],
            '/Users/alice@example.com/MUSITU_AXIOM_PRIVATE_PILOT_20261027/MLflow_Numeric_Verification')
        self.assertEqual(calls[4][2]['metrics'][0]['key'],'classification_rate')

    def test_existing_experiment_prevents_any_writes(self):
        calls=[]
        def api(method,path,payload=None,params=None):
            calls.append(method)
            if path.endswith('/Me'): return {'userName':'alice@example.com'}
            if path.endswith('/get-by-name'): return {'experiment':{'experiment_id':'123'}}
            raise AssertionError(path)
        with self.assertRaisesRegex(RuntimeError,'already exists'):
            run_one_time_mlflow_tracking(api,SAMPLE,verdict)
        self.assertEqual(calls,['GET','GET'])

if __name__=='__main__': unittest.main()
