"""Read-only independent regression repro against frozen initial candidate."""
import importlib.util
import pathlib
import sqlite3

ROOT = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('initial', ROOT / 'reviewed_initial_migration.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def fixture():
    db = sqlite3.connect(':memory:', isolation_level=None)
    db.execute('PRAGMA foreign_keys=ON')
    db.executescript('''
    CREATE TABLE customers(id TEXT PRIMARY KEY,status TEXT NOT NULL,email TEXT,plan TEXT);
    CREATE TABLE api_keys(id TEXT PRIMARY KEY,customer_id TEXT NOT NULL REFERENCES customers(id),key_hash TEXT NOT NULL,status TEXT NOT NULL,revoked_at TEXT);
    CREATE TABLE oauth_authorization_codes(code_hash TEXT PRIMARY KEY,customer_id TEXT REFERENCES customers(id));
    CREATE TABLE oauth_access_tokens(token_hash TEXT PRIMARY KEY,api_key_id TEXT REFERENCES api_keys(id),customer_id TEXT REFERENCES customers(id),revoked_at TEXT);
    CREATE TABLE oauth_refresh_tokens(token_hash TEXT PRIMARY KEY,api_key_id TEXT REFERENCES api_keys(id),customer_id TEXT REFERENCES customers(id),revoked_at TEXT);
    INSERT INTO customers VALUES('a','active','synthetic-a@example.test','fixture');
    INSERT INTO customers VALUES('b','active','synthetic-b@example.test','fixture');
    INSERT INTO api_keys VALUES('key-a','a','a','active',NULL);
    INSERT INTO api_keys VALUES('key-b','b','b','active',NULL);
    INSERT INTO oauth_authorization_codes VALUES('code-a','a');
    INSERT INTO oauth_access_tokens VALUES('access-a','key-a','a',NULL);
    INSERT INTO oauth_refresh_tokens VALUES('refresh-a','key-a','a',NULL);
    ''')
    db.executescript((ROOT / 'keyless_customer_link_candidate.sql').read_text())
    db.executescript((ROOT / 'pr66_revocation.sql').read_text())
    db.execute('INSERT INTO oauth_identity_links(issuer,subject_sha256,tenant_id,customer_id,witness_sha256) VALUES(?,?,?,?,?)',
               ('https://id.example.test','a'*64,'tenant-a','a','b'*64))
    return db


db = fixture()
db.execute('DROP TRIGGER oauth_token_link_requires_active_identity')
db.execute("CREATE TRIGGER oauth_token_link_requires_active_identity BEFORE INSERT ON oauth_identity_token_links BEGIN SELECT RAISE(ABORT,'external_policy_hold'); END")
m.upgrade(db)
print('F1_UNKNOWN_TRIGGER_OVERWRITTEN', 'external_policy_hold' not in db.execute("SELECT sql FROM sqlite_master WHERE name='oauth_token_link_requires_active_identity'").fetchone()[0])
db.close()

db = fixture()
db.execute('PRAGMA ignore_check_constraints=ON')
db.execute("UPDATE oauth_identity_links SET state='invalid-state',revoked_at='corrupt'")
db.execute('PRAGMA ignore_check_constraints=OFF')
m.upgrade(db)
print('F2_INVALID_CHECK_ROW_ACCEPTED',db.execute('SELECT state,revoked_at FROM oauth_identity_links').fetchone())
db.close()

db = fixture()
for table in ['oauth_identity_code_links','oauth_identity_token_links','oauth_identity_links']:
    db.execute('DROP TABLE '+table)
sql = next(s for s in m.statements((ROOT / 'keyless_customer_link_candidate.sql').read_text()) if s.startswith('CREATE TABLE'))
db.execute(sql.replace("'active'","'ACTIVE'"))
m.upgrade(db)
print('F3_DIFFERENT_LITERAL_SCHEMA_ACCEPTED',"DEFAULT 'ACTIVE'" in db.execute("SELECT sql FROM sqlite_master WHERE name='oauth_identity_links'").fetchone()[0])
db.close()

db = fixture()
db.execute('INSERT INTO oauth_identity_token_links(api_key_id,issuer,subject_sha256,customer_id,tenant_id) VALUES(?,?,?,?,?)',
           ('key-b','https://id.example.test','a'*64,'a','tenant-a'))
db.execute('PRAGMA ignore_check_constraints=ON')
m.upgrade(db)
print('F4_DISABLED_CHECK_GUARDS_ACCEPT_DIRTY_PAIR',db.execute('SELECT customer_id,api_key_id FROM oauth_identity_token_links').fetchall())
db.close()
