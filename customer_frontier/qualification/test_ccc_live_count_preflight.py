import hashlib
import json
import unittest
import ccc_live_count_preflight as m


def synth_rows():
    rows=[]
    for i in range(25):
        name=f'test_user_table_{i:02d}'
        rows.append(dict(type='table', name=name,tbl_name=name,sql=f'CREATE TABLE {name}(id INT)'))
    rows.append(dict(type='table',name='_cf_KV',tbl_name='_cf_KV',sql='CREATE TABLE _cf_KV(k TEXT)'))
    for i in range(13):
        name=f'test_index_{i:02d}'
        rows.append(dict(type='index',name=name,tbl_name=f'test_user_table_{i:02d}',sql=f'CREATE INDEX {name} ON test_user_table_{i:02d}(id)'))
    for i in range(39):
        name=f'test_trigger_{i:02d}'
        rows.append(dict(type='trigger',name=name,tbl_name=f'test_user_table_{i%25:02d}',sql=f'CREATE TRIGGER {name} AFTER INSERT ON test_user_table_{i%25:02d} BEGIN SELECT 1; END'))
    return sorted(rows,key=lambda o:(o['type'],o['name']))


def provider(rows=None,counts=None,meta_override=None,altered_catalog=False):
    rows=synth_rows() if rows is None else rows
    counts={f'test_user_table_{i:02d}':1 for i in range(25)} if counts is None else counts
    seen=[]
    def fetch(kind,sql=None):
        seen.append((kind,sql))
        if kind=='metadata':
            return {'uuid':m.DB,'name':'TEST_STAGING_NAME','file_size':100000}
        if kind=='query':
            meta={'changed_db':False,'changes':0,'rows_written':0}
            if meta_override: meta.update(meta_override)
            if sql==m.CATALOG_SQL:
                result=rows if not altered_catalog else rows[:-1]
            else:
                import re
                n=re.fullmatch(r'SELECT count\(\*\) AS n FROM "([A-Za-z0-9_]+)"',sql)
                if not n:raise AssertionError('arbitrary query')
                result=[{'n':counts.get(n.group(1),0)}]
            return [{'success':True,'meta':meta,'results':result}]
        raise AssertionError('arbitrary request')
    return fetch,seen

class HostedCounts(unittest.TestCase):
    def setUp(self):
        self.orig=(m.CATALOG_SHA,m.NAME_SHA)
        m.CATALOG_SHA=m.sha(m.canonical(synth_rows()))
        m.NAME_SHA=m.sha('TEST_STAGING_NAME')

    def tearDown(self):
        m.CATALOG_SHA,m.NAME_SHA=self.orig

    def test_reads_exact_25_counts_zero_writes_without_row_values(self):
        fetch,seen=provider()
        result=m.observe(fetch)
        self.assertEqual(result['status'],'AGGREGATE_COUNT_PARITY_ONLY')
        self.assertEqual(result['user_table_count'],25)
        self.assertEqual(result['user_rows_total'],25)
        self.assertEqual(result['query_count'],26)
        self.assertEqual(result['query_zero_writes_confirmed'],26)
        self.assertEqual(result['provider_query_mutations'],0)
        self.assertFalse(result['full_restore_qualified'])
        self.assertFalse(result['release_authority'])
        self.assertNotIn('test_user_table',json.dumps(result))
        self.assertEqual(len(seen),27)
        self.assertEqual(seen[1],('query',m.CATALOG_SQL))

    def test_refuses_catalog_drift_before_user_counts(self):
        fetch,seen=provider(altered_catalog=True)
        with self.assertRaisesRegex(m.ObservationRejected,'CATALOG_DRIFT'): m.observe(fetch)
        self.assertEqual(len(seen),2)

    def test_refuses_write_metadata_before_any_row_count(self):
        for meta in ({'changed_db':True},{'changes':1},{'rows_written':None}):
            fetch,seen=provider(meta_override=meta)
            with self.assertRaisesRegex(m.ObservationRejected,'ZERO_WRITE_COUNTERS_UNCONFIRMED'):m.observe(fetch)
            self.assertEqual(len(seen),2)

    def test_refuses_mismatch_row_count_and_unknown_table_name(self):
        for counts in ({'test_user_table_00':2}, {'test_user_table_01':-1}):
            fetch,seen=provider(counts=counts)
            with self.assertRaises(m.ObservationRejected):m.observe(fetch)
        rows=synth_rows()
        next(row for row in rows if row['type']=='table' and row['name']!='_cf_KV')['name']='unsafe"; DROP TABLE users; --'
        m.CATALOG_SHA=m.sha(m.canonical(rows))
        fetch,seen=provider(rows=rows)
        with self.assertRaisesRegex(m.ObservationRejected,'UNSAFE_USER_TABLE_IDENTIFIER'):m.observe(fetch)
        self.assertEqual(len(seen),2)

    def test_does_not_elevate_to_data_equivalence(self):
        fetch,_=provider()
        r=m.observe(fetch)
        self.assertIs(r['user_row_contents_compared'],False)
        self.assertIs(r['identity_qualified'],False)
        self.assertIs(r['production_oauth_changed'],False)

if __name__=='__main__':unittest.main()
