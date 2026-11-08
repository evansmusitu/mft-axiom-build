import unittest
import independent_d1_restore_observer_20261108 as m

def fixture():
    rows=[]
    for i in range(25):
        name='synthetic_table_%02d'%i
        rows.append({'name':name,'type':'table','tbl_name':name,'sql':'CREATE TABLE '+name+'(id INT)'})
    for i in range(13):
        rows.append({'name':'synthetic_index_%02d'%i,'type':'index','tbl_name':'synthetic_table_%02d'%i,'sql':'CREATE INDEX'})
    for i in range(39):
        rows.append({'name':'synthetic_trigger_%02d'%i,'type':'trigger','tbl_name':'synthetic_table_%02d'%(i%25),'sql':'CREATE TRIGGER'})
    rows.append({'name':'_cf_KV','type':'table','tbl_name':'_cf_KV','sql':'CREATE TABLE _cf_KV(k TEXT)'})
    return sorted(rows,key=lambda r:(r['type'],r['name']))

class IndependentObservations(unittest.TestCase):
    def setUp(self):
        self.original=m.transport,m.SRC_SCHEMA_SHA,m.nrequests
        self.schema=fixture()
        m.SRC_SCHEMA_SHA=m.sha(m.canonical(self.schema))
        self.changed=None;self.fk_error=False
        def stub(account,db,kind,sql=None):
            m.nrequests+=1
            if kind=='metadata':
                return {'uuid':db,'name':m.TARGET_NAME if db==m.TARGET else 'source'}
            if sql==m.CATALOG:return self.schema
            if sql=='SELECT count(*) AS n FROM pragma_foreign_key_check':
                return [{'n':1 if self.fk_error and db==m.TARGET else 0}]
            if sql.startswith('SELECT * FROM "synthetic_table_'):
                return [{'value':('changed' if self.changed and db==m.TARGET else 'same')}]
            raise AssertionError('unexpected query')
        m.transport=stub;m.nrequests=0
    def tearDown(self):
        m.transport,m.SRC_SCHEMA_SHA,m.nrequests=self.original

    def test_independent_readonly_fingerprint_parity_and_no_release(self):
        r=m.compare()
        self.assertEqual(r['status'],'INDEPENDENT_HOSTED_SCHEMA_AND_DATA_PARITY_PASS')
        self.assertEqual(r['user_tables_equal'],25)
        self.assertTrue(r['source_target_data_identical'])
        self.assertTrue(r['foreign_key_checks_pass'])
        self.assertFalse(r['destructive_recovery_qualified'])
        self.assertFalse(r['release_authority'])
        self.assertEqual(m.nrequests,56)
        self.assertNotIn('synthetic_table',m.canonical(r))

    def test_rejects_row_content_changes(self):
        self.changed=True
        with self.assertRaisesRegex(m.Reject,'DATA_CONTENT_HASH_MISMATCH'):m.compare()

    def test_rejects_fk_violations(self):
        self.fk_error=True
        with self.assertRaisesRegex(m.Reject,'FOREIGN_KEY_CHECK_FAILED'):m.compare()

    def test_rejects_unapproved_schema(self):
        self.schema[0]['name']='unexpected_modified'
        with self.assertRaisesRegex(m.Reject,'SOURCE_CATALOG_DRIFT'):m.compare()

    def test_prevents_target_resource_ambiguity(self):
        self.assertNotEqual(m.ACCOUNT_SOURCE,m.ACCOUNT_TARGET)
        self.assertNotEqual(m.SOURCE,m.TARGET)
        self.assertEqual(m.SRC_SCHEMA_SHA,m.sha(m.canonical(self.schema)))

if __name__=='__main__':unittest.main()
