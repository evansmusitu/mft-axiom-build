"""Gate1 test-only synthetic denial suite, NEVER grant provider mutation."""
import copy
import hashlib
import importlib.util
import json
import pathlib
import tempfile
import unittest
from datetime import datetime,timedelta,timezone

MODULE=pathlib.Path(__file__).resolve().parents[1]/'qualification'/'step1_gate1_evidence_adjudicator_20261113.py'
spec=importlib.util.spec_from_file_location('axiom_evidence_adjudicator', MODULE)
a=importlib.util.module_from_spec(spec)
spec.loader.exec_module(a)
NOW=datetime(2026,11,13,18,0,tzinfo=timezone.utc)


def base(kind):
    common=dict(captured_at_utc=NOW.isoformat(),operation='GET_ONLY_NO_MUTATION_NO_SQL_NO_CUSTOMER_ROWS',gate1_closed=False,step1_closed=False,step2_authorized=False,release_status='NOT_RELEASE')
    if kind=='bill':
        return dict(common,schema=a.BILLING_SCHEMA, cloudflare_account=a.ACCOUNT,original_d1_uuid=a.SOURCE,
          spend_policies_http=200,spend_policies_catalog_qualified=True,rated_usage_http=200,billing_cycle_http=200,
          workers_paid_active=True,d1_hard_zero_spend_provider_guarantee_qualified=False,
          no_additional_spend_contract_verified=False,provider_d1_target_creation_authorized=False,
          historical_independent_custody_result='UNMET_POLICY_SUPERSEDED_NOT_PASS',
          b27_synthetic_cas_result='FAIL',pr83_fullstack_result='FAIL')
    return dict(common,schema=a.MFA_SCHEMA,account=a.ACCOUNT,account_http=200,account_identity_matched=True,
        member_list_http=200,member_list_complete=True,accepted_member_2fa_all_enabled=True,
        account_2fa_requirement_enabled=False,owner_physical_mfa_challenge_completed=False,
        owner_identity_and_mfa_independently_qualified=False, owner_signing_public_spki_independently_activated=False,
        sole_owner_policy_runtime_activated=False,runtime_pr216_two_human_verification_unchanged=True,
        owner_signed_proposal_authorizes_provider_operations=False,b27_synthetic_cas='FAIL',pr83_fullstack='FAIL')


class EvidenceTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='axiom_gate1_synthetic_')
        self.addCleanup(self.tmp.cleanup)
        self.dir=pathlib.Path(self.tmp.name)
        self.bill=base('bill');self.mfa=base('mfa')

    def save(self,obj,name):
        p=self.dir/name
        raw=(json.dumps(obj,sort_keys=True,indent=2)+'\n').encode()
        p.write_bytes(raw)
        (self.dir/(name+'.sha256')).write_text(hashlib.sha256(raw).hexdigest()+'  '+name+'\n')
        return p

    def run_review(self,now=NOW):
        b=self.save(self.bill,'billing.json');m=self.save(self.mfa,'mfa.json')
        return a.adjudicate(b,m,now=now)

    def test_normal_still_no_go(self):
        r=self.run_review();self.assertFalse(r['gate1_closed']);self.assertEqual(r['release_status'],'NOT_RELEASE')
        self.assertIn('D1_HARD_ZERO_ADDITIONAL_SPEND_NOT_QUALIFIED',r['reason_codes'])
        self.assertIn('OWNER_INTERACTIVE_MFA_NOT_ATTESTED',r['reason_codes'])

    def test_forged_all_success_flags_still_no_go(self):
        self.bill.update(d1_hard_zero_spend_provider_guarantee_qualified=True,no_additional_spend_contract_verified=True,provider_d1_target_creation_authorized=True)
        self.mfa.update(account_2fa_requirement_enabled=True,owner_physical_mfa_challenge_completed=True,
          owner_identity_and_mfa_independently_qualified=True,owner_signing_public_spki_independently_activated=True,
          sole_owner_policy_runtime_activated=True,runtime_pr216_two_human_verification_unchanged=False,
          owner_signed_proposal_authorizes_provider_operations=True)
        r=self.run_review()
        self.assertFalse(r['gate1_closed']);self.assertFalse(r['d1_creation_authorized'])
        self.assertIn('GET_ONLY_BILLING_RECEIPT_IS_NOT_A_SPEND_CONTRACT',r['reason_codes'])
        self.assertIn('GET_ONLY_MFA_POSTURE_NOT_AN_OWNER_IDENTITY_ATTESTATION',r['reason_codes'])

    def test_currently_zero_billed_usage_never_spend_contract(self):
        self.bill['rated_usage_zero_billed_cost_snapshot_qualified']=True
        self.assertIn('D1_HARD_ZERO_ADDITIONAL_SPEND_NOT_QUALIFIED',self.run_review()['reason_codes'])

    def test_missing_billing_limit(self):
        self.bill['spend_policies_http']='HTTP_403'
        self.assertIn('SPEND_POLICIES_NOT_QUALIFIED',self.run_review()['reason_codes'])

    def test_billing_account_drift(self):
        self.bill['cloudflare_account']='0'*32
        self.assertIn('BILLING_SOURCE_IDENTITY_DRIFT',self.run_review()['reason_codes'])

    def test_mfa_account_drift(self):
        self.mfa['account']='0'*32
        self.assertIn('MFA_ACCOUNT_IDENTITY_DRIFT',self.run_review()['reason_codes'])

    def test_stale_mfa(self):
        self.mfa['captured_at_utc']=(NOW-timedelta(hours=5)).isoformat()
        self.assertIn('MFA_EVIDENCE_NOT_FRESH',self.run_review()['reason_codes'])

    def test_future_billing(self):
        self.bill['captured_at_utc']=(NOW+timedelta(minutes=5)).isoformat()
        self.assertIn('BILLING_EVIDENCE_NOT_FRESH',self.run_review()['reason_codes'])

    def test_both_vetoes_must_remain(self):
        self.mfa['pr83_fullstack']='PASS';self.mfa['b27_synthetic_cas']='PASS'
        self.assertIn('HISTORICAL_VETO_CHANGED_OR_ERASED',self.run_review()['reason_codes'])

    def test_invalid_manifest_hash(self):
        b=self.save(self.bill,'billing.json');b.write_text('{}')
        with self.assertRaisesRegex(a.NoGo,'SHA256_OR_MANIFEST_NAME_MISMATCH'):
            a.read_verified_json(str(b),a.BILLING_SCHEMA)

    def test_manifest_name_substitution(self):
        b=self.save(self.bill,'billing.json')
        manifest=pathlib.Path(str(b)+'.sha256');manifest.write_text(manifest.read_text().replace('billing.json','other.json'))
        with self.assertRaisesRegex(a.NoGo,'SHA256_OR_MANIFEST_NAME_MISMATCH'):
            a.read_verified_json(str(b),a.BILLING_SCHEMA)

    def test_evidence_symlink_rejected(self):
        b=self.save(self.bill,'billing.json');target=self.dir/'evil.json';target.symlink_to(b)
        with self.assertRaisesRegex(a.NoGo,'NONREGULAR_OR_SYMLINK_FILE'):
            a.read_verified_json(str(target),a.BILLING_SCHEMA)

    def test_manifest_symlink_rejected(self):
        b=self.save(self.bill,'billing.json');manifest=pathlib.Path(str(b)+'.sha256');copy_manifest=self.dir/'copy.sha256'
        manifest.rename(copy_manifest);manifest.symlink_to(copy_manifest)
        with self.assertRaisesRegex(a.NoGo,'NONREGULAR_OR_SYMLINK_FILE'):
            a.read_verified_json(str(b),a.BILLING_SCHEMA)

    def test_release_veto_forged_true_rejected(self):
        self.bill['gate1_closed']=True
        with self.assertRaisesRegex(a.NoGo,'INVALID_RELEASE_VETO_EVIDENCE'):
            self.run_review()

    def test_schema_substitution_rejected(self):
        self.mfa['schema']='fake-schema'
        with self.assertRaisesRegex(a.NoGo,'EVIDENCE_SCHEMA_NOT_PINNED'):
            self.run_review()

    def test_non_utc_timestamp_rejected(self):
        self.bill['captured_at_utc']='2026-11-13T20:00:00+02:00'
        with self.assertRaisesRegex(a.NoGo,'NON_UTC_EVIDENCE_TIME'):
            self.run_review()

    def test_unsupported_method_detected(self):
        self.bill['operation']='POST_SPEND_POLICY'
        self.assertIn('BILLING_NON_GET_RECEIPT',self.run_review()['reason_codes'])

    def test_missing_billing_file(self):
        with self.assertRaisesRegex(a.NoGo,'LOCAL_EVIDENCE_FILE_UNAVAILABLE'):
            a.read_verified_json(str(self.dir/'missing.json'),a.BILLING_SCHEMA)

    def test_relative_path_rejected(self):
        with self.assertRaisesRegex(a.NoGo,'ABSOLUTE_LOCAL_PATH_REQUIRED'):
            a.read_verified_json('billing.json',a.BILLING_SCHEMA)

    def test_indeterminate_time_rejected(self):
        with self.assertRaisesRegex(a.NoGo,'INDETERMINATE_CLOCK'):
            self.run_review(now=datetime(2026,11,13))

    def test_proposal_permission_missing_even_if_usage_is_zero(self):
        self.bill['rated_usage_zero_billed_cost_snapshot_qualified']=True
        self.mfa['accepted_member_2fa_all_enabled']=True
        self.assertIn('MUTATION_SPECIFIC_OWNER_PERMISSION_ABSENT',self.run_review()['reason_codes'])

if __name__=='__main__':unittest.main()
