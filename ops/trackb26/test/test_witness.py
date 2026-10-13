import base64
import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
sys.path.insert(0,str(ROOT.parents[0]/'trackb25'))
from quorum import cast_vote, canonical
from witness_gate import admit_audit_checkpoint, verify_witness_receipt, WitnessDenied
from synthetic_witness import SyntheticWitness

CLOCK=1791910000
VOTERS=('voter-a','voter-b','voter-c')
PROPOSAL={
    'schema':'axiom.trackb25.s0.checkpoint-proposal.v1','work_id':'axiom-b26-case',
    'sequence':1,'digest_sha256':'a'*64,'nonce':'nonce-b26-1','utc_day':'2026-10-13',
    'scope':'S0_LOCAL_AUDIT_ONLY','provider_dispatch_allowed':False,'production_authority':False}

def pub(key):return key.public_key().public_bytes(Encoding.Raw,PublicFormat.Raw)

class _Fixture(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='axiom-b26-');self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)
        self.keys={n:Ed25519PrivateKey.generate() for n in VOTERS}
        self.pins={n:pub(k) for n,k in self.keys.items()}
        self.key=Ed25519PrivateKey.generate()
        self.proposal=copy.deepcopy(PROPOSAL)
        self.witness=SyntheticWitness(self.root/'witness.sqlite',self.key)
        self.votes=[self.vote('voter-a'),self.vote('voter-b')]
    def vote(self,name):
        return cast_vote(self.root/f'{name}.sqlite',name,self.keys[name],self.proposal,trusted_now=CLOCK)
    def admit(self,proposal=None,votes=None,witness=None,pin=None,now=CLOCK):
        return admit_audit_checkpoint(proposal=proposal or self.proposal,votes=self.votes if votes is None else votes,
            pinned_voters=self.pins,witness=self.witness if witness is None else witness,
            pinned_witness_key=pub(self.key) if pin is None else pin,trusted_now=now)
class WitnessGateTest(_Fixture):
    def test_first_signed_synthetic_witness_attestation_is_audit_only(self):
        value=self.admit()
        self.assertEqual(value['status'],'B26_S0_WITNESSED_AUDIT_NO_DISPATCH')
        self.assertFalse(value['provider_dispatch_allowed'])
        self.assertFalse(value['production_authority'])
        self.assertEqual(value['witness_id'],'test-witness')
    def test_majority_local_rollback_does_not_renew_when_witness_survives(self):
        self.admit()
        for n in ('voter-a','voter-b'):(self.root/f'{n}.sqlite').unlink()
        replaced=[self.vote(n) for n in ('voter-a','voter-b')]
        with self.assertRaises(WitnessDenied):self.admit(votes=replaced)
    def test_unavailable_witness_does_not_fall_back_to_quorum(self):
        class Offline:
            def commit(self,**_):raise OSError('no remote')
        with self.assertRaises(WitnessDenied):self.admit(witness=Offline())
    def test_pin_must_be_independent_of_local_voters(self):
        with self.assertRaises(WitnessDenied):self.admit(pin=self.pins['voter-a'])
    def test_valid_witness_receipt_verifiable_with_pinned_key(self):
        value=self.admit()
        verified=verify_witness_receipt(receipt=value['receipt'],proposal=self.proposal,votes=self.votes,
            pinned_witness_key=pub(self.key),pinned_voters=self.pins,trusted_now=CLOCK)
        self.assertFalse(verified['provider_dispatch_allowed'])
    def test_forged_witness_receipt_fails(self):
        value=self.admit();receipt=copy.deepcopy(value['receipt']);sig=bytearray(base64.b64decode(receipt['signature_b64']));sig[0]^=1
        receipt['signature_b64']=base64.b64encode(sig).decode()
        with self.assertRaises(WitnessDenied):verify_witness_receipt(receipt=receipt,proposal=self.proposal,votes=self.votes,pinned_witness_key=pub(self.key),trusted_now=CLOCK)
    def test_replayed_receipt_is_not_an_action_token(self):
        value=self.admit();self.assertNotIn('dispatch_allowed',value['receipt']);self.assertFalse(value['provider_dispatch_allowed'])
        with self.assertRaises(WitnessDenied):self.admit()

if __name__=='__main__':unittest.main()

class WitnessAdversarialTest(_Fixture):
    """Inherited baseline scenarios plus independent adversarial variations."""

    def test_archive_receipt_must_require_trusted_voter_pins(self):
        row=self.admit()
        with self.assertRaises(WitnessDenied):
            verify_witness_receipt(receipt=row['receipt'],proposal=self.proposal,votes=self.votes,
                                   pinned_witness_key=pub(self.key),trusted_now=CLOCK)

    def test_tampered_vote_invalidates_attestation_even_if_witness_was_signed(self):
        row=self.admit()
        votes=copy.deepcopy(self.votes)
        votes[1]['signature_b64']=votes[0]['signature_b64']
        with self.assertRaises(WitnessDenied):
            verify_witness_receipt(receipt=row['receipt'],proposal=self.proposal,votes=votes,
                pinned_witness_key=pub(self.key),pinned_voters=self.pins,trusted_now=CLOCK)

    def test_witness_response_key_injection_denied(self):
        row=self.admit()
        fake=copy.deepcopy(row['receipt']);fake['public_key_b64']=base64.b64encode(pub(self.key)).decode()
        with self.assertRaises(WitnessDenied):
            verify_witness_receipt(receipt=fake,proposal=self.proposal,votes=self.votes,
                pinned_voters=self.pins,pinned_witness_key=pub(self.key),trusted_now=CLOCK)

    def test_clock_scope_fails_before_witness_call(self):
        class Probe:
            calls=0
            def commit(self,**_):self.calls+=1
        p=Probe()
        with self.assertRaises(WitnessDenied):self.admit(witness=p,now=CLOCK+86400)
        self.assertEqual(p.calls,0)

    def test_unrecognized_or_wrong_pins_fail_closed(self):
        with self.assertRaises(WitnessDenied):self.admit(pin=b'')
        with self.assertRaises(WitnessDenied):self.admit(pin=self.pins['voter-b'])

    def test_wrong_witness_signature_cannot_be_used(self):
        other=Ed25519PrivateKey.generate()
        forged=SyntheticWitness(self.root/'rogue.sqlite',other)
        with self.assertRaises(WitnessDenied):self.admit(witness=forged)

    def test_signature_valid_checkpoint_digest_mutation_is_denied(self):
        row=self.admit();p=copy.deepcopy(self.proposal);p['digest_sha256']='f'*64
        with self.assertRaises(WitnessDenied):
            verify_witness_receipt(receipt=row['receipt'],proposal=p,votes=self.votes,
                pinned_witness_key=pub(self.key),pinned_voters=self.pins,trusted_now=CLOCK)

    def test_journal_survives_restart_without_regranting(self):
        self.admit()
        new=SyntheticWitness(self.root/'witness.sqlite',self.key)
        with self.assertRaises(WitnessDenied):self.admit(witness=new)

    def test_commit_then_connection_interruption_cannot_resend(self):
        class Interrupted:
            witness_id='test-witness'
            def __init__(self,inner):self.inner=inner
            def commit(self,**kw):
                self.inner.commit(**kw)
                raise TimeoutError('drop reply after COMMIT')
        with self.assertRaises(WitnessDenied):self.admit(witness=Interrupted(self.witness))
        with self.assertRaises(WitnessDenied):self.admit()

    def test_witness_loss_and_two_voter_rollbacks_still_break_simulated_antirollback(self):
        self.admit()
        (self.root/'witness.sqlite').unlink()
        for name in ('voter-a','voter-b'):(self.root/f'{name}.sqlite').unlink()
        replacement=[self.vote(n) for n in ('voter-a','voter-b')]
        # This intentionally documents a FAILED global-rollback gate. A second
        # audit receipt becomes possible after the simulated external witness
        # itself loses state. No production certification may depend on B26.
        second=self.admit(votes=replacement)
        self.assertEqual(second['status'],'B26_S0_WITNESSED_AUDIT_NO_DISPATCH')
        self.assertFalse(second['provider_dispatch_allowed'])

    def test_replay_during_same_work_with_higher_sequence_is_allowed_as_new_audit(self):
        self.admit()
        p=copy.deepcopy(self.proposal);p['sequence']=2;p['nonce']='nonce-b26-2'
        fresh=[cast_vote(self.root/f'{n}.sqlite',n,self.keys[n],p,trusted_now=CLOCK) for n in ('voter-a','voter-b')]
        newer=self.admit(proposal=p,votes=fresh)
        self.assertFalse(newer['provider_dispatch_allowed'])

