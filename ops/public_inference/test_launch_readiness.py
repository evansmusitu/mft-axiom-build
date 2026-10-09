"""Strict evidence classification. Synthetic positive proof is not real certification."""
import copy
import hashlib
import hmac
import json
import unittest

from launch_readiness import assess_readiness, GateRejected, FIELDS, SCHEMA

SECRET=b'offline-independent-test-reviewer-signing-key-1234567'


def sample():
    claims = {
      'schema':SCHEMA,'source_commit_sha256':'a'*40,'project':'MUSITU_AXIOM_PUBLIC_INFERENCE',
      'cash_budget_usd':'0.00','account_ledger':'CF_ACCOUNT_BOUND',
      'workers_plan':'FREE','workers_ai_daily_hard_stop':True,
      'd1_plan':'FREE','d1_quota_hard_stop':True,
      'groq_disabled':True,'external_spend_possible':False,
      'customer_identity_issuer_verified':True,
      'user_consent_and_privacy_verified':True,'live_d1_sqlite_reconciliation_verified':True,
      'real_provider_response_verified':True,'independent_security_attack_passed':True,
      'rollback_execution_verified':True,'independent_reviewer_id':'security-gateway-not-builder',
      'builder_id':'axiom-builder',
      'evidence_sha256':'c'*64,'not_before_unix':1000,'expires_unix':1050,
      's4_public_release_approved':False,
    }
    assert set(claims)==FIELDS
    return claims


def signed(claims):
    wire=json.dumps(claims,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
    return hmac.new(SECRET,wire,hashlib.sha256).hexdigest()


class ReadinessTests(unittest.TestCase):
    def call(self,claims=None,signature=None,**kwargs):
        c=sample() if claims is None else claims
        return assess_readiness(claims=c,signature=signed(c) if signature is None else signature,
                                signing_key=kwargs.pop('signing_key', SECRET),
                                now_unix=kwargs.pop('now_unix', 1020),**kwargs)

    def test_all_synthetic_technical_gates_still_not_public_authority(self):
        result=self.call()
        self.assertEqual(result['technical_gate'],'TECHNICAL_EVIDENCE_CONTRACT_ACCEPTED_NOT_LIVE_CERTIFIED')
        self.assertFalse(result['public_release_authorized'])
        self.assertEqual(result['live_external_verification'],'NOT_PERFORMED_BY_THIS_MODULE')
        self.assertNotIn('c'*64,str(result))
        self.assertNotIn('a'*40,str(result))

    def test_private_or_paid_fails_closed(self):
        cases=[{'workers_plan':'PAID'},{'cash_budget_usd':'0.01'},
               {'external_spend_possible':True},{'workers_ai_daily_hard_stop':False},
               {'d1_plan':'PAID'},{'d1_quota_hard_stop':False},
               {'groq_disabled':False},{'s4_public_release_approved':True}]
        for change in cases:
            with self.subTest(change=change),self.assertRaises(GateRejected):
                self.call({**sample(),**change})

    def test_no_unverified_gates_accepted(self):
        checks=[
           'customer_identity_issuer_verified','user_consent_and_privacy_verified',
           'live_d1_sqlite_reconciliation_verified','real_provider_response_verified',
           'independent_security_attack_passed','rollback_execution_verified',
        ]
        for field in checks:
            with self.subTest(field=field),self.assertRaises(GateRejected):
                self.call({**sample(),field:False})

    def test_identity_reviewer_and_signed_integrity_enforced(self):
        changes=[{'builder_id':'security-gateway-not-builder'},
                 {'independent_reviewer_id':'axiom-builder'},
                 {'evidence_sha256':'bad'},
                 {'source_commit_sha256':'bad'},
                 {'schema':'unapproved-schema'},
                 {'not_before_unix':1025},
                 {'expires_unix':1019},
                 {'expires_unix':2000},
                 {'cash_budget_usd':0},
                 {'workers_ai_daily_hard_stop':1},
                 {'unexpected':'prop'},
                ]
        for change in changes:
            with self.subTest(change=change),self.assertRaises(GateRejected):
                self.call({**sample(),**change})
        with self.assertRaises(GateRejected):
            self.call(signature='0'*64)
        with self.assertRaises(GateRejected):
            self.call(signing_key=b'bad')

    def test_no_claim_from_builder_unsigned_data(self):
        with self.assertRaises(GateRejected):
            self.call(signature=None, signing_key=b'bad')

    def test_does_not_accept_unknown_budget_provider(self):
        for change in ({'account_ledger':'SPOOFED'}, {'project':'OTHER_PRODUCT'}):
            with self.subTest(change=change),self.assertRaises(GateRejected):
                self.call({**sample(),**change})

if __name__=='__main__':unittest.main()
