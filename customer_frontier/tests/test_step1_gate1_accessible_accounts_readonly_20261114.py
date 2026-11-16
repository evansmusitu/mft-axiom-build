"""Synthetic-only Cloudflare account catalog metadata tests."""
import importlib.util,pathlib,unittest
from datetime import datetime,timezone
file=pathlib.Path(__file__).resolve().parents[1]/'qualification'/'step1_gate1_accessible_accounts_readonly_20261114.py'
spec=importlib.util.spec_from_file_location('accounts',file)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
NOW=datetime(2026,11,14,tzinfo=timezone.utc)
SRC=m.SOURCE
ID='a'*32

def page(ids,n=1,total=None):
    return {'success':True,'result':[{'id':i,'name':'SENSITIVE NAME SHOULD NEVER ESCAPE'} for i in ids],
        'result_info':{'page':n,'per_page':50,'count':len(ids),'total_count':len(ids) if total is None else total}}

class Catalog(unittest.TestCase):
    def go(self,documents):
        def get(t,p):
            assert t=='synthetic-token'
            n=int(p.split('page=')[1].split('&')[0])
            return documents[n-1]
        return m.audit(get=get,token='synthetic-token',now=NOW)
    def test_only_original_no_other_candidates(self):
        r=self.go([page([SRC])]);self.assertTrue(r['account_list_qualified']);self.assertEqual(r['other_accessible_accounts_count'],0)
    def test_one_other_not_proven_free(self):
        r=self.go([page([SRC,ID])]);self.assertEqual(r['other_accessible_accounts_count'],1)
        self.assertFalse(r['other_accounts_free_plan_proven']);self.assertFalse(r['new_free_target_selected'])
    def test_no_raw_other_id_or_names_in_receipt(self):
        import json
        s=json.dumps(self.go([page([SRC,ID])]));self.assertNotIn(ID,s);self.assertNotIn('SENSITIVE NAME',s)
    def test_source_missing_does_not_infer_source_permitted(self):
        r=self.go([page([ID])]);self.assertFalse(r['original_account_accessible']);self.assertFalse(r['gate1_closed'])
    def test_duplicate_account_rejected(self):
        self.assertFalse(self.go([page([SRC,SRC])])['account_list_qualified'])
    def test_missing_pagination_rejected(self):
        self.assertFalse(self.go([{'success':True,'result':[{'id':SRC}]}])['account_list_qualified'])
    def test_failed_envelope_rejected(self):
        self.assertFalse(self.go([{'success':False,'result':[]}])['account_list_qualified'])
    def test_invalid_uuid_rejected(self):
        self.assertFalse(self.go([page(['X'*32])])['account_list_qualified'])
    def test_count_mismatch_rejected(self):
        self.assertFalse(self.go([page([SRC],total=2)])['account_list_qualified'])
    def test_second_page_pagination(self):
        ids=['%032x'%i for i in range(1,51)]
        ids[0]=SRC
        r=self.go([page(ids,1,51),page([ID],2,51)])
        self.assertTrue(r['account_list_qualified']);self.assertEqual(r['account_catalog_total'],51)
    def test_200_replies_never_authorize_changes(self):
        r=self.go([page([SRC,ID])]);self.assertFalse(r['gate1_closed']);self.assertFalse(r['release_authorized']);self.assertEqual(r['provider_mutations'],0)
    def test_empty_provider_account_page_no_go(self):
        self.assertFalse(self.go([page([])])['account_list_qualified'])
    def test_missing_secret_no_go(self):
        with self.assertRaisesRegex(m.NoGo,'TOKEN_NOT_AVAILABLE'):m.getter('','/accounts?page=1&per_page=50')
    def test_only_get_allowlist(self):
        with self.assertRaisesRegex(m.NoGo,'ONLY_PAGINATED_GET'):m.getter('synthetic-token','/accounts')

if __name__=='__main__':unittest.main()
