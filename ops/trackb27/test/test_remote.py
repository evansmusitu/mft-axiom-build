"""B27 live loopback socket, independent local process, synthetic keys only.

Explicit negative scenario verifies LOCAL journal rollback remains exploitable.
"""
import base64
from concurrent.futures import ThreadPoolExecutor, ProcessPoolExecutor
import http.client
import multiprocessing
from pathlib import Path
import secrets
import sys
import tempfile
import unittest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding,PublicFormat
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'trackb25'))
sys.path.insert(0,str(ROOT/'trackb26'))
sys.path.insert(0,str(ROOT/'trackb27'))
from quorum import cast_vote,canonical
from witness_gate import admit_audit_checkpoint,WitnessDenied
from remote_witness import LoopbackWitnessClient
from witness_server import run_synthetic_loopback_child
CLOCK=1791910000
PROPOSAL={'schema':'axiom.trackb25.s0.checkpoint-proposal.v1',
    'work_id':'axiom-b27-case','sequence':1,'digest_sha256':'a'*64,
    'nonce':'nonce-b27-1','utc_day':'2026-10-13',
    'scope':'S0_LOCAL_AUDIT_ONLY','provider_dispatch_allowed':False,'production_authority':False}
def pub(k):return k.public_key().public_bytes(Encoding.Raw,PublicFormat.Raw)

def separate_client_attempt(params):
    port,token,key,proposal,votes,pins=params
    try:
        witness=LoopbackWitnessClient(port=port,token=token)
        outcome=admit_audit_checkpoint(proposal=proposal,votes=votes,pinned_voters=pins,
            witness=witness,pinned_witness_key=key,trusted_now=CLOCK)
        return outcome['status']=='B26_S0_WITNESSED_AUDIT_NO_DISPATCH'
    except WitnessDenied:
        return False
class RemoteGateTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='b27-local-');self.addCleanup(self.tmp.cleanup)
        self.folder=Path(self.tmp.name)
        self.keys={x:Ed25519PrivateKey.generate() for x in ('voter-a','voter-b','voter-c')}
        self.pins={k:pub(v) for k,v in self.keys.items()}
        self.proposal=dict(PROPOSAL)
        self.votes=[cast_vote(self.folder/f'{name}.sqlite',name,self.keys[name],self.proposal,trusted_now=CLOCK)
                    for name in ('voter-a','voter-b')]
    def start_service(self,db_path=None,*,token=None,clock=CLOCK,reply_loss=False):
        ctx=multiprocessing.get_context('spawn')
        parent,child=ctx.Pipe(duplex=False)
        token=token or secrets.token_urlsafe(32)
        db_path=db_path or str(self.folder/'external-process.sqlite')
        process=ctx.Process(target=run_synthetic_loopback_child,
            args=(child,str(db_path),self.pins,token,clock,reply_loss),daemon=True)
        process.start();child.close()
        self.addCleanup(lambda: (process.terminate(),process.join(5)) if process.is_alive() else None)
        self.assertTrue(parent.poll(10),'synthetic service did not bind')
        info=parent.recv()
        self.assertEqual(info['pid'],process.pid)
        return LoopbackWitnessClient(port=info['port'],token=token),base64.b64decode(info['pub']),info['port'],token,process
    def admit(self,client,key,*,votes=None):
        return admit_audit_checkpoint(proposal=self.proposal,votes=self.votes if votes is None else votes,
            pinned_voters=self.pins,witness=client,pinned_witness_key=key,trusted_now=CLOCK)
    def test_no_service_no_local_quorum_fallback(self):
        client=LoopbackWitnessClient(port=55432,token='synthetic-only-credential')
        with self.assertRaises(WitnessDenied) as cm:self.admit(client,b'\x42'*32)
        self.assertIn('EXTERNAL_WITNESS_UNAVAILABLE_OR_REPLAY',str(cm.exception))
    def test_live_network_separate_process_audit_only(self):
        client,pin,*_=self.start_service()
        result=self.admit(client,pin)
        self.assertEqual(result['status'],'B26_S0_WITNESSED_AUDIT_NO_DISPATCH')
        self.assertIs(result['provider_dispatch_allowed'],False)
        self.assertIs(result['production_authority'],False)
    def test_persisted_replay_denied_across_service_process_restart(self):
        db=str(self.folder/'external-process.sqlite')
        first,key,port,token,process=self.start_service(db)
        self.admit(first,key)
        process.terminate();process.join(5)
        second,key2,*_=self.start_service(db)
        with self.assertRaises(WitnessDenied):self.admit(second,key2)
    def test_wrong_pinned_witness_signer_denied(self):
        client,real,*_=self.start_service()
        with self.assertRaises(WitnessDenied):self.admit(client,b'\x01'*32)
        with self.assertRaises(WitnessDenied):self.admit(client,real)
    def test_wrong_bearer_denied_before_any_durable_admission(self):
        client,pin,port,token,_=self.start_service()
        invalid=LoopbackWitnessClient(port=port,token='x'*40)
        with self.assertRaises(WitnessDenied):self.admit(invalid,pin)
        self.admit(client,pin)
    def test_disabled_public_read_route(self):
        _,_,port,_,_=self.start_service()
        conn=http.client.HTTPConnection('127.0.0.1',port,timeout=3)
        try:
            conn.request('GET','/')
            res=conn.getresponse();self.assertEqual(res.status,404)
            self.assertNotIn('private',res.read().decode().lower())
        finally:conn.close()
    def test_request_extra_clock_field_denied(self):
        _,_,port,token,_=self.start_service()
        data=canonical({'proposal':self.proposal,'votes':self.votes,'proposal_sha256':'a'*64,
            'votes_sha256':'b'*64,'trusted_now':CLOCK})
        conn=http.client.HTTPConnection('127.0.0.1',port,timeout=3)
        try:
            conn.request('POST','/v1/audit/checkpoint',body=data,
                headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
            res=conn.getresponse();self.assertEqual(res.status,403);res.read()
        finally:conn.close()
    def test_denies_wrong_path_even_with_correct_token(self):
        _,_,port,token,_=self.start_service()
        conn=http.client.HTTPConnection('127.0.0.1',port,timeout=3)
        try:
            conn.request('POST','/production/dispatch',body=b'{}',headers={
                'Authorization':'Bearer '+token,'Content-Type':'application/json'})
            response=conn.getresponse();self.assertEqual(response.status,403);response.read()
        finally:conn.close()

    def test_denies_duplicate_keys_on_protocol_boundary(self):
        _,_,port,token,_=self.start_service()
        payload=b'{"proposal":{},"proposal":{},"votes":[],"proposal_sha256":"0","votes_sha256":"0"}'
        conn=http.client.HTTPConnection('127.0.0.1',port,timeout=3)
        try:
            conn.request('POST','/v1/audit/checkpoint',body=payload,headers={
                'Authorization':'Bearer '+token,'Content-Type':'application/json'})
            response=conn.getresponse();self.assertEqual(response.status,403);response.read()
        finally:conn.close()

    def test_loopback_client_rejects_noncanonical_config(self):
        for value in (0,65536,True,'1234'):
            with self.assertRaises(WitnessDenied):LoopbackWitnessClient(port=value,token='x'*40)
        with self.assertRaises(WitnessDenied):LoopbackWitnessClient(port=1000,token='weak')

    def test_eight_simultaneous_clients_one_local_admission(self):
        client,pin,*_=self.start_service()
        def attempt(_):
            try:self.admit(client,pin);return True
            except WitnessDenied:return False
        with ThreadPoolExecutor(max_workers=8) as pool: outcomes=list(pool.map(attempt,range(8)))
        self.assertEqual(sum(outcomes),1)
    def test_eight_separate_broker_processes_only_one_admitted(self):
        _client,pin,port,token,_=self.start_service()
        arg=(port,token,pin,self.proposal,self.votes,self.pins)
        ctx=multiprocessing.get_context('spawn')
        with ProcessPoolExecutor(max_workers=8,mp_context=ctx) as pool:
            outcomes=list(pool.map(separate_client_attempt,[arg]*8))
        self.assertEqual(sum(outcomes),1)

    def test_lost_ack_after_durable_commit_fails_closed_and_retry_denied(self):
        client,key,*_=self.start_service(reply_loss=True)
        with self.assertRaises(WitnessDenied):self.admit(client,key)
        with self.assertRaises(WitnessDenied):self.admit(client,key)
    def test_service_clock_cannot_be_controlled_by_client(self):
        client,pin,*_=self.start_service(clock=CLOCK+86400)
        with self.assertRaises(WitnessDenied):self.admit(client,pin)
    def test_majority_and_witness_storage_deletion_still_reenables_attack(self):
        # Permanent counterexample: successful test denotes an UNFIXED failure.
        db=str(self.folder/'external-process.sqlite')
        client,pin,_,_,process=self.start_service(db)
        self.admit(client,pin)
        process.terminate();process.join(5)
        Path(db).unlink()
        for name in ('voter-a','voter-b'):
            (self.folder/f'{name}.sqlite').unlink()
        votes=[cast_vote(self.folder/f'{name}.sqlite',name,self.keys[name],self.proposal,trusted_now=CLOCK)
               for name in ('voter-a','voter-b')]
        other,key2,*_=self.start_service(db)
        replay=self.admit(other,key2,votes=votes)
        self.assertEqual(replay['status'],'B26_S0_WITNESSED_AUDIT_NO_DISPATCH')
        print('B27_EXTERNAL_INDEPENDENCE_NOT_PROVEN_ROLLBACK_ATTACK_REPRODUCED')
if __name__=='__main__':unittest.main()
