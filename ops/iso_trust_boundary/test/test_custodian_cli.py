"""Offline public-only CLI; no private-key arguments or network calls."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding,PublicFormat

from ops.iso_trust_boundary.custodian_enrollment import challenge_signing_bytes

ROOT=Path(__file__).resolve().parents[3]


class CustodianCLITests(unittest.TestCase):
    def setUp(self):
        self.operator=Ed25519PrivateKey.generate()
        self.witness=Ed25519PrivateKey.generate()
        self.o=self.operator.public_key().public_bytes(Encoding.Raw,PublicFormat.Raw).hex()
        self.w=self.witness.public_key().public_bytes(Encoding.Raw,PublicFormat.Raw).hex()
        self.policy='c'*64
        self.common=['--project','musitu-axiom','--custodian','human-owner-001',
                     '--operator-public-hex',self.o,'--witness-public-hex',self.w,
                     '--policy-sha256',self.policy]

    def run_cli(self,*args):
        return subprocess.run([sys.executable,'-m','ops.iso_trust_boundary.custodian_onboarding_cli',*args],
                              cwd=ROOT,env={**os.environ,'PYTHONPATH':str(ROOT)},capture_output=True,text=True)

    def test_help_contains_only_public_credentials(self):
        p=self.run_cli('--help')
        self.assertEqual(p.returncode,0,p.stderr)
        self.assertIn('--operator-public-hex',p.stdout)
        self.assertNotIn('--private-key',p.stdout)
        self.assertNotIn('--billing-credential',p.stdout)

    def test_issue_outputs_public_challenge_without_authority(self):
        p=self.run_cli('issue',*self.common)
        self.assertEqual(p.returncode,0,p.stderr)
        x=json.loads(p.stdout)
        self.assertEqual(x['schema'],'musitu.axiom.custody-possession-challenge.v1')
        self.assertEqual(x['operator_public_key_hex'],self.o)
        self.assertEqual(x['witness_public_key_hex'],self.w)
        self.assertNotIn('private_key',p.stdout)
        self.assertNotIn('execution_allowed',p.stdout)

    def test_inspect_outputs_denial_even_with_valid_signature(self):
        import hashlib
        challenge_json=self.run_cli('issue',*self.common)
        self.assertEqual(challenge_json.returncode,0,challenge_json.stderr)
        challenge=json.loads(challenge_json.stdout)
        body=challenge_signing_bytes(challenge)
        proof={'schema':'musitu.axiom.custody-possession-proof.v1',
               'challenge_sha256':hashlib.sha256(body).hexdigest(),
               'operator_signature_hex':self.operator.sign(body).hex()}
        with tempfile.TemporaryDirectory() as d:
            ch=Path(d)/'challenge.json';sig=Path(d)/'proof.json'
            ch.write_text(json.dumps(challenge));sig.write_text(json.dumps(proof))
            p=self.run_cli('inspect',*self.common,'--challenge',str(ch),'--proof',str(sig))
        self.assertEqual(p.returncode,0,p.stderr)
        x=json.loads(p.stdout)
        self.assertEqual(x['status'],'BLOCKED_EXTERNAL_AUTHORITY_NOT_PROVEN')
        self.assertEqual(x['possession_review'],'LOCAL_KEY_POSSESSION_VALID_ONLY')
        self.assertIs(x['execution_allowed'],False)
        self.assertIs(x['provider_dispatch_allowed'],False)

    def test_inspect_rejects_invalid_proof_without_stdout_success(self):
        p=self.run_cli('inspect',*self.common,'--challenge','/missing/challenge.json','--proof','/missing/proof.json')
        self.assertNotEqual(p.returncode,0)
        self.assertEqual(p.stdout,'')
        self.assertIn('HOLD',p.stderr)


if __name__=='__main__': unittest.main()
