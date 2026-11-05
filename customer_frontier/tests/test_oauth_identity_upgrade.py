"""Existing-schema migration/recovery tests. Offline SQLite, no hosted claims."""
import pathlib
import sqlite3
import tempfile
import unittest
import importlib.util
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
AUTH = ROOT / 'auth'
OLD = pathlib.Path(__file__).parent / 'fixtures/oauth-upgrade/pr66_revocation.sql'


spec = importlib.util.spec_from_file_location('oauth_upgrade', AUTH / 'oauth_identity_upgrade_v2.py')
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)
upgrade = migration.upgrade


def fixture(path=':memory:', old=True):
    db = sqlite3.connect(path, isolation_level=None)
    db.execute('PRAGMA foreign_keys=ON')
    db.executescript('''
        CREATE TABLE customers(id TEXT PRIMARY KEY,status TEXT NOT NULL,email TEXT,plan TEXT);
        CREATE TABLE api_keys(id TEXT PRIMARY KEY,customer_id TEXT NOT NULL REFERENCES customers(id),key_hash TEXT NOT NULL,status TEXT NOT NULL,revoked_at TEXT);
        CREATE TABLE oauth_authorization_codes(code_hash TEXT PRIMARY KEY,customer_id TEXT REFERENCES customers(id));
        CREATE TABLE oauth_access_tokens(token_hash TEXT PRIMARY KEY,api_key_id TEXT REFERENCES api_keys(id),customer_id TEXT REFERENCES customers(id),revoked_at TEXT);
        CREATE TABLE oauth_refresh_tokens(token_hash TEXT PRIMARY KEY,api_key_id TEXT REFERENCES api_keys(id),customer_id TEXT REFERENCES customers(id),revoked_at TEXT);
        INSERT INTO customers VALUES('customer-a','active','private@example.test','original-plan');
        INSERT INTO customers VALUES('customer-b','active','other@example.test','other-plan');
        INSERT INTO api_keys VALUES('key-a','customer-a','original-hash','active',NULL);
        INSERT INTO api_keys VALUES('key-b','customer-b','other-hash','active',NULL);
        INSERT INTO oauth_authorization_codes VALUES('code-a','customer-a');
        INSERT INTO oauth_authorization_codes VALUES('code-b','customer-b');
        INSERT INTO oauth_access_tokens VALUES('access-a','key-a','customer-a',NULL);
        INSERT INTO oauth_refresh_tokens VALUES('refresh-a','key-a','customer-a',NULL);
    ''')
    db.executescript((AUTH / 'keyless_customer_link_candidate.sql').read_text())
    db.executescript(OLD.read_text() if old else (AUTH / 'keyless_token_revocation_candidate.sql').read_text())
    db.execute('INSERT INTO oauth_identity_links(issuer,subject_sha256,tenant_id,customer_id,witness_sha256) VALUES(?,?,?,?,?)',
               ('https://id.example.test', 'a' * 64, 'tenant-a', 'customer-a', 'b' * 64))
    return db


def link(db, kind='token', parent='key-a'):
    table, column = ('oauth_identity_token_links', 'api_key_id') if kind == 'token' else ('oauth_identity_code_links', 'code_hash')
    db.execute(f'INSERT INTO {table}({column},issuer,subject_sha256,customer_id,tenant_id) VALUES(?,?,?,?,?)',
               (parent, 'https://id.example.test', 'a' * 64, 'customer-a', 'tenant-a'))


def snapshot(db):
    return '\n'.join(db.iterdump())


class OAuthUpgrade(unittest.TestCase):
    def test_existing_v1_trigger_is_replaced_and_cross_customer_key_denied(self):
        with fixture() as db:
            upgrade(db)
            with self.assertRaisesRegex(sqlite3.IntegrityError, 'identity_token_link_not_active'):
                link(db, parent='key-b')

    def test_existing_v1_trigger_is_replaced_and_cross_customer_code_denied(self):
        with fixture() as db:
            upgrade(db)
            with self.assertRaisesRegex(sqlite3.IntegrityError, 'identity_code_link_not_active'):
                link(db, 'code', 'code-b')

    def test_dirty_pairing_is_rejected_without_any_schema_or_data_change(self):
        for kind, parent in [('token', 'key-b'), ('code', 'code-b')]:
            with self.subTest(kind=kind), fixture() as db:
                link(db, kind, parent)
                before = snapshot(db)
                with self.assertRaises(sqlite3.IntegrityError):
                    upgrade(db)
                self.assertEqual(snapshot(db), before)

    def test_legacy_nullable_primary_key_is_rejected_after_upgrade(self):
        with fixture() as db:
            upgrade(db)
            for kind in ['token', 'code']:
                with self.subTest(kind=kind), self.assertRaises(sqlite3.IntegrityError):
                    link(db, kind, None)

    def test_dirty_null_primary_key_is_rejected_without_mutation(self):
        with fixture() as db:
            link(db, 'code', None)
            before = snapshot(db)
            with self.assertRaises(sqlite3.IntegrityError):
                upgrade(db)
            self.assertEqual(snapshot(db), before)

    def test_clean_rows_and_unrelated_trigger_preserved_on_idempotent_upgrade(self):
        with fixture() as db:
            link(db)
            link(db, 'code', 'code-a')
            db.execute('CREATE TABLE unrelated(n INTEGER)')
            db.execute("CREATE TRIGGER unrelated_audit AFTER INSERT ON unrelated BEGIN SELECT 1; END")
            tables = [row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")]
            before = {t: db.execute(f'SELECT * FROM {t}').fetchall() for t in tables}
            upgrade(db)
            upgraded = snapshot(db)
            upgrade(db)
            self.assertEqual(snapshot(db), upgraded)
            self.assertEqual({t: db.execute(f'SELECT * FROM {t}').fetchall() for t in tables}, before)
            self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(), [])
            self.assertIsNotNone(db.execute("SELECT sql FROM sqlite_master WHERE name='unrelated_audit'").fetchone())

    def test_legitimate_revoked_history_survives_and_cannot_be_reactivated(self):
        with fixture() as db:
            link(db)
            db.execute("UPDATE oauth_identity_links SET state='revoked',revoked_at=CURRENT_TIMESTAMP")
            before = db.execute('SELECT * FROM oauth_identity_token_links').fetchall()
            upgrade(db)
            self.assertEqual(db.execute('SELECT * FROM oauth_identity_token_links').fetchall(), before)
            with self.assertRaises(sqlite3.IntegrityError):
                db.execute("UPDATE api_keys SET status='active' WHERE id='key-a'")

    def test_upgrade_rejects_active_credential_belonging_to_disabled_customer(self):
        with fixture() as db:
            db.execute('DROP TRIGGER oauth_customer_disabled_revokes_tokens')
            db.execute("UPDATE customers SET status='disabled' WHERE id='customer-a'")
            before = snapshot(db)
            with self.assertRaises(sqlite3.IntegrityError):
                upgrade(db)
            self.assertEqual(snapshot(db), before)

    def test_upgraded_revocation_updates_both_families_and_key_atomically(self):
        with fixture() as db:
            upgrade(db)
            link(db)
            db.execute("UPDATE oauth_identity_links SET state='revoked',revoked_at=CURRENT_TIMESTAMP")
            self.assertEqual(db.execute("SELECT status FROM api_keys WHERE id='key-a'").fetchone()[0], 'revoked')
            for table in ['oauth_access_tokens', 'oauth_refresh_tokens']:
                self.assertIsNotNone(db.execute(f'SELECT revoked_at FROM {table}').fetchone()[0])

    def test_mid_ddl_failure_rolls_back_replaced_triggers_and_version(self):
        with fixture() as db:
            before = snapshot(db)
            seen = []

            def authorizer(action, name, *args):
                if action == sqlite3.SQLITE_CREATE_TRIGGER:
                    seen.append(name)
                    if name == 'oauth_customer_disabled_revokes_tokens':
                        return sqlite3.SQLITE_DENY
                return sqlite3.SQLITE_OK

            db.set_authorizer(authorizer)
            try:
                with self.assertRaises(sqlite3.DatabaseError):
                    upgrade(db)
            finally:
                db.set_authorizer(None)
            self.assertGreater(len(seen), 4)  # Failure occurred after earlier replacements.
            self.assertFalse(db.in_transaction)
            self.assertEqual(snapshot(db), before)

    def test_process_crash_during_trigger_replacement_restores_original_database(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = str(pathlib.Path(tmp) / 'staging-rehearsal.sqlite')
            db = fixture(path)
            before = snapshot(db)
            db.close()
            child = '''
import importlib.util, os, sqlite3, sys
spec=importlib.util.spec_from_file_location('migration',sys.argv[1])
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
db=sqlite3.connect(sys.argv[2],isolation_level=None)
db.execute('PRAGMA foreign_keys=ON')
def stop(action,name,*args):
    if action==sqlite3.SQLITE_CREATE_TRIGGER and name=='oauth_customer_disabled_revokes_tokens': os._exit(73)
    return sqlite3.SQLITE_OK
db.set_authorizer(stop)
m.upgrade(db)
'''
            process = subprocess.run([sys.executable, '-c', child, str(AUTH / 'oauth_identity_upgrade_v2.py'), path],
                                     capture_output=True, text=True, timeout=15)
            self.assertEqual(process.returncode, 73, process.stderr)
            db = sqlite3.connect(path, isolation_level=None)
            try:
                self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
                self.assertEqual(snapshot(db), before)
                db.execute('PRAGMA foreign_keys=ON')
                upgrade(db)
                with self.assertRaises(sqlite3.IntegrityError):
                    link(db, parent='key-b')
            finally:
                db.close()

    def test_writer_lock_spans_preflight_and_trigger_replacement(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = str(pathlib.Path(tmp) / 'concurrency.sqlite')
            db = fixture(path)
            contender = sqlite3.connect(path, timeout=0, isolation_level=None)
            blocked = []

            def authorizer(action, name, *args):
                if action == sqlite3.SQLITE_CREATE_TRIGGER and not blocked:
                    with self.assertRaisesRegex(sqlite3.OperationalError, 'locked'):
                        contender.execute("UPDATE api_keys SET customer_id='customer-b' WHERE id='key-a'")
                    blocked.append(True)
                return sqlite3.SQLITE_OK

            try:
                db.set_authorizer(authorizer)
                upgrade(db)
                self.assertEqual(blocked, [True])
            finally:
                db.set_authorizer(None)
                contender.close()
                db.close()

    def test_never_commits_callers_work_or_disables_foreign_keys(self):
        with fixture() as db:
            db.execute('BEGIN')
            db.execute("UPDATE customers SET plan='uncommitted' WHERE id='customer-a'")
            with self.assertRaisesRegex(ValueError, 'own_transaction'):
                upgrade(db)
            self.assertTrue(db.in_transaction)
            db.execute('ROLLBACK')
            self.assertEqual(db.execute("SELECT plan FROM customers WHERE id='customer-a'").fetchone()[0], 'original-plan')
            db.execute('PRAGMA foreign_keys=OFF')
            before = snapshot(db)
            with self.assertRaisesRegex(ValueError, 'foreign_keys'):
                upgrade(db)
            self.assertEqual(snapshot(db), before)

    def test_unknown_table_layout_and_conflicting_version_are_rejected(self):
        with fixture() as db:
            db.execute('ALTER TABLE oauth_identity_token_links ADD COLUMN unreviewed TEXT')
            before = snapshot(db)
            with self.assertRaises(sqlite3.IntegrityError):
                upgrade(db)
            self.assertEqual(snapshot(db), before)
        with fixture() as db:
            upgrade(db)
            db.execute("UPDATE oauth_identity_schema_versions SET plan_sha256=?", ('0' * 64,))
            before = snapshot(db)
            with self.assertRaises(sqlite3.IntegrityError):
                upgrade(db)
            self.assertEqual(snapshot(db), before)

    def test_existing_current_schema_upgrade_and_nonlinked_legacy_rows(self):
        with fixture(old=False) as db:
            before = db.execute('SELECT * FROM api_keys').fetchall()
            upgrade(db)
            self.assertEqual(db.execute('SELECT * FROM api_keys').fetchall(), before)
            self.assertEqual(db.execute('SELECT count(*) FROM oauth_identity_token_links').fetchone()[0], 0)

    def test_missing_identity_tables_are_created_without_autolinking_customers(self):
        with fixture() as db:
            db.execute('DROP TABLE oauth_identity_code_links')
            db.execute('DROP TABLE oauth_identity_token_links')
            db.execute('DROP TABLE oauth_identity_links')
            before = db.execute('SELECT * FROM customers').fetchall()
            upgrade(db)
            self.assertEqual(db.execute('SELECT count(*) FROM oauth_identity_links').fetchone()[0], 0)
            self.assertEqual(db.execute('SELECT * FROM customers').fetchall(), before)

    def test_unrecognized_existing_managed_trigger_is_not_overwritten(self):
        with fixture() as db:
            db.execute('DROP TRIGGER oauth_token_link_requires_active_identity')
            db.execute("CREATE TRIGGER oauth_token_link_requires_active_identity BEFORE INSERT ON oauth_identity_token_links BEGIN SELECT RAISE(ABORT,'external_policy_hold'); END")
            before = snapshot(db)
            with self.assertRaises(sqlite3.IntegrityError):
                upgrade(db)
            self.assertEqual(snapshot(db), before)

    def test_constraint_violating_historical_rows_are_rejected_unchanged(self):
        for column, value in [('state', 'invalid-state'), ('subject_sha256', 'short'), ('witness_sha256', 'z' * 64), ('revoked_at', 'invalid-active-revocation')]:
            with self.subTest(column=column), fixture() as db:
                if column in ('subject_sha256', 'witness_sha256'):
                    db.execute('DROP TRIGGER oauth_identity_link_immutable_identity')
                db.execute('PRAGMA ignore_check_constraints=ON')
                db.execute(f'UPDATE oauth_identity_links SET {column}=?', (value,))
                db.execute('PRAGMA ignore_check_constraints=OFF')
                before = snapshot(db)
                with self.assertRaises(sqlite3.IntegrityError):
                    upgrade(db)
                self.assertEqual(snapshot(db), before)

    def test_schema_comparison_preserves_sql_literal_meaning(self):
        with fixture() as db:
            db.execute('DROP TABLE oauth_identity_code_links')
            db.execute('DROP TABLE oauth_identity_token_links')
            db.execute('DROP TABLE oauth_identity_links')
            altered = (AUTH / 'keyless_customer_link_candidate.sql').read_text().replace("'active'", "'ACTIVE'")
            db.executescript(altered)
            before = snapshot(db)
            with self.assertRaises(sqlite3.IntegrityError):
                upgrade(db)
            self.assertEqual(snapshot(db), before)

    def test_disabled_check_constraints_cannot_bypass_dirty_row_guard(self):
        with fixture() as db:
            link(db, parent='key-b')
            db.execute('PRAGMA ignore_check_constraints=ON')
            before = snapshot(db)
            with self.assertRaisesRegex(ValueError, 'check_constraints'):
                upgrade(db)
            self.assertEqual(snapshot(db), before)
            # Exercise the exported plan without the Python admission seam.
            db.execute('BEGIN IMMEDIATE')
            try:
                with self.assertRaises(sqlite3.IntegrityError):
                    for sql in migration.build_plan()['statements']:
                        db.execute(sql)
            finally:
                db.execute('ROLLBACK')
            self.assertEqual(snapshot(db), before)

    def test_unreviewed_version_insert_trigger_cannot_mutate_customer_data(self):
        with fixture() as db:
            upgrade(db)
            db.execute("CREATE TRIGGER unreviewed_version_hook AFTER INSERT ON oauth_identity_schema_versions BEGIN UPDATE customers SET plan='changed-by-policy'; END")
            db.execute('DELETE FROM oauth_identity_schema_versions')
            before = snapshot(db)
            with self.assertRaises(sqlite3.IntegrityError):
                upgrade(db)
            self.assertEqual(snapshot(db), before)
            # The exported plan also refuses this policy hook atomically.
            db.execute('BEGIN IMMEDIATE')
            try:
                with self.assertRaises(sqlite3.IntegrityError):
                    for sql in migration.build_plan()['statements']:
                        db.execute(sql)
            finally:
                db.execute('ROLLBACK')
            self.assertEqual(snapshot(db), before)


if __name__ == '__main__':
    unittest.main()
