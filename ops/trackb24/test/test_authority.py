"""B24 S0 red-first authority and cross-region fault tests."""
import base64
import copy
import hashlib
import json
import os
import sys
import unittest
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from authority import verify_authority, reconcile_regions, AuthorityDenied

SHA = 'b'*64
COMMIT = 'f3accedcd18c3c42c48d645adf8b85119ebc0f42'
ISSUER = Ed25519PrivateKey.generate()
OTHER = Ed25519PrivateKey.generate()
PIN = ISSUER.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
TIMESTAMP = 1791910000

def canonical(x):
    return json.dumps(x,sort_keys=True,separators=(',',':'),ensure_ascii=True).encode('ascii')

def outcome(state='VERIFIED_S0'):
    obj={
       'schema':'axiom.trackb23.s0.native-durable-outcome.v1',
       'Project':{'project_id':'MUSITU_AXIOM','scope':'ISOLATED_SYNTHETIC_S0'},
       'Work':{'work_id':'axiom-b19-native-s0','source_commit':COMMIT,'status':state},
       'Agents':[{'agent_id':'agent-a'}, {'agent_id':'agent-b'}],
       'Artifacts':[{'agent_id':'agent-a'},{'agent_id':'agent-b'}],
       'Evidence':{'external_origin_certified':False,'provider_remaining_certified':False,'production_release_authorized':False,
                   'operation_links':[{'request_id':f'b22-agent-{worker}-{n}','dispatch_state':'COMPLETED'} for worker in ('a','b') for n in range(3)]},
    }
    obj['package_sha256']=hashlib.sha256(canonical(obj)).hexdigest()
    return obj

def policy(bundle, **kw):
    default=dict(schema='axiom.trackb24.s0.signed-checkpoint.v1',audience='axiom.trackb24.s0.audit',
        source_commit=COMMIT,work_id=bundle['Work']['work_id'],package_sha256=bundle['package_sha256'],
        issued_at=TIMESTAMP-5,expires_at=TIMESTAMP+45,sequence=1,nonce='unique-20261013-b24',
        execution_scope='S0_SYNTHETIC_ONLY',provider_dispatch_authorized=False,
        production_authority=False,max_cost_usd='0.00')
    default.update(kw)
    return default

def envelope(d, private=ISSUER):
    raw=canonical(d)
    return {'payload_b64':base64.b64encode(raw).decode(), 'signature_b64':base64.b64encode(private.sign(raw)).decode()}

def regions(**changes):
    def row(workload, i):
        return {'region':'local-a','account_id':'axiom-s0-isolated','utc_day':'2026-10-13',
            'tenant_id':'tenant-s0','workload_id':workload,'request_id':f'b22-{workload}-{i}',
            'body_sha256':hashlib.sha256(f'{workload}-{i}'.encode()).hexdigest(),
            'grant_id':f'grant-{workload}','state':'COMPLETED','result_sha256':hashlib.sha256(f'{workload}-{i}'.encode()).hexdigest()}
    items=[row(w,i) for w in ('agent-a','agent-b') for i in range(3)]
    replica=copy.deepcopy(items)
    for x in replica: x['region']='local-b'
    return [items,replica]

class StrictBoundary(unittest.TestCase):
    def verify(self, e=None, b=None, pin=PIN, now=TIMESTAMP):
        b=b if b is not None else outcome()
        e=e if e is not None else envelope(policy(b))
        return verify_authority(b,e,pinned_public_key=pin,trusted_now=now)
    def deny(self, *,e=None,b=None,pin=PIN,now=TIMESTAMP):
        with self.assertRaises(AuthorityDenied):self.verify(e,b,pin,now)
    def test_valid_synthetic_external_pin_is_still_not_certification(self):
        status=self.verify()
        self.assertEqual(status['status'],'B24_SYNTHETIC_CHECKPOINT_VALID_NOT_PRODUCTION')
        self.assertFalse(status['production_authority'])
    def test_forged_signing_key_denied(self):
        b=outcome();self.deny(e=envelope(policy(b),OTHER),b=b)
    def test_untrusted_envelope_supplied_key_cannot_replace_pin(self):
        b=outcome();e=envelope(policy(b),OTHER);e['public_key_b64']=base64.b64encode(OTHER.public_key().public_bytes(Encoding.Raw,PublicFormat.Raw)).decode();self.deny(e=e,b=b)
    def test_pin_missing_denied(self):self.deny(pin=None)
    def test_wrong_pin_denied(self):self.deny(pin=OTHER.public_key().public_bytes(Encoding.Raw,PublicFormat.Raw))
    def test_signature_tamper_denied(self):
        b=outcome();e=envelope(policy(b));s=bytearray(base64.b64decode(e['signature_b64']));s[0]^=1;e['signature_b64']=base64.b64encode(s).decode();self.deny(e=e,b=b)
    def test_payload_tamper_denied(self):
        b=outcome();e=envelope(policy(b));p=json.loads(base64.b64decode(e['payload_b64']));p['package_sha256']='0'*64;e['payload_b64']=base64.b64encode(canonical(p)).decode();self.deny(e=e,b=b)
    def test_expired_denied(self):self.deny(now=TIMESTAMP+46)
    def test_future_issuer_denied(self):
        b=outcome();self.deny(e=envelope(policy(b,issued_at=TIMESTAMP+6)),b=b)
    def test_more_than_120_second_grant_denied(self):
        b=outcome();self.deny(e=envelope(policy(b,expires_at=TIMESTAMP+300)),b=b)
    def test_authorization_cannot_set_production(self):
        b=outcome();self.deny(e=envelope(policy(b,production_authority=True)),b=b)
    def test_authorization_cannot_allow_provider(self):
        b=outcome();self.deny(e=envelope(policy(b,provider_dispatch_authorized=True)),b=b)
    def test_authorization_cannot_spend_money(self):
        b=outcome();self.deny(e=envelope(policy(b,max_cost_usd='0.01')),b=b)
    def test_schema_and_audience_scope_denied(self):
        b=outcome();self.deny(e=envelope(policy(b,audience='axiom.production.release')),b=b)
    def test_source_commit_swap_denied(self):
        b=outcome();self.deny(e=envelope(policy(b,source_commit='0'*40)),b=b)
    def test_outcome_bytes_tamper_denied(self):
        b=outcome();b['Agents'].append({'agent_id':'bad'});self.deny(b=b)
    def test_attestor_does_not_upgrade_incomplete_outcome(self):
        b=outcome('INCOMPLETE_NOT_PROVEN');self.deny(e=envelope(policy(b)),b=b)
    def test_attestor_rejects_evidence_that_self_certifies(self):
        b=outcome();b['Evidence']['external_origin_certified']=True;b['package_sha256']=hashlib.sha256(canonical({k:v for k,v in b.items() if k!='package_sha256'})).hexdigest();self.deny(e=envelope(policy(b)),b=b)
    def test_extra_schema_field_denied(self):
        b=outcome();self.deny(e=envelope(policy(b,privilege_override=True)),b=b)
    def test_bool_as_sequence_denied(self):
        b=outcome();self.deny(e=envelope(policy(b,sequence=True)),b=b)
    def test_noncanonical_envelope_b64_denied(self):
        b=outcome();e=envelope(policy(b));e['signature_b64']+='\n';self.deny(e=e,b=b)
    def test_signature_wrong_workload_scope_denied(self):
        b=outcome();self.deny(e=envelope(policy(b,work_id='another-work')),b=b)
    def test_unknown_journal_after_restart_denied(self):
        b=outcome();b['Evidence']['operation_links'][0]['dispatch_state']='UNKNOWN';b['package_sha256']=hashlib.sha256(canonical({k:v for k,v in b.items() if k!='package_sha256'})).hexdigest();self.deny(e=envelope(policy(b)),b=b)

class RegionAttacks(unittest.TestCase):
    def deny(self,reps):
        with self.assertRaises(AuthorityDenied):reconcile_regions(reps)
    def test_identical_replica_rows_are_not_six_more_dispatches(self):
        result=reconcile_regions(regions());self.assertEqual(result['unique_operations'],6)
        self.assertEqual(result['authority'],'S0_RECONCILED_NOT_PRODUCTION')
    def test_conflicting_region_result_denied(self):
        r=regions();r[1][0]['result_sha256']='f'*64;self.deny(r)
    def test_conflicting_region_body_denied(self):
        r=regions();r[1][0]['body_sha256']='e'*64;self.deny(r)
    def test_duplicate_within_one_region_denied(self):
        r=regions();r[0][1]=copy.deepcopy(r[0][0]);self.deny(r)
    def test_missing_region_row_denied(self):
        r=regions();r[1].pop();self.deny(r)
    def test_unknown_state_denied(self):
        r=regions();r[0][0]['state']='UNKNOWN';self.deny(r)
    def test_cross_tenant_row_denied(self):
        r=regions();r[1][0]['tenant_id']='tenant-other';self.deny(r)
    def test_day_rollover_mismatch_denied(self):
        r=regions();r[1][0]['utc_day']='2026-10-14';self.deny(r)
    def test_replica_self_report_same_region_denied(self):
        r=regions();r[1][0]['region']='local-a';self.deny(r)
    def test_false_boolean_result_sha_denied(self):
        r=regions();r[0][0]['result_sha256']=True;self.deny(r)
    def test_missing_replica_denied(self):self.deny(regions()[:1])

if __name__=='__main__':unittest.main()

class DurableReplayAttacks(unittest.TestCase):
    def setUp(self):
        import tempfile
        self.holder=tempfile.TemporaryDirectory(prefix='axiom-b24-replay-')
        self.path=Path(self.holder.name)/'authority.sqlite'
        self.bundle=outcome()
        self.signed=envelope(policy(self.bundle))
    def tearDown(self):self.holder.cleanup()
    def check(self,b=None,e=None,now=TIMESTAMP):
        from authority import record_checkpoint
        return record_checkpoint(self.path,b if b is not None else self.bundle,
            e if e is not None else self.signed,pinned_public_key=PIN,trusted_now=now)
    def deny(self, **kw):
        with self.assertRaises(AuthorityDenied):self.check(**kw)
    def test_initial_checkpoint_persisted(self):
        self.assertEqual(self.check()['status'],'B24_S0_CHECKPOINT_RECORDED')
    def test_replay_across_process_like_restart_denied(self):
        self.check(); self.deny()
    def test_increasing_sequence_after_restart_admitted(self):
        self.check()
        e=envelope(policy(self.bundle,sequence=2,nonce='unique-20261013-b24-v2'))
        self.assertEqual(self.check(e=e)['signed_sequence'],2)
    def test_older_sequence_after_new_sequence_denied(self):
        e=envelope(policy(self.bundle,sequence=2,nonce='nonce-two'))
        self.check(e=e);self.deny()
    def test_duplicate_nonce_different_sequence_denied(self):
        self.check(); e=envelope(policy(self.bundle,sequence=2));self.deny(e=e)
    def test_invalid_signature_does_not_advance_sequence(self):
        invalid=envelope(policy(self.bundle,sequence=4,nonce='nonce-forged'),OTHER)
        self.deny(e=invalid)
        self.assertEqual(self.check()['signed_sequence'],1)
    def test_expired_advance_does_not_write(self):
        invalid=envelope(policy(self.bundle,sequence=50,nonce='nonce-expired'))
        self.deny(e=invalid,now=TIMESTAMP+200)
        self.assertEqual(self.check()['signed_sequence'],1)
    def test_signed_window_cannot_cross_midnight(self):
        midnight=1791936000  # 2026-10-14T00:00:00Z
        e=envelope(policy(self.bundle,issued_at=midnight-10,expires_at=midnight+10))
        self.deny(e=e,now=midnight-1)
    def test_uncertified_status_never_commits(self):
        unknown=outcome('INCOMPLETE_NOT_PROVEN')
        self.deny(b=unknown,e=envelope(policy(unknown)))
        self.assertEqual(self.check()['signed_sequence'],1)

# Runs independent OS processes against the same SQLite journal. Separate
# process lifetimes are real; signed policy and key remain synthetic fixture.
def _parallel_checkpoint_entry(args):
    path,bundle,signed,pin,clock=args
    from authority import record_checkpoint,AuthorityDenied
    try:return record_checkpoint(path,bundle,signed,pinned_public_key=pin,trusted_now=clock)['status']
    except AuthorityDenied as error:return 'DENIED:'+str(error)

class RealMultiprocessReplay(unittest.TestCase):
    def test_eight_processes_one_checkpoint(self):
        import tempfile, concurrent.futures
        with tempfile.TemporaryDirectory(prefix='axiom-b24-fanout-') as tmp:
            src=[str(Path(tmp)/'checkpoint.sqlite'),outcome(),None,PIN,TIMESTAMP]
            src[2]=envelope(policy(src[1]))
            with concurrent.futures.ProcessPoolExecutor(max_workers=8) as executor:
                receipts=list(executor.map(_parallel_checkpoint_entry,[tuple(src)]*8))
            self.assertEqual(receipts.count('B24_S0_CHECKPOINT_RECORDED'),1)
            self.assertEqual(sum(x.startswith('DENIED:') for x in receipts),7)
