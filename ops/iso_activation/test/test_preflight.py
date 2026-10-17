import copy
import json
import unittest
from pathlib import Path
from sys import path

path.insert(0,str(Path(__file__).resolve().parents[1]))
from preflight import ActivationDenied, assess, load_observations, verify_handoff

class ActivationPreflightChecks(unittest.TestCase):
    def setUp(self):
        self.facts=load_observations(Path(__file__).resolve().parents[1]/'OBSERVED_STATE.json')

    def test_observed_reality_fails_closed(self):
        verdict=assess(self.facts)
        self.assertEqual(verdict['status'],'BLOCKED')
        self.assertEqual(verdict['operator_appointment'],'APPOINTED_BY_USER')
        self.assertEqual(verdict['independent_authority'],'NOT_PROVEN')
        self.assertEqual(verdict['global_antirollback'],'FAILED_SYNTHETIC_ATTACK')
        self.assertEqual(verdict['next_step'],'OUT_OF_BAND_HUMAN_CUSTODY_AND_REVIEW')
        self.assertIs(verdict['production_authority'],False)
        self.assertIs(verdict['provider_dispatch_allowed'],False)

    def test_no_branch_permission_can_promote(self):
        v=assess(self.facts)
        for x in ('production_authority','provider_dispatch_allowed'):
            self.assertFalse(v[x])

    def test_rejects_extra_schema_keys(self):
        altered=copy.deepcopy(self.facts);altered['production_approved']=True
        with self.assertRaises(ActivationDenied):assess(altered)

    def test_deny_claim_of_independent_ledger(self):
        altered=copy.deepcopy(self.facts);altered['known_attack']='RESOLVED'
        with self.assertRaises(ActivationDenied):assess(altered)

    def test_deny_invented_reviewer(self):
        altered=copy.deepcopy(self.facts);altered['independent_verifier']='APPOINTED'
        with self.assertRaises(ActivationDenied):assess(altered)

    def test_deny_operator_promotion_without_reviewer(self):
        altered=copy.deepcopy(self.facts);altered['operator_status']='CERTIFIED'
        with self.assertRaises(ActivationDenied):assess(altered)

    def test_deny_paid_cost_assumption(self):
        altered=copy.deepcopy(self.facts);altered['zero_cost']='CERTIFIED'
        with self.assertRaises(ActivationDenied):assess(altered)

    def test_deny_fake_mfa(self):
        altered=copy.deepcopy(self.facts);altered['observed_neon_org_mfa_required']=True
        with self.assertRaises(ActivationDenied):assess(altered)

    def test_deny_self_approval_keys(self):
        altered=copy.deepcopy(self.facts);altered['builder_has_operator_admin_access']=False
        with self.assertRaises(ActivationDenied):assess(altered)

    def test_deny_modified_pr1_or_main(self):
        for key,val in (('main_commit','0'*40),('pr1_state','MERGED')):
            with self.subTest(key=key):
                altered=copy.deepcopy(self.facts);altered[key]=val
                with self.assertRaises(ActivationDenied):assess(altered)

    def test_deny_unsigned_source_handoff(self):
        for key in ('b27_commit','preflight_commit','charter_sha256'):
            with self.subTest(key=key):
                altered=copy.deepcopy(self.facts);altered[key]='0'*40
                with self.assertRaises(ActivationDenied):assess(altered)

    def test_manifest_tamper_fails_closed(self):
        base=Path(__file__).resolve().parents[1]
        verify_handoff(base)
        with self.assertRaises(ActivationDenied):verify_handoff(base,manifest_override='0'*64)

    def test_rejects_types_not_coerced(self):
        for key, val in (('observed_neon_org_mfa_required',0),('sole_administrator_count',True),('builder_has_operator_admin_access','yes')):
            with self.subTest(key=key):
                altered=copy.deepcopy(self.facts);altered[key]=val
                with self.assertRaises(ActivationDenied):assess(altered)

    def test_strict_code_refusal_of_output_mutation(self):
        verdict=assess(self.facts)
        verdict['production_authority']=True
        with self.assertRaises(ActivationDenied):assess(verdict)

if __name__=='__main__':unittest.main()
