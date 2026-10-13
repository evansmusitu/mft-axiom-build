import base64
import json
import unittest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from portable import make_portable, verify_portable, PortableDenied
from journal import GENESIS, _canonical
import hashlib


class PortableReceiptTests(unittest.TestCase):
    def setUp(self):
        self.key=Ed25519PrivateKey.generate()
        self.proof={'work_id':'axiom-work','events':1,'chain_sha256':'0'*64,
                    'workers':{'agent-a':{'ActionEvent':1,'ObservationEvent':0,'finish':1}}}
        self.trace=[{'worker':'agent-a','ordinal':0,'event':{'kind':'ActionEvent','id':'a',
            'tool_call_id':'t','tool_name':'finish','action_id':'a'}}]
        self.source={'agent-a':'b'*64}
        self.proof['chain_sha256']=hashlib.sha256(bytes.fromhex(GENESIS)+_canonical({'work_id':'axiom-work','worker':'agent-a','ordinal':0,'event':self.trace[0]['event']})).hexdigest()
    def make(self):
        return make_portable(self.proof,self.trace,self.source,self.key,'f'*40)
    def test_roundtrip_independent_verifier(self):
        e=self.make();v=verify_portable(e)
        self.assertEqual(v['chain_sha256'],self.proof['chain_sha256'])
        self.assertEqual(v['source_sha256'],self.source)
    def test_changed_event_rejected(self):
        e=self.make();e['events'][0]['event']['tool_name']='think'
        with self.assertRaises(PortableDenied):verify_portable(e)
    def test_changed_source_rejected(self):
        e=self.make();e['source_sha256']['agent-a']='c'*64
        with self.assertRaises(PortableDenied):verify_portable(e)
    def test_changed_commit_rejected(self):
        e=self.make();e['source_commit']='e'*40
        with self.assertRaises(PortableDenied):verify_portable(e)
    def test_changed_signature_rejected(self):
        e=self.make();e['signature_b64']=base64.b64encode(b'0'*64).decode()
        with self.assertRaises(PortableDenied):verify_portable(e)
    def test_invalid_schema_fail_closed(self):
        e=self.make();e['unknown']='wrong'
        with self.assertRaises(PortableDenied):verify_portable(e)
    def test_truncated_trace_detected(self):
        e=self.make();e['events']=[]
        with self.assertRaises(PortableDenied):verify_portable(e)
    def test_invalid_base64_rejected(self):
        e=self.make();e['signature_b64']='ab=='
        with self.assertRaises(PortableDenied):verify_portable(e)

if __name__=='__main__':unittest.main()
