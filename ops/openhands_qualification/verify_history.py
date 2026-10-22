"""Reconcile historical bounded OpenHands GitHub CI runs, not an execution license.

Read-only metadata verification. Does not validate downstream provider billing,
S3 live GitHub mutation, human reviewer custody, or rollback resistance.
"""
import json
from pathlib import Path
import sys

REPO='evansmusitu/mft-axiom-build'
PINS={
    'native_live':(38272446481,'704e36801628524744917015219f5bc9e0d9c412'),
    'native_worker_local':(38425624156,'af798a25346b9e08c4f25cfb90106f251a8ebab3'),
    'durable_workerd':(38443675387,'cef433d9053f7d9365db3dded6b965f642a7cc88'),
}
class QualificationDenied(ValueError):pass

def verify_runs(rows):
    if type(rows) is not dict or set(rows)!={str(v[0]) for v in PINS.values()}:
        raise QualificationDenied('exact historical CI run set required')
    for role,(run_id,sha) in PINS.items():
        obj=rows[str(run_id)]
        if type(obj) is not dict or set(obj)!={'id','repository','head_sha','status','conclusion','event'}:
            raise QualificationDenied('untrusted or unsupported GitHub metadata')
        if obj['id']!=run_id or obj['head_sha']!=sha or obj['repository']!={'full_name':REPO} or obj['status']!='completed' or obj['conclusion']!='success' or obj['event']!='push':
            raise QualificationDenied('historical CI evidence context changed')
    return {
        'schema':'musitu.axiom.openhands.historical-ci-qualification.s0.v1',
        'verified_historical_runs':{role:run for role,(run,_) in PINS.items()},
        'bounded_sdk_execution':'HISTORICAL_RUNS_SUCCESS',
        'end_to_end_s3_git_mutation':'NOT_PROVEN',
        'persistent_multi_host_agent':'NOT_PROVEN',
        'external_independent_verification':'NOT_CERTIFIED',
        'global_rollback_resistance':'FAILED_IN_SYNTHETIC_ATTACK',
        'account_wide_zero_cost':'NOT_VERIFIED',
        'production_authority':False,
        'provider_dispatch_allowed':False,
    }

if __name__=='__main__':
    if len(sys.argv)!=2:raise SystemExit('usage: verify_history.py <GitHub-run-json>')
    d=json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
    print(json.dumps(verify_runs(d),sort_keys=True,separators=(',',':')))
