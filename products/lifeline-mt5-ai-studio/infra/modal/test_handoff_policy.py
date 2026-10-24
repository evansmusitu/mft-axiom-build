"""No-provider offline tests. A missing handoff_policy module must fail RED first."""
import base64
import os
import unittest
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization
from handoff_policy import guard_bindings, encrypt_to_gh, decrypt_for_gh

IDENTITY={"ACCESS_ISSUER","ACCESS_AUD","ACCESS_OPERATOR_SUB"}
SOURCE={"AGENT_ID":"lifeline-stage-20261021","AGENT_TENANT":"test_tenant_A",
        "AGENT_HMAC_KEY":"a"*48,"EDGE_SHARED_SECRET":"b"*48}
class HandoffPolicyTests(unittest.TestCase):
    def keypair(self):
        k=rsa.generate_private_key(public_exponent=65537,key_size=3072)
        pub=base64.b64encode(k.public_key().public_bytes(
            serialization.Encoding.DER,serialization.PublicFormat.SubjectPublicKeyInfo)).decode()
        return k,pub
    def test_exact_existing_lifeline_stage_only(self):
        self.assertEqual(guard_bindings(IDENTITY|{"MODAL_ORIGIN"}),{"AGENT_ID","AGENT_TENANT","AGENT_HMAC_KEY","EDGE_SHARED_SECRET"})
    def test_preexisting_proxy_tokens_refused(self):
        with self.assertRaises(ValueError):
            guard_bindings(IDENTITY|{"MODAL_ORIGIN","MODAL_PROXY_KEY"})
    def test_unknown_binding_refused(self):
        with self.assertRaises(ValueError):
            guard_bindings(IDENTITY|{"MODAL_ORIGIN","ANOTHER_PRODUCT_KEY"})
    def test_missing_owner_identity_refused(self):
        with self.assertRaises(ValueError):
            guard_bindings({"MODAL_ORIGIN"})
    def test_encrypted_modal_payload_round_trip(self):
        private,pub=self.keypair()
        envelope=encrypt_to_gh(SOURCE,pub)
        self.assertNotIn("AGENT_HMAC_KEY",str(envelope))
        restored=decrypt_for_gh(envelope,private)
        self.assertEqual(restored,SOURCE)
    def test_tampered_payload_refused(self):
        private,pub=self.keypair()
        envelope=encrypt_to_gh(SOURCE,pub)
        envelope["ciphertext_b64"]=base64.b64encode(os.urandom(200)).decode()
        with self.assertRaises(ValueError):
            decrypt_for_gh(envelope,private)
    def test_wrong_secret_scope_refused(self):
        _,pub=self.keypair()
        with self.assertRaises(ValueError):
            encrypt_to_gh(dict(SOURCE,SECRET_FOR_OTHER_PROJECT="x"),pub)
    def test_mismatched_agent_identity_refused(self):
        _,pub=self.keypair()
        src=dict(SOURCE,AGENT_TENANT="some_other_tenant")
        with self.assertRaises(ValueError):
            encrypt_to_gh(src,pub)
    def test_weak_hmac_key_refused(self):
        _,pub=self.keypair()
        src=dict(SOURCE,AGENT_HMAC_KEY="short")
        with self.assertRaises(ValueError):
            encrypt_to_gh(src,pub)

if __name__=="__main__":unittest.main()
