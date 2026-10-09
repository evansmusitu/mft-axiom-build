import unittest
from zero_cost_policy import require_zero_cash_operation, ZeroCostDenied, SCHEMA


def req(**changes):
    value = {
        'schema':SCHEMA,
        'risk_class':'S0',
        'operation':'LOCAL_OFFLINE_TEST',
        'provider':'LOCAL',
        'project_scope':'TRACK_B_ISOLATED_NONPRODUCTION',
        'estimated_cash_cost_usd':'0.00',
        'may_incur_usage_charges':False,
        'uses_external_model':False,
        'external_mutation':False,
        'production_authority':False,
    }
    value.update(changes)
    return value

class ZeroCostContractTests(unittest.TestCase):
    def test_local_offline_work_admitted_with_no_external_authority(self):
        receipt=require_zero_cash_operation(req())
        self.assertEqual(receipt['cash_spend_limit_usd'],'0.00')
        self.assertFalse(receipt['cloud_provisioning_authorized'])
        self.assertFalse(receipt['external_model_inference_authorized'])
    def test_local_ephemeral_reversible_sandbox_admitted(self):
        self.assertEqual(require_zero_cash_operation(req(risk_class='S1',operation='LOCAL_EPHEMERAL_SANDBOX_TASK'))['state'],'LOCAL_ONLY_ALLOWED')
    def test_modal_create_blocked_even_with_claimed_zero_spend(self):
        with self.assertRaises(ZeroCostDenied):
            require_zero_cash_operation(req(risk_class='S3',operation='MODAL_SANDBOX_CREATE'))
    def test_paid_llm_calls_blocked_even_with_free_trial_label(self):
        for action in ('OPENAI_CHAT_COMPLETIONS','ANTHROPIC_MESSAGES_CREATE','MODAL_SHARED_ENDPOINT_CALL'):
            with self.subTest(action=action), self.assertRaises(ZeroCostDenied):
                require_zero_cash_operation(req(operation=action,estimated_cash_cost_usd='0'))
    def test_external_account_masked_as_local_denied(self):
        for provider in ('MODAL','OPENAI','GITHUB_ACTIONS_HOSTED','FREE_TRIAL','LOCAL+PAID'):
            with self.subTest(provider=provider), self.assertRaises(ZeroCostDenied):
                require_zero_cash_operation(req(provider=provider))
    def test_nonzero_and_nondecimal_costs_denied(self):
        for cost in ('0.01','-0.01','1','NaN','Infinity','invalid',None,0):
            with self.subTest(cost=cost), self.assertRaises(ZeroCostDenied):
                require_zero_cash_operation(req(estimated_cash_cost_usd=cost))
    def test_paid_fallback_and_external_mutations_denied(self):
        for field in ('may_incur_usage_charges','uses_external_model','external_mutation','production_authority'):
            with self.subTest(field=field), self.assertRaises(ZeroCostDenied):
                require_zero_cash_operation(req(**{field:True}))
    def test_boolean_not_accepted_in_place_of_false(self):
        with self.assertRaises(ZeroCostDenied):
            require_zero_cash_operation(req(may_incur_usage_charges=0))
    def test_unknown_fields_and_missing_fields_denied(self):
        with self.assertRaises(ZeroCostDenied):
            require_zero_cash_operation(req(surprise=True))
        a=req(); a.pop('provider')
        with self.assertRaises(ZeroCostDenied):
            require_zero_cash_operation(a)
    def test_wrong_scope_schema_and_s4_denied(self):
        for changes in ({'schema':'other'}, {'project_scope':'PRODUCTION'},
                        {'risk_class':'S4'},{'operation':'LOCAL_UNBOUNDED_SHELL'}):
            with self.subTest(changes=changes), self.assertRaises(ZeroCostDenied):
                require_zero_cash_operation(req(**changes))

if __name__=='__main__':unittest.main()
