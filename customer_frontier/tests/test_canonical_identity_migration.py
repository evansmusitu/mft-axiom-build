"""Offline SQLite migration evidence only: no D1/provider access or customer data."""
import pathlib, sqlite3, unittest

ROOT = pathlib.Path(__file__).resolve().parents[1] / 'customer_control_plane'

class CanonicalMigration(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.schema = (ROOT / 'schema.sql').read_text()
        self.migration = (ROOT / 'canonical_identity.sql').read_text()
        self.prior, appended = self.schema.split('-- Canonical identity migration (must remain byte-identical to canonical_identity.sql).\n')
        self.assertEqual(appended, self.migration)
        self.db.executescript(self.prior)
        self.db.executescript("INSERT INTO tenants(id,name) VALUES('t','Old tenant'); INSERT INTO identities(id,issuer,external_sub) VALUES('i','https://id.test','old'); INSERT INTO memberships(tenant_id,identity_id,role) VALUES('t','i','viewer');")

    def tearDown(self):
        self.db.close()

    def test_upgrade_is_additive_and_never_autolinks_legacy_rows(self):
        self.db.executescript(self.migration)
        self.db.executescript(self.migration)
        self.assertEqual(self.db.execute('SELECT count(*) FROM canonical_customer_links').fetchone()[0], 0)
        self.assertEqual(self.db.execute('SELECT role FROM memberships').fetchone()[0], 'viewer')
        self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(), [])
        self.assertIsNone(self.db.execute("SELECT name FROM sqlite_master WHERE name='customers'").fetchone())

    def test_null_identity_and_cross_tenant_link_are_rejected(self):
        self.db.executescript(self.migration)
        for identity, tenant in [(None, 't'), ('i', 'other')]:
            with self.assertRaises(sqlite3.IntegrityError):
                self.db.execute("INSERT INTO canonical_customer_links(identity_id,tenant_id,customer_id,link_kind,proof_id,proof_sha256,consent_id,authority_subject) VALUES(?,?,?,'legacy','proof',?,'consent','authority')", (identity, tenant, 'existing-customer', '0' * 64))

if __name__ == '__main__':
    unittest.main()
