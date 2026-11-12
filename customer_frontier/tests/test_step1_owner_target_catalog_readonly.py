"""No external requests, credentials, databases, or paid services required."""
import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'qualification'))
import step1_owner_target_catalog_readonly as m


def pg(items, page=1, total=None):
    if total is None:total=len(items)
    return {'success':True,'result':items,'result_info':{'page':page,'per_page':100,'count':len(items),'total_count':total}}


def row(uuid,name):return {'uuid':uuid,'name':name}

source=row(m.SOURCE,'axiom-idp-source')
reserved=row(m.RESERVED_OAUTH_DR,'axiom-oauth-dr-reserved')
normal=row('11111111-1111-1111-1111-111111111111','irrelevant-in-use')
sub={'success':True,'result':[{'rate_plan':{'name':'Workers Paid'},'state':'Paid'}]}

class TestTargetCatalog(unittest.TestCase):
    def test_current_synthetic_exact_list_receipt_is_partial_only(self):
        r=m.metadata_receipt([pg([source,reserved,normal])],{'success':True,'result':{'uuid':m.SOURCE}},sub,captured_at='2026-11-12T17:00:00Z')
        self.assertEqual(r['database_count'],3)
        self.assertTrue(r['proposed_target_name_absent'])
        self.assertTrue(r['database_quantity_within_published_included_band'])
        self.assertFalse(r['provider_zero_additional_spend_qualified'])
        self.assertFalse(r['approved_target_exists'])
        self.assertFalse(r['step1_closed'])
        self.assertEqual(r['release'],'NOT_RELEASE')
    def test_target_name_collision_denies(self):
        r=m.metadata_receipt([pg([source,reserved,row(normal['uuid'],m.PROPOSED_NAME)])],{'success':True,'result':{'uuid':m.SOURCE}},sub)
        self.assertEqual(r['status'],'TARGET_NAME_COLLISION_NO_GO')
        self.assertFalse(r['proposed_target_name_absent'])
    def test_absent_source_denies(self):
        with self.assertRaises(m.AuditNoGo):m.validate_full_catalog([pg([normal,reserved])])
    def test_absent_reserved_denies(self):
        with self.assertRaises(m.AuditNoGo):m.validate_full_catalog([pg([source,normal])])
    def test_duplicate_uuid_denies(self):
        with self.assertRaises(m.AuditNoGo):m.validate_full_catalog([pg([source,reserved,source])])
    def test_duplicate_name_denies(self):
        with self.assertRaises(m.AuditNoGo):m.validate_full_catalog([pg([source,reserved,row(normal['uuid'],source['name'])])])
    def test_count_inconsistency_denies(self):
        with self.assertRaises(m.AuditNoGo):m.validate_full_catalog([pg([source,reserved],total=3)])
    def test_inconsistent_page_number_denies(self):
        with self.assertRaises(m.AuditNoGo):m.validate_full_catalog([pg([source,reserved],page=2)])
    def test_boolean_count_denies(self):
        p=pg([source,reserved]);p['result_info']['total_count']=True
        with self.assertRaises(m.AuditNoGo):m.validate_full_catalog([p])
    def test_oversized_limit_denies(self):
        with self.assertRaises(m.AuditNoGo):m.validate_full_catalog([pg([source,reserved],total=9999)])
    def test_more_pages_required_denies_partial(self):
        # For 101 entries require second page with coherent monotone order.
        ids=[row(f'{i:08x}-1111-1111-1111-111111111111',f'other-{i}') for i in range(98)]
        first=[source,reserved]+ids
        with self.assertRaises(m.AuditNoGo):m.validate_full_catalog([pg(first,total=101)])
        second=[row('eeeeeeee-1111-1111-1111-111111111111','last')]
        self.assertEqual(m.validate_full_catalog([pg(first,total=101),pg(second,page=2,total=101)])['database_count'],101)
    def test_changed_total_across_pages_denies(self):
        ids=[row(f'{i:08x}-1111-1111-1111-111111111111',f'other-{i}') for i in range(98)]
        with self.assertRaises(m.AuditNoGo):m.validate_full_catalog([pg([source,reserved]+ids,total=101),pg([normal],page=2,total=102)])
    def test_unpaid_subscription_cannot_assert_included_allowance(self):
        no={'success':True,'result':[{'rate_plan':{'name':'Workers Paid'},'state':'Cancelled'}]}
        r=m.metadata_receipt([pg([source,reserved])],{'success':True,'result':{'uuid':m.SOURCE}},no)
        self.assertFalse(r['workers_paid_active'])
        self.assertFalse(r['database_quantity_within_published_included_band'])
    def test_source_detail_mismatch_denies(self):
        with self.assertRaises(m.AuditNoGo):m.metadata_receipt([pg([source,reserved])],{'success':True,'result':{'uuid':m.RESERVED_OAUTH_DR}},sub)
    def test_http_only_allowed_immutable_get_paths(self):
        for p in ('/d1/database','/d1/database/'+m.RESERVED_OAUTH_DR,'/d1/database?name=ignore','/d1/database?per_page=100&page=1'):
            with self.assertRaises(m.AuditNoGo):m.cloudflare_get('fake',p)
    def test_live_fixture_calls_only_whitelisted_get(self):
        calls=[]
        def fake(token,path):
            calls.append(path)
            if 'page=1' in path:return pg([source,reserved])
            if path.endswith(m.SOURCE):return {'success':True,'result':{'uuid':m.SOURCE}}
            if path=='/subscriptions':return sub
            raise AssertionError(path)
        r=m.audit_live('nonsecret-test',fake)
        self.assertEqual(len(calls),3)
        self.assertTrue(r['proposed_target_name_absent'])
        self.assertFalse(r['provider_zero_additional_spend_qualified'])

if __name__=='__main__':unittest.main()
