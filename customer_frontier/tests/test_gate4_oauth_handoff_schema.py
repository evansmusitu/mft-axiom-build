"""Independent SQLite migration/rollback checks. No hosted bindings or owner proof."""
import pathlib
import sqlite3
import unittest

SCHEMA = pathlib.Path(__file__).resolve().parents[2] / 'auth/oauth_session_handoff_candidate.sql'


def statements():
    pending = ''
    out = []
    for line in SCHEMA.read_text().splitlines(keepends=True):
        pending += line
        if sqlite3.complete_statement(pending):
            out.append(pending)
            pending = ''
    assert not pending.strip()
    return out


class HandoffMigrationTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.addCleanup(self.db.close)
        self.db.execute('CREATE TABLE customers(id TEXT PRIMARY KEY, secret_payload BLOB)')
        self.db.execute('INSERT INTO customers VALUES(?,?)', ('existing-uuid', b'preserve-customer-data'))
        self.db.commit()

    def apply(self):
        with self.db:
            for sql in statements():
                self.db.execute(sql)

    def test_new_namespace_preserves_existing_customer_data(self):
        before = self.db.execute('SELECT * FROM customers').fetchall()
        self.apply()
        self.assertEqual(self.db.execute('SELECT * FROM customers').fetchall(), before)
        tables = {r[0] for r in self.db.execute("SELECT name FROM sqlite_schema WHERE type='table'")}
        self.assertEqual(tables, {'customers', 'oauth_handoff_ownership_v1', 'oauth_session_handoffs_v1'})
        self.assertNotIn('IF NOT EXISTS', SCHEMA.read_text())

    def test_existing_namespace_collision_rolls_back_all_new_objects(self):
        self.db.execute('CREATE TABLE oauth_session_handoffs_v1(existing TEXT)')
        self.db.execute("INSERT INTO oauth_session_handoffs_v1 VALUES('retain-original')")
        self.db.commit()
        self.db.execute('BEGIN IMMEDIATE')
        with self.assertRaises(sqlite3.OperationalError):
            self.apply()
        self.assertIsNone(self.db.execute("SELECT name FROM sqlite_schema WHERE name='oauth_handoff_ownership_v1'").fetchone())
        self.assertEqual(self.db.execute('SELECT * FROM oauth_session_handoffs_v1').fetchall(), [('retain-original',)])
        self.assertEqual(self.db.execute('SELECT secret_payload FROM customers').fetchone()[0], b'preserve-customer-data')

    def test_reapplication_refuses_to_replace_trigger_bodies(self):
        self.apply()
        original = self.db.execute("SELECT name,sql FROM sqlite_schema ORDER BY name").fetchall()
        with self.assertRaises(sqlite3.OperationalError):
            self.apply()
        self.assertEqual(self.db.execute("SELECT name,sql FROM sqlite_schema ORDER BY name").fetchall(), original)

    def test_null_checks_and_terminal_policy_cannot_be_bypassed(self):
        self.apply()
        row = ('A' * 43, 'flow_' + 'B' * 32, 'a' * 64, 'b' * 64, 1000, 301000)
        self.db.execute('INSERT INTO oauth_session_handoffs_v1(id,flow_id,flow_sha256,browser_sha256,created_at_ms,expires_at_ms) VALUES(?,?,?,?,?,?)', row)
        self.db.commit()
        for sql in ["UPDATE oauth_session_handoffs_v1 SET status='consent'", "DELETE FROM oauth_session_handoffs_v1",
                    "INSERT OR REPLACE INTO oauth_session_handoffs_v1 SELECT * FROM oauth_session_handoffs_v1",
                    "UPDATE oauth_session_handoffs_v1 SET expires_at_ms=expires_at_ms+1"]:
            with self.assertRaises(sqlite3.IntegrityError):
                self.db.execute(sql)
        self.assertEqual(self.db.execute('SELECT status FROM oauth_session_handoffs_v1').fetchone()[0], 'requested')


if __name__ == '__main__':
    unittest.main()
