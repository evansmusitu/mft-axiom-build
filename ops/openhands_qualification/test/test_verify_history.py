import json
import unittest
from ops.openhands_qualification.verify_history import verify_runs,QualificationDenied

PINS={'native_live':(38272446481,'704e36801628524744917015219f5bc9e0d9c412'),
      'native_worker_local':(38425624156,'af798a25346b9e08c4f25cfb90106f251a8ebab3'),
      'durable_workerd':(38443675387,'cef433d9053f7d9365db3dded6b965f642a7cc88')}

def fake():return {str(id):{'id':id,'repository':{'full_name':'evansmusitu/mft-axiom-build'},'head_sha':sha,'status':'completed','conclusion':'success','event':'push'} for id,sha in PINS.values()}

class HistoricalCIProofTests(unittest.TestCase):
    def test_pinned_live_runs_are_context_bound_and_release_blocked(self):
        r=verify_runs(fake())
        self.assertEqual(r['bounded_sdk_execution'],'HISTORICAL_RUNS_SUCCESS')
        self.assertFalse(r['production_authority'])
        self.assertEqual(r['external_independent_verification'],'NOT_CERTIFIED')
        self.assertEqual(r['end_to_end_s3_git_mutation'],'NOT_PROVEN')
        self.assertEqual(r['global_rollback_resistance'],'FAILED_IN_SYNTHETIC_ATTACK')
    def test_wrong_repo_head_state_and_event_rejected(self):
        for k,value in [('head_sha','f'*40),('conclusion','failure'),('event','workflow_dispatch'),('repository',{'full_name':'evil/fork'}),('status','in_progress')]:
            with self.subTest(field=k):
                rows=fake();rows[str(PINS['native_live'][0])][k]=value
                with self.assertRaises(QualificationDenied):verify_runs(rows)
    def test_non_exact_run_set_denied(self):
        rows=fake();rows.pop(str(PINS['native_live'][0]));
        with self.assertRaises(QualificationDenied):verify_runs(rows)
        rows=fake();rows['123']={}
        with self.assertRaises(QualificationDenied):verify_runs(rows)
    def test_self_promotion_provider_dispatch_prohibited(self):
        rows=fake();rows[str(PINS['native_live'][0])]['production_authority']=True
        with self.assertRaises(QualificationDenied):verify_runs(rows)
if __name__=='__main__':unittest.main()
