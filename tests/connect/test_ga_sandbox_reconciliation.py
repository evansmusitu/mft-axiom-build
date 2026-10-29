"""No provider-supplied export may silently activate Connect paid entitlements."""
import copy
import unittest
from qualification.reconcile_connect_ga_sandbox import assess

REF = 'a'*64
REF2 = 'b'*64

def paid_case():
    return {
        'schema':'musitu.connect.ga_paynow_sandbox_reconcile.v1',
        'mode':'PAYNOW_TEST_MODE',
        'provider':[{'reference_sha256':REF,'status':'paid','amount_cents':1900,'currency':'USD'}],
        'intents':[{'reference_sha256':REF,'status':'paid','amount_cents':1900,'currency':'USD'}],
        'invoices':[{'reference_sha256':REF,'status':'issued','amount_cents':1900,'currency':'USD'}],
        'refunds':[],
        'entitlements':[{'reference_sha256':REF,'active':True}],
    }

class SandboxFinanceContractTests(unittest.TestCase):
    def test_paid_reconciled_does_not_become_finance_or_ga_approval(self):
        result=assess(paid_case())
        self.assertEqual(result['status'],'OFFLINE_CONSISTENT_NOT_FINANCE_CERTIFIED')
        self.assertEqual(result['mismatch_categories'],[])
        for key in ('provider_original_authenticated','finance_independently_approved',
                    'commercial_ga_qualified','customer_admission','real_money_moved'):
            self.assertIs(result[key],False)
        self.assertNotIn(REF,str(result))
        self.assertEqual(result['items_checked'],1)

    def test_refund_and_cancel_do_not_leave_paid_entitlements(self):
        case=paid_case()
        case['provider'][0]['status']='refunded'
        case['intents'][0]['status']='refunded'
        case['invoices'][0]['status']='credited'
        case['refunds']=[{'reference_sha256':REF,'status':'processed','amount_cents':1900,'currency':'USD'}]
        case['entitlements'][0]['active']=False
        self.assertEqual(assess(case)['mismatch_categories'],[])
        case['entitlements'][0]['active']=True
        self.assertIn('ENTITLEMENT_CONFLICT',assess(case)['mismatch_categories'])
        case=paid_case()
        case['provider'][0]['status']='cancelled'
        case['intents'][0]['status']='cancelled'
        case['invoices']=[]
        case['entitlements'][0]['active']=False
        self.assertEqual(assess(case)['mismatch_categories'],[])
        case['entitlements'][0]['active']=True
        self.assertIn('ENTITLEMENT_CONFLICT',assess(case)['mismatch_categories'])

    def test_detect_duplicate_provider_and_wrong_amount_or_invoice(self):
        case=paid_case()
        case['provider'].append(copy.deepcopy(case['provider'][0]))
        self.assertIn('DUPLICATE_PROVIDER_REFERENCE',assess(case)['mismatch_categories'])
        case=paid_case()
        case['provider'][0]['amount_cents']=1800
        self.assertIn('AMOUNT_OR_CURRENCY_CONFLICT',assess(case)['mismatch_categories'])
        case=paid_case()
        case['invoices']=[]
        self.assertIn('INVOICE_CONFLICT',assess(case)['mismatch_categories'])
        case=paid_case()
        case['provider'].append({'reference_sha256':REF2,'status':'paid','amount_cents':1900,'currency':'USD'})
        self.assertIn('MISSING_INTENT',assess(case)['mismatch_categories'])

    def test_invalid_input_is_fail_closed_not_claimed_finance_certification(self):
        case=paid_case()
        case['mode']='LIVE_FUNDS'
        self.assertEqual(assess(case)['status'],'OFFLINE_INPUT_REJECTED')
        case=paid_case()
        case['provider'][0]['reference_sha256']='raw_paynow_number'
        self.assertEqual(assess(case)['status'],'OFFLINE_INPUT_REJECTED')
        case=paid_case()
        case['provider'][0]['amount_cents']=True
        self.assertEqual(assess(case)['status'],'OFFLINE_INPUT_REJECTED')
        case=paid_case()
        case['other_secret']='SYNTHETIC_SECRET'
        result=assess(case)
        self.assertEqual(result['status'],'OFFLINE_INPUT_REJECTED')
        self.assertNotIn('SYNTHETIC_SECRET',str(result))

if __name__ == '__main__':
    unittest.main()
