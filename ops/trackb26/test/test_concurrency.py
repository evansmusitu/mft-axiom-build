"""S0 process-isolation test: still a single local SQLite failure domain."""
import hashlib
import multiprocessing
from pathlib import Path
import tempfile
import sys
import unittest

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding,PublicFormat
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
sys.path.insert(0,str(ROOT.parents[0]/'trackb25'))
from quorum import cast_vote
from witness_gate import admit_audit_checkpoint, WitnessDenied
from synthetic_witness import SyntheticWitness

CLOCK=1791910000
PROPOSAL={'schema':'axiom.trackb25.s0.checkpoint-proposal.v1', 'work_id':'concurrency-1',
 'sequence':1,'digest_sha256':'a'*64,'nonce':'race-1','utc_day':'2026-10-13',
 'scope':'S0_LOCAL_AUDIT_ONLY','provider_dispatch_allowed':False,'production_authority':False}

def process_attempt(db,key_bytes,proposal,votes,pins,pubkey,gate,queue):
    try:
        gate.wait(7)
        signer=Ed25519PrivateKey.from_private_bytes(key_bytes)
        result=admit_audit_checkpoint(proposal=proposal,votes=votes,pinned_voters=pins,
            witness=SyntheticWitness(db,signer,pins),pinned_witness_key=pubkey,trusted_now=CLOCK)
        queue.put((True,result['status']))
    except BaseException as exc:
        queue.put((False,type(exc).__name__+':'+str(exc)))

class ConcurrentSyntheticWitness(unittest.TestCase):
    def test_eight_independent_processes_accept_exactly_one(self):
        with tempfile.TemporaryDirectory(prefix='b26-multiprocess-') as td:
            base=Path(td)
            witnesskey=Ed25519PrivateKey.generate()
            wk=witnesskey.private_bytes_raw()
            pub=witnesskey.public_key().public_bytes(Encoding.Raw,PublicFormat.Raw)
            keys={n:Ed25519PrivateKey.generate() for n in ('voter-a','voter-b','voter-c')}
            pins={n:k.public_key().public_bytes(Encoding.Raw,PublicFormat.Raw) for n,k in keys.items()}
            votes=[cast_vote(base/f'{n}.sqlite',n,keys[n],PROPOSAL,trusted_now=CLOCK) for n in ('voter-a','voter-b')]
            ctx=multiprocessing.get_context('spawn')
            gate=ctx.Event();queue=ctx.Queue()
            children=[ctx.Process(target=process_attempt,args=(str(base/'witness.sqlite'),wk,PROPOSAL,votes,pins,pub,gate,queue)) for _ in range(8)]
            for p in children:p.start()
            gate.set()
            for p in children:
                p.join(12)
                self.assertFalse(p.is_alive(),'unbounded witness process')
                self.assertEqual(p.exitcode,0)
            outcomes=[queue.get(timeout=2) for _ in children]
            self.assertEqual(sum(int(o[0]) for o in outcomes),1,outcomes)
            self.assertTrue(all(o[0] or o[1].startswith('WitnessDenied:') for o in outcomes),outcomes)

if __name__=='__main__':unittest.main()
