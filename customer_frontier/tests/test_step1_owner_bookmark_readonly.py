import unittest
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
import hashlib
import json
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'qualification'))
import step1_owner_bookmark_readonly as m

SRC={'success':True,'result':{'uuid':m.SOURCE,'name':'source-db'}}
BKM={'success':True,'result':{'bookmark':'00000000-abcd0123-ef0123456789abcdf0123456'}}
class Tests(unittest.TestCase):
    def test_exact_source_and_bookmark_hash_only(self):
        r=m.receipt_for(SRC,BKM,'2026-11-12T20:00:00Z')
        self.assertEqual(r['status'],'SOURCE_BOOKMARK_HASH_OBSERVED_NOT_BACKUP_NO_GO')
        self.assertEqual(r['bookmark_sha256'],hashlib.sha256(BKM['result']['bookmark'].encode()).hexdigest())
        self.assertTrue(r['source_detail_matched'])
        self.assertNotIn(BKM['result']['bookmark'],json.dumps(r))
        self.assertFalse(r['real_sql_backup_qualified'])
        self.assertFalse(r['step_1_closed'])
    def test_production_source_uuid_mismatch_denies(self):
        r=m.receipt_for({'success':True,'result':{'uuid':'wrong','name':'source-db'}},BKM,'now')
        self.assertEqual(r['sanitized_error_code'],'SOURCE_DETAIL_UUID_MISMATCH')
    def test_missing_source_denies(self):
        self.assertEqual(m.receipt_for(None,BKM,'now')['sanitized_error_code'],'SOURCE_DETAIL_NOT_AUTHENTICATED')
    def test_false_success_denies(self):
        self.assertEqual(m.receipt_for({'success':False,'result':SRC['result']},BKM,'now')['sanitized_error_code'],'SOURCE_DETAIL_NOT_AUTHENTICATED')
    def test_missing_bookmark_denies(self):
        self.assertEqual(m.receipt_for(SRC,{'success':True,'result':{}},'now')['sanitized_error_code'],'BOOKMARK_FORMAT_UNQUALIFIED')
    def test_invalid_bookmark_denies(self):
        for value in ['','a'*500,'<secret>','aaa\nbbb','abc def',4,None]:
            with self.subTest(value=value):
                self.assertEqual(m.receipt_for(SRC,{'success':True,'result':{'bookmark':value}},'now')['sanitized_error_code'],'BOOKMARK_FORMAT_UNQUALIFIED')
    def test_more_than_one_step_not_authorized(self):
        r=m.receipt_for(SRC,BKM,'now')
        for k in ['real_sql_backup_qualified','hosted_restore_qualified','zero_additional_spend_qualified','owner_key_custody_qualified','step_1_closed','step_2_authorized']:
            self.assertIs(r[k],False)
        self.assertEqual(r['release'],'NOT_RELEASE')
    def test_http_allowlist_enforced_before_network(self):
        with self.assertRaisesRegex(m.NoGo,'UNREVIEWED_URL'):
            m.get_doc(m.BASE+'/time_travel/restore','bad')
    def test_unqualified_token_denied_before_network(self):
        with self.assertRaisesRegex(m.NoGo,'TOKEN_UNAVAILABLE'):
            m.get_doc(m.BASE,'bad')
    def test_oversized_and_malformed_json_deny(self):
        with self.assertRaisesRegex(m.NoGo,'OVERSIZE_RESPONSE'):
            m._untrusted_json_doc(b'a'*100001)
        with self.assertRaisesRegex(m.NoGo,'INVALID_RESPONSE_JSON'):
            m._untrusted_json_doc(b'no-json')
    def test_receipt_sha256(self):
        with TemporaryDirectory() as tmp:
            r=m.receipt_for(SRC,BKM,'now')
            m.write_receipt(r,Path(tmp))
            body=(Path(tmp)/m.OUTPUT).read_bytes()
            sha=(Path(tmp)/(m.OUTPUT+'.sha256')).read_text().split()[0]
            self.assertEqual(sha,hashlib.sha256(body).hexdigest())
            self.assertNotIn(BKM['result']['bookmark'].encode(),body)

if __name__=='__main__':unittest.main()
