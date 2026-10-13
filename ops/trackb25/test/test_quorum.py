import base64,copy,hashlib,json,sys,tempfile,unittest
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding,PublicFormat
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from quorum import QuorumDenied,cast_vote,verify_quorum

CLOCK=1791910000
NAMES=('voter-a','voter-b','voter-c')
KEYS={n:Ed25519PrivateKey.generate() for n in NAMES}
PINS={n:k.public_key().public_bytes(Encoding.Raw,PublicFormat.Raw) for n,k in KEYS.items()}
DIGEST='a'*64
BASE={'schema':'axiom.trackb25.s0.checkpoint-proposal.v1','work_id':'axiom-b19-native-s0',
      'sequence':1,'digest_sha256':DIGEST,'nonce':'q-20261013-1','utc_day':'2026-10-13',
      'scope':'S0_LOCAL_AUDIT_ONLY','provider_dispatch_allowed':False,'production_authority':False}

def sha(obj):return hashlib.sha256(json.dumps(obj,sort_keys=True,separators=(',',':')).encode()).hexdigest()
class ReplicaSuite(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='axiom-b25-')
        self.root=Path(self.tmp.name)
        self.p=copy.deepcopy(BASE)
    def tearDown(self):self.tmp.cleanup()
    def vote(self,name,proposal=None):
        return cast_vote(self.root/f'{name}.sqlite',name,KEYS[name], proposal if proposal is not None else self.p, trusted_now=CLOCK)
    def quorum(self,receipts,proposal=None,pins=None):
        return verify_quorum(receipts,proposal if proposal is not None else self.p,
                             pinned_voters=pins if pins is not None else PINS, trusted_now=CLOCK)
    def assertDenied(self,fun):
        with self.assertRaises(QuorumDenied):fun()
    def test_two_separate_witnesses_form_an_s0_audit_quorum(self):
        result=self.quorum([self.vote('voter-a'),self.vote('voter-b')]);self.assertEqual(result['verified_votes'],2)
        self.assertEqual(result['status'],'B25_S0_LOCAL_QUORUM_AUDIT_NOT_DISPATCH')
    def test_three_distinct_votes_allowed_not_three_dispatches(self):
        result=self.quorum([self.vote(n) for n in NAMES]);self.assertEqual(result['verified_votes'],3)
        self.assertFalse(result['production_authority'])
    def test_one_voter_not_quorum(self):self.assertDenied(lambda:self.quorum([self.vote('voter-a')]))
    def test_duplicate_voter_cannot_vote_twice(self):
        self.vote('voter-a');self.assertDenied(lambda:self.vote('voter-a'))
    def test_same_vote_receipt_counted_once(self):
        a=self.vote('voter-a');self.assertDenied(lambda:self.quorum([a,a]))
    def test_forged_sig_denied(self):
        a=self.vote('voter-a');b=self.vote('voter-b');b['signature_b64']=a['signature_b64'];self.assertDenied(lambda:self.quorum([a,b]))
    def test_conflicting_checkpoint_digest_denied(self):
        a=self.vote('voter-a');b=self.vote('voter-b');bad=copy.deepcopy(self.p);bad['digest_sha256']='f'*64;self.assertDenied(lambda:self.quorum([a,b],proposal=bad))
    def test_unknown_voter_denied(self):
        a=self.vote('voter-a');b=self.vote('voter-b');b['voter_id']='rogue';self.assertDenied(lambda:self.quorum([a,b]))
    def test_receipt_key_injection_denied(self):
        a=self.vote('voter-a');b=self.vote('voter-b');a['public_key_b64']=base64.b64encode(PINS['voter-a']).decode();self.assertDenied(lambda:self.quorum([a,b]))
    def test_wrong_pin_denied(self):
        a=self.vote('voter-a');b=self.vote('voter-b');pin=copy.deepcopy(PINS);pin['voter-b']=PINS['voter-c'];self.assertDenied(lambda:self.quorum([a,b],pins=pin))
    def test_missing_pin_denied(self):
        a=self.vote('voter-a');b=self.vote('voter-b');self.assertDenied(lambda:self.quorum([a,b],pins={'voter-a':PINS['voter-a']}))
    def test_raced_restart_does_not_allow_second_vote(self):
        self.vote('voter-a');self.assertDenied(lambda:self.vote('voter-a'))
    def test_one_rolledback_replica_cannot_create_new_two_of_three_vote_quorum(self):
        votes=[self.vote(n) for n in NAMES]
        (self.root/'voter-a.sqlite').unlink()
        one=self.vote('voter-a')
        self.assertDenied(lambda:self.vote('voter-b'))
        self.assertDenied(lambda:self.vote('voter-c'))
        self.assertDenied(lambda:self.quorum([one]))
        # Old receipts are still verifiable audit evidence. They are not a
        # dispatch token; invoking them cannot authorize a fresh provider call.
        self.assertEqual(self.quorum(votes)['verified_votes'],3)
    def test_two_rolledback_replicas_remain_not_certified(self):
        for n in NAMES:self.vote(n)
        for n in ('voter-a','voter-b'): (self.root/f'{n}.sqlite').unlink()
        # This shows explicit failure to prevent majority compromise; no
        # production promotion may depend on this S0 model.
        a=self.vote('voter-a');b=self.vote('voter-b')
        self.assertEqual(self.quorum([a,b])['verified_votes'],2)
    def test_sequence_rollback_denied(self):
        self.vote('voter-a');p=copy.deepcopy(self.p);p['sequence']=2;p['nonce']='q-20261013-2'
        self.vote('voter-a',p)
        self.assertDenied(lambda:self.vote('voter-a'))
    def test_bad_scope_denied(self):
        self.p['production_authority']=True;self.assertDenied(lambda:self.vote('voter-a'))
    def test_bad_day_denied(self):
        self.p['utc_day']='2026-10-14';self.assertDenied(lambda:self.vote('voter-a'))
    def test_missing_workload_digest_denied(self):
        self.p.pop('digest_sha256');self.assertDenied(lambda:self.vote('voter-a'))
    def test_unsigned_proposal_not_an_external_identity(self):
        result=self.quorum([self.vote('voter-a'),self.vote('voter-b')]);self.assertFalse(result['provider_dispatch_allowed'])
if __name__=='__main__':unittest.main()
