"""Exercise D1 migration SQL offline against SQLite; no HTTP calls or keys."""
import sqlite3
import unittest

from frontier_v5.runtime.fabric import FrontierError
from frontier_v5.runtime.fullstack_base import CloudflareD1ProductionStore


class OfflineSQLD1(CloudflareD1ProductionStore):
    def __init__(self):
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        self.statements = []

    def query(self, sql, params=None):
        self.statements.append(sql)
        cursor = self.db.execute(sql, params or [])
        result = [dict(row) for row in cursor.fetchall()] if cursor.description else []
        self.db.commit()
        return result


class D1MemorySchema(unittest.TestCase):
    def test_fresh_schema_accepts_identical_fact_in_distinct_tenants(self):
        store = OfflineSQLD1()
        try:
            store.migrate()
            for tenant in ['A', 'B']:
                store.query('INSERT INTO frontier_memory VALUES(?,?,?,?,?,?)', [tenant, 'public', 'fact', 'same-record', '{}', '2026-10-29T00:00:00Z'])
            self.assertEqual(store.query('SELECT count(*) AS n FROM frontier_memory')[0]['n'], 2)
            with self.assertRaises(sqlite3.IntegrityError):
                store.query('INSERT INTO frontier_memory VALUES(?,?,?,?,?,?)', ['A', 'public', 'fact', 'same-record', '{}', '2026-10-29T00:00:00Z'])
        finally:
            store.db.close()

    def test_legacy_schema_requires_explicit_migration_and_preserves_rows(self):
        store = OfflineSQLD1()
        try:
            store.query('CREATE TABLE frontier_memory(tenant TEXT,namespace TEXT,k TEXT,record_id TEXT PRIMARY KEY,payload_json TEXT,observed_at TEXT)')
            store.query("INSERT INTO frontier_memory VALUES('A','public','fact','original','{}','2026-10-29T00:00:00Z')")
            with self.assertRaisesRegex(FrontierError, 'explicit tenant-scoped legacy migration'):
                store.migrate()
            self.assertEqual(store.query('SELECT record_id FROM frontier_memory'), [{'record_id':'original'}])
            self.assertFalse(any(sql.startswith('DROP') or sql.startswith('ALTER') for sql in store.statements))
            self.assertEqual(store.query("SELECT name FROM sqlite_master WHERE name='frontier_twins'"), [])
        finally:
            store.db.close()


if __name__ == '__main__':
    unittest.main()
