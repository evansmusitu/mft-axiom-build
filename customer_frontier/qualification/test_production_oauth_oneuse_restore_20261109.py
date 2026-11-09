"""Credential-free isolated 9-Nov OAuth import/rollback contract tests."""
import unittest
import production_oauth_oneuse_restore_20261109 as m

def synthetic_sql():
    parts=["PRAGMA defer_foreign_keys=TRUE;"]
    for i in range(17):
        parts.append("CREATE TABLE t"+str(i)+" (id INTEGER PRIMARY KEY, v TEXT);")
    for i in range(15):
        parts.append("CREATE INDEX idx_"+str(i)+" ON t"+str(i)+"(v);")
    for i in range(4000):
        parts.append("INSERT INTO t0(id,v) VALUES("+str(i+1)+",'x');")
    return "\n".join(parts)

class OneUseRecoveryContract(unittest.TestCase):
    def test_source_production_mutation_never_admitted(self):
        with self.assertRaisesRegex(m.Stop,'PRODUCTION_MUTATION_PROHIBITED'):
            m.cf(m.SOURCE_ACCOUNT,m.SOURCE_DB,'import','POST','synthetic-token',{})
        with self.assertRaisesRegex(m.Stop,'PRODUCTION_MUTATION_PROHIBITED'):
            m.cf(m.SOURCE_ACCOUNT,m.SOURCE_DB,'restore','POST','synthetic-token',{'bookmark':'0'*36})

    def test_other_database_denied_before_transport(self):
        with self.assertRaisesRegex(m.Stop,'CROSS_ACCOUNT_DATABASE_REJECTED'):
            m.cf(m.TARGET_ACCOUNT,m.SOURCE_DB,'meta','GET','token')
        with self.assertRaisesRegex(m.Stop,'CROSS_ACCOUNT_DATABASE_REJECTED'):
            m.cf(m.SOURCE_ACCOUNT,m.TARGET_DB,'meta','GET','token')

    def test_unsigned_urls_and_redirect_hostnames_denied(self):
        for url in ('http://example.com','https://example.com/export','https://cloudflare.com.evil.com/file',
                    'https://bad-r2.cloudflarestorage.com.evil.org/file','https://user:pw@example.cloudflare.com/file'):
            with self.subTest(url=url):
                with self.assertRaises(m.Stop):
                    m.validate_signed(url)
        self.assertEqual(m.validate_signed('https://example.r2.cloudflarestorage.com/object'),
                         'https://example.r2.cloudflarestorage.com/object')

    def test_unknown_sql_denied_even_with_fake_sql(self):
        with self.assertRaisesRegex(m.Stop,'UNKNOWN_SOURCE_DUMP_STATEMENT'):
            m.reorder('DELETE FROM customers;\n')
        with self.assertRaisesRegex(m.Stop,'SOURCE_SQL_CLASSES_DRIFT'):
            m.reorder('CREATE TABLE x(id INTEGER);\n')

    def test_known_synthetic_sql_reordered_and_parses_memory(self):
        ordered,c=m.reorder(synthetic_sql())
        self.assertEqual(c,{'PRAGMA':1,'TABLE':17,'INDEX':15,'INSERT':4000,'TRIGGER':0})
        state=m.memory_parity(ordered)
        self.assertEqual(state['total_rows'],4000)
        self.assertEqual(state['table_count'],17)
        self.assertEqual(state['index_count'],15)
        self.assertTrue(state['integrity_ok'])
        self.assertEqual(state['foreign_key_violations'],0)

    def test_exact_source_and_target_are_distinct_and_pinned(self):
        self.assertNotEqual(m.SOURCE_ACCOUNT,m.TARGET_ACCOUNT)
        self.assertNotEqual(m.SOURCE_DB,m.TARGET_DB)
        self.assertEqual(m.TARGET_DB,'c023a0a0-472a-4178-ad07-02f1d6b2e122')
        self.assertEqual(m.CURRENT_SQL_SHA,'22f770cbdf551eda71a9c3005450809ea266d23f577a053ba9c7b26da116e0be')
        self.assertNotEqual(m.CURRENT_SQL_SHA,m.ORIGINAL_8NOV_SQL_SHA)

    def test_bookmark_rejects_unsafe_input(self):
        self.assertIsNone(m.BOOKMARK.fullmatch('https://example.com'))
        self.assertIsNone(m.BOOKMARK.fullmatch('a'*128))

    def test_value_digest_binary_null_text_numeric_stability(self):
        self.assertEqual(m.value_repr(None),['null'])
        self.assertEqual(m.value_repr(b'\x00'),['b','AA=='])
        self.assertEqual(m.value_repr(-2),['i','-2'])
        self.assertEqual(m.value_repr(0.5),['f','0x1.0000000000000p-1'])

if __name__=='__main__':
    unittest.main()
