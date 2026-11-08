import copy
import hashlib
import json
import unittest
import oauth_identity_links_20261108 as m

def fake_catalog():
    rows = [{'type': 'table', 'name': f'test_{i:02d}', 'tbl_name': f'test_{i:02d}', 'sql': f'CREATE TABLE test_{i:02d}(id TEXT)'} for i in range(33)]
    return rows

def fake_transport(counters=None, query_meta=None, bound=True, catalog=None):
    calls=[]
    catalog=catalog if catalog is not None else fake_catalog()
    counters={name:0 for name in m.FIELDS} if counters is None else counters
    def fetch(kind):
        calls.append(kind)
        if kind=='binding':
            return {'bindings': [{'type': 'd1', 'name':'AXIOM_DB','id':m.DATABASE if bound else 'wrong'}]}
        if kind=='metadata':
            return {'uuid':m.DATABASE, 'name':'musitu-axiom-prod'}
        meta={'changed_db':False,'changes':0,'rows_written':0}
        if query_meta:meta.update(query_meta)
        if kind=='catalog':
            return {'meta':meta,'results':catalog}
        if kind=='relationships':
            return {'meta':meta,'results':[counters]}
        raise AssertionError(f'unadmitted request: {kind}')
    return fetch,calls

class IdentityEvidence(unittest.TestCase):
    def setUp(self):
        self.oldhash=m.CATALOG_SHA
        m.CATALOG_SHA=hashlib.sha256(json.dumps(fake_catalog(),ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
    def tearDown(self):
        m.CATALOG_SHA=self.oldhash

    def test_zero_reference_counters_maintains_no_customer_auth_claim(self):
        fetch,calls=fake_transport()
        r=m.observe(fetch)
        self.assertEqual(r['status'],'STRUCTURAL_LINK_COUNTERS_ZERO_NOT_REAL_IDENTITY')
        self.assertEqual(calls,['binding','metadata','catalog','relationships'])
        self.assertEqual(r['catalog_objects'],33)
        self.assertEqual(r['provider_zero_write_queries'],2)
        self.assertFalse(r['real_identity_qualified'])
        self.assertFalse(r['production_oauth_migration_qualified'])
        self.assertFalse(r['release_authority'])
        self.assertNotIn('test_00',json.dumps(r))

    def test_nonzero_counter_never_qualifies(self):
        counters={k:0 for k in m.FIELDS}
        counters['orphan_identity_claims']=1
        f,c=fake_transport(counters)
        r=m.observe(f)
        self.assertEqual(r['status'],'STRUCTURAL_LINK_INCONSISTENCY_OBSERVED')
        self.assertFalse(r['real_identity_qualified'])

    def test_missing_or_unexpected_production_binding_blocks_queries(self):
        f,c=fake_transport(bound=False)
        with self.assertRaisesRegex(m.Rejected,'OAUTH_D1_BINDING_DRIFT'):m.observe(f)
        self.assertEqual(c,['binding'])

    def test_catalog_drift_refuses_second_query(self):
        f,c=fake_transport(catalog=fake_catalog()[:-1])
        with self.assertRaisesRegex(m.Rejected,'PRODUCTION_CATALOG_DRIFT'):m.observe(f)
        self.assertEqual(c,['binding','metadata','catalog'])

    def test_false_write_attestation_refuses_result(self):
        for changed in ({'changed_db':True},{'rows_written':1},{'changes':1},{'rows_written':None}):
            f,c=fake_transport(query_meta=changed)
            with self.assertRaisesRegex(m.Rejected,'SELECT_ZERO_WRITE_NOT_CONFIRMED'):m.observe(f)
            self.assertEqual(c,['binding','metadata','catalog'])

    def test_negative_or_extra_fields_refused(self):
        for fields in ({'orphan_identity_claims':-1},{'unknown':0}):
            f,c=fake_transport(counters=fields)
            with self.assertRaisesRegex(m.Rejected,'RELATIONSHIP_COUNTERS_INVALID'):m.observe(f)

    def test_queries_fixed_and_no_key_or_row_extraction(self):
        self.assertIn('COUNT(*)',m.LINKS_SQL.upper())
        self.assertNotIn('SELECT *',m.LINKS_SQL.upper())
        self.assertNotIn('DROP TABLE',m.LINKS_SQL.upper())
        self.assertNotIn('DELETE FROM',m.LINKS_SQL.upper())
        self.assertNotIn('oauth_oidc_signing_keys',m.LINKS_SQL)

if __name__=='__main__':unittest.main()
