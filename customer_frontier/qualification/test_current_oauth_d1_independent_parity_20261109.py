"""Credential-free denial and immutability tests for independent hosted OAuth parity observer."""
import inspect,unittest
import current_oauth_d1_independent_parity_20261109 as o
class ParityReadOnlyTests(unittest.TestCase):
    def test_exact_accounts_and_dbs_are_distinct(self):
        self.assertNotEqual(o.ACCOUNT_SOURCE,o.ACCOUNT_TARGET)
        self.assertNotEqual(o.SOURCE,o.TARGET)
        self.assertEqual(o.SOURCE,'504029cc-f9a5-495e-818f-63c6144b4ea4')
        self.assertEqual(o.TARGET,'c023a0a0-472a-4178-ad07-02f1d6b2e122')
    def test_other_resource_fails_before_token(self):
        with self.assertRaises(o.Reject):
            o.transport(o.ACCOUNT_SOURCE,o.TARGET,'metadata')
        with self.assertRaises(o.Reject):
            o.transport(o.ACCOUNT_TARGET,o.SOURCE,'metadata')
    def test_write_sql_and_methods_denied(self):
        for sql in ['DELETE FROM oauth','INSERT INTO oauth VALUES (1)',"PRAGMA writable_schema=ON"]:
            with self.subTest(sql=sql),self.assertRaises(o.Reject):
                o.transport(o.ACCOUNT_TARGET,o.TARGET,'query',sql)
        with self.assertRaises(o.Reject):
            o.transport(o.ACCOUNT_TARGET,o.TARGET,'restore')
    def test_deterministic_json_hashes(self):
        values=[{'b':2,'a':3},{'a':1,'b':'private mock'}]
        self.assertEqual(o.canonical(values),o.canonical(values))
        self.assertEqual(o.sha(o.canonical(values)),o.sha(o.canonical(values)))
    def test_no_export_import_ddl_or_mutation_path(self):
        source=inspect.getsource(o)
        self.assertNotIn("'/import'",source)
        self.assertNotIn("'/export'",source)
        self.assertNotIn("'/time_travel/restore'",source)
        self.assertIn("method='POST'",source)
        self.assertIn("SELECT * FROM",source)
        self.assertIn("customer_row_values_persisted':False",source)
if __name__=='__main__':unittest.main()
