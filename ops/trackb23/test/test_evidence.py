"""Independent negative tests at B19/B20 -> B22 durable S0 evidence seam.
The test source is synthetic; live SDK/Workerd evidence must be collected by CI.
"""
import base64
import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'trackb19'))
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from journal import EventJournal
from portable import make_portable
from evidence import join,verify_package_against_sources,JoinDenied

SOURCE_COMMIT='e4760d2042fa511bde576d5ffc8505e4ce4172eb'
SOURCES={'agent-a':'12141ca5171ea43624b961e04b6ef0e709db4d1b90d1c967bea2706afe4aad27',
'agent-b':'92712716ad57b7dbdd97566faf64dda7597f5a18baa297d3168bf6fc9cd9b199'}

def valid():
    with tempfile.TemporaryDirectory() as tmp:
        j=EventJournal(Path(tmp)/'native.sqlite')
        for idx in range(3):
            for who in ('agent-a','agent-b'):
                tool='finish' if idx==2 else 'file_editor'
                action={'kind':'ActionEvent','id':f'{who}-act-{idx}','tool_call_id':f'call-{who}-{idx}','tool_name':tool,'action_id':None}
                obs={'kind':'ObservationEvent','id':f'{who}-obs-{idx}','tool_call_id':f'call-{who}-{idx}','tool_name':tool,'action_id':f'{who}-act-{idx}'}
                j.append('axiom-b19-native-s0',who,idx*2,action)
                j.append('axiom-b19-native-s0',who,idx*2+1,obs)
        p=j.verify('axiom-b19-native-s0')
        rows=j.db.execute('SELECT worker,ordinal,event_data FROM events ORDER BY seq').fetchall()
        events=[{'worker':w,'ordinal':ordn,'event':json.loads(raw)} for w,ordn,raw in rows]
        portable=make_portable(p,events,SOURCES,Ed25519PrivateKey.generate(),SOURCE_COMMIT)
        j.close()
    encoded=base64.b64encode(json.dumps(portable,sort_keys=True,separators=(',',':')).encode()).decode()
    admissions=[];journals=[];quotas=[]
    for who in ('agent-a','agent-b'):
        for idx in range(3):
            req=f'b22-{who}-{idx}'
            bodysha=hashlib.sha256(req.encode()).hexdigest()
            admissions.append(f'B22_WORKERD_ADMITTED={who}:{idx}:{bodysha}')
            grant=f'b22-local-{who}'
            journals.append({'request_id':req,'account_id':'axiom-s0-isolated','utc_day':'2026-10-13',
                'tenant_id':'tenant-b22-synthetic','workload_id':who,'body_sha':bodysha,'quota_grant_id':grant,
                'state':'COMPLETED','result_sha':bodysha})
            quotas.append({'grant_id':grant,'request_id':req,'tenant_id':'tenant-b22-synthetic',
                'workload_id':who,'request_sha':bodysha,'neurons':100})
    transcript='\n'.join(admissions+['MUSITU_AXIOM_B12_TWO_NATIVE_SDK_AGENT_PROCESSES_SYNTHETIC_MODEL_PASS'])
    return [encoded,SOURCE_COMMIT,transcript,journals,quotas]

class B23CausalJoinS0(unittest.TestCase):
    def setUp(self):self.args=valid()
    def deny(self,code=None):
        with self.assertRaises(JoinDenied) as x:join(*self.args)
        if code:self.assertEqual(str(x.exception),code)
    def test_success_exact_native_tool_journal_quota(self):
        out=join(*self.args)
        self.assertEqual(out['Work']['status'],'VERIFIED_S0')
        self.assertEqual(len(out['Evidence']['operation_links']),6)
        self.assertFalse(out['Evidence']['external_origin_certified'])
        self.assertFalse(out['Evidence']['production_release_authorized'])
        verified=verify_package_against_sources(out,*self.args)
        self.assertEqual(verified['operations'],6)
    def test_repeated_verification_stable(self):
        a=join(*self.args);b=join(*self.args)
        self.assertEqual(a['package_sha256'],b['package_sha256'])
    def test_tampered_native_signature_fails(self):
        env=json.loads(base64.b64decode(self.args[0]));env['signature_b64']='AAAA'+env['signature_b64'][4:]
        self.args[0]=base64.b64encode(json.dumps(env).encode()).decode()
        self.deny('B19_B20_NATIVE_SIGNATURE_OR_CAUSAL_DENIED')
    def test_wrong_source_commit_fails(self):
        self.args[1]='f'*40;self.deny('B19_B20_NATIVE_SIGNATURE_OR_CAUSAL_DENIED')
    def test_missing_gateway_receipt_fails(self):
        self.args[2]=self.args[2].replace(self.args[2].splitlines()[0]+'\n','');self.deny('GATEWAY_SDK_ADMISSIONS_INCOMPLETE_OR_DUPLICATE')
    def test_duplicate_gateway_receipt_fails(self):
        self.args[2]+='\n'+self.args[2].splitlines()[0];self.deny('GATEWAY_SDK_ADMISSIONS_INCOMPLETE_OR_DUPLICATE')
    def test_cross_agent_gateway_substitution_fails(self):
        self.args[2]=self.args[2].replace('B22_WORKERD_ADMITTED=agent-a:0:', 'B22_WORKERD_ADMITTED=agent-b:0:');self.deny('GATEWAY_SDK_ADMISSIONS_INCOMPLETE_OR_DUPLICATE')
    def test_tampered_gateway_hash_fails(self):
        self.args[2]=self.args[2].replace(self.args[3][0]['body_sha'],'f'*64)
        self.deny('PROVIDER_PAYLOAD_CROSS_LAYER_HASH_MISMATCH')
    def test_missing_journal_row_fails(self):
        self.args[3].pop();self.deny('JOURNAL_SNAPSHOT_INCOMPLETE')
    def test_duplicate_journal_row_fails(self):
        self.args[3][-1]=copy.deepcopy(self.args[3][0]);self.deny('JOURNAL_OPERATION_DUPLICATE_OR_UNKNOWN')
    def test_swapped_journal_workload_fails(self):
        self.args[3][0]['workload_id']='agent-b';self.deny('JOURNAL_SCOPE_DENIED')
    def test_journal_wrong_payload_fails(self):
        self.args[3][0]['body_sha']='a'*64;self.deny('PROVIDER_PAYLOAD_CROSS_LAYER_HASH_MISMATCH')
    def test_wrong_journal_grant_fails(self):
        self.args[3][0]['quota_grant_id']='different';self.deny('QUOTA_JOURNAL_IDENTITY_MISMATCH')
    def test_cross_tenant_journal_denied(self):
        self.args[3][0]['tenant_id']='other';self.deny('JOURNAL_ACCOUNT_TENANT_DAY_SPLIT')
    def test_missing_quota_record_fails(self):
        self.args[4].pop();self.deny('QUOTA_SNAPSHOT_INCOMPLETE')
    def test_quota_forged_identity_fails(self):
        self.args[4][0]['workload_id']='agent-b';self.deny('QUOTA_SCOPE_DENIED')
    def test_quota_over_credit_fails(self):
        self.args[4][0]['neurons']=120;self.deny('QUOTA_NEURON_SCOPE_DENIED')
    def test_unknown_result_is_unproven_not_success(self):
        self.args[3][0]['state']='UNKNOWN';self.args[3][0]['result_sha']=None
        out=join(*self.args);self.assertEqual(out['Work']['status'],'INCOMPLETE_NOT_PROVEN')
    def test_issued_result_is_unproven_not_success(self):
        self.args[3][0]['state']='ISSUED';self.args[3][0]['result_sha']=None
        out=join(*self.args);self.assertEqual(out['Work']['status'],'INCOMPLETE_NOT_PROVEN')
    def test_unknown_with_result_hash_is_invalid(self):
        self.args[3][0]['state']='UNKNOWN';self.deny('JOURNAL_RESULT_STATE_INCONSISTENT')
    def test_missing_completed_digest_denied(self):
        self.args[3][0]['result_sha']=None;self.deny('JOURNAL_RESULT_STATE_INCONSISTENT')
    def test_completed_mismatched_result_denied(self):
        self.args[3][0]['result_sha']='b'*64;self.deny('SYNTHETIC_RESULT_BYTES_INCONSISTENT')
    def test_external_claim_mutation_denied(self):
        out=join(*self.args);out['Evidence']['external_origin_certified']=True
        with self.assertRaises(JoinDenied):verify_package_against_sources(out,*self.args)
    def test_work_status_mutation_denied(self):
        out=join(*self.args);out['Work']['status']='PRODUCTION';
        with self.assertRaises(JoinDenied):verify_package_against_sources(out,*self.args)
    def test_forged_package_hash_denied(self):
        out=join(*self.args);out['package_sha256']='0'*64
        with self.assertRaises(JoinDenied):verify_package_against_sources(out,*self.args)
    def test_nonschema_sql_fields_denied(self):
        self.args[4][0]['extra']='unexpected';self.deny('QUOTA_ROW_SCHEMA_DENIED')
    def test_injection_in_transcript_denied(self):
        self.args[2]+='\nB22_DENIED_BEFORE_NATIVE_MODEL_REPLY=agent-a:2'
        self.deny('SDK_PROVIDER_GATE_DENIED')
if __name__=='__main__':unittest.main()
