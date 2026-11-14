import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('fp', Path(__file__).parents[1] / 'recovery/step2_sql_memory_fingerprint_20261114.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class MemoryReplayTests(unittest.TestCase):
    def fp(self, script):
        return module.fingerprint(script.encode())

    def test_order_independent_and_duplicates_retained(self):
        a = self.fp("CREATE TABLE a(v); INSERT INTO a VALUES('x'),('y'),('x');")
        b = self.fp("CREATE TABLE a(v); INSERT INTO a VALUES('y'),('x'),('x');")
        c = self.fp("CREATE TABLE a(v); INSERT INTO a VALUES('y'),('x');")
        self.assertEqual(a, b)
        self.assertNotEqual(a['user_data_sha256'], c['user_data_sha256'])

    def test_large_integers_are_exact(self):
        a = self.fp('CREATE TABLE a(v); INSERT INTO a VALUES(9007199254740992);')
        b = self.fp('CREATE TABLE a(v); INSERT INTO a VALUES(9007199254740993);')
        self.assertNotEqual(a['user_data_sha256'], b['user_data_sha256'])

    def test_null_blob_text_and_float_have_distinct_hashes(self):
        values = ['NULL', "X'3132'", "'12'", '12', '12.0']
        hashes = {self.fp('CREATE TABLE a(v); INSERT INTO a VALUES(' + value + ');')['user_data_sha256'] for value in values}
        self.assertEqual(len(hashes), len(values))

    def test_sequence_state_preserved(self):
        a = self.fp('CREATE TABLE a(id INTEGER PRIMARY KEY AUTOINCREMENT); INSERT INTO a DEFAULT VALUES; DELETE FROM a;')
        b = self.fp('CREATE TABLE a(id INTEGER PRIMARY KEY AUTOINCREMENT);')
        self.assertNotEqual(a['user_data_sha256'], b['user_data_sha256'])

    def test_unicode_and_empty_strings(self):
        result = self.fp("CREATE TABLE a(v TEXT); INSERT INTO a VALUES(''),('Zimbabwe ✓');")
        self.assertEqual(result['total_rows'], 2)

    def test_catalog_difference_is_detected(self):
        a = self.fp('CREATE TABLE a(v TEXT);')
        b = self.fp('CREATE TABLE a(v BLOB);')
        self.assertNotEqual(a['catalog_sha256'], b['catalog_sha256'])

    def test_foreign_key_violation_denied(self):
        with self.assertRaises(Exception):
            self.fp('PRAGMA foreign_keys=OFF; CREATE TABLE a(id PRIMARY KEY); CREATE TABLE b(id REFERENCES a(id)); INSERT INTO b VALUES(99);')

    def test_file_and_unsafe_pragma_operations_denied(self):
        for sql in ["ATTACH ':memory:' AS other;", 'PRAGMA writable_schema=ON;', "SELECT load_extension('a');", "SELECT readfile('/etc/passwd');"]:
            with self.subTest(sql=sql), self.assertRaises(Exception):
                self.fp(sql)

    def test_limits_and_malformed_sql(self):
        for value in [b'', b'not valid sql', b'x' * (module.MAX_SQL + 1)]:
            with self.subTest(size=len(value)), self.assertRaises(Exception):
                module.fingerprint(value)


if __name__ == '__main__':
    unittest.main()
