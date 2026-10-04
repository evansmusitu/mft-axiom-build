"""Offline tests of the proposed single-account correction; no live credentials."""
from pathlib import Path
import sqlite3
import pytest

SQL = (Path(__file__).resolve().parents[1] / "distribution/claude/restore_linked_developer_allowance.sql").read_text()
PARAMS = {
    "issuer": "https://claude-auth.mftintelligence.com",
    "resource": "https://claude-mcp.mftintelligence.com/mcp",
    "since": "2026-10-04T13:00:00",
    "correction_timestamp": "2026-10-04T14:00:00Z",
    "observed_created_at": "2026-09-06T10:52:40.082822Z",
    "observed_updated_at": "2026-09-06T10:52:40.082822Z",
    "month": "2026-10",
}

def database():
    db = sqlite3.connect(":memory:")
    db.executescript("""
        CREATE TABLE customers(id TEXT PRIMARY KEY,plan TEXT,status TEXT,monthly_unit_override INTEGER,created_at TEXT,updated_at TEXT);
        CREATE TABLE oauth_access_tokens(customer_id TEXT,issuer TEXT,resource TEXT,created_at TEXT,revoked_at TEXT,expires_at TEXT);
        CREATE TABLE usage_buckets(customer_id TEXT,month TEXT,used_units INTEGER,unit_limit INTEGER);
    """)
    for name in ("linked-example", "unrelated-example"):
        db.execute("INSERT INTO customers VALUES (?, 'developer', 'active', NULL, ?, ?)", (name, PARAMS["observed_created_at"], PARAMS["observed_updated_at"]))
        db.execute("INSERT INTO usage_buckets VALUES (?, '2026-10', 0, 0)", (name,))
    db.execute("INSERT INTO oauth_access_tokens VALUES (?, ?, ?, ?, NULL, ?)", ("linked-example", PARAMS["issuer"], PARAMS["resource"], "2026-10-04T13:05:00Z", "2026-10-04T14:05:00Z"))
    return db

def test_proposal_changes_exactly_one_account_and_no_usage_or_auth_data():
    db = database()
    tokens = list(db.execute("SELECT * FROM oauth_access_tokens"))
    buckets = list(db.execute("SELECT * FROM usage_buckets"))
    db.execute(SQL, PARAMS)
    assert db.execute("SELECT changes()").fetchone()[0] == 1
    assert list(db.execute("SELECT id,monthly_unit_override FROM customers ORDER BY id")) == [("linked-example",1000),("unrelated-example",None)]
    assert list(db.execute("SELECT * FROM oauth_access_tokens")) == tokens
    assert list(db.execute("SELECT * FROM usage_buckets")) == buckets
    db.execute(SQL, PARAMS)
    assert db.execute("SELECT changes()").fetchone()[0] == 0

@pytest.mark.parametrize("mutation", [
    "UPDATE customers SET monthly_unit_override=0 WHERE id='linked-example'",
    "UPDATE customers SET monthly_unit_override=50 WHERE id='linked-example'",
    "UPDATE customers SET plan='pro' WHERE id='linked-example'",
    "UPDATE customers SET status='inactive' WHERE id='linked-example'",
    "UPDATE customers SET updated_at='2026-10-01' WHERE id='linked-example'",
    "UPDATE usage_buckets SET used_units=1 WHERE customer_id='linked-example'",
    "UPDATE usage_buckets SET unit_limit=1000 WHERE customer_id='linked-example'",
    "UPDATE oauth_access_tokens SET issuer='https://auth.mftintelligence.com'",
    "UPDATE oauth_access_tokens SET resource='https://mcp.mftintelligence.com/mcp'",
    "UPDATE oauth_access_tokens SET revoked_at='2026-10-04T13:30:00Z'",
    "UPDATE oauth_access_tokens SET expires_at='2026-10-04T13:59:59Z'",
    "INSERT INTO oauth_access_tokens SELECT 'unrelated-example',issuer,resource,created_at,revoked_at,expires_at FROM oauth_access_tokens",
])
def test_proposal_fails_closed_on_ambiguous_stale_or_ineligible_state(mutation):
    db = database()
    db.execute(mutation)
    db.execute(SQL, PARAMS)
    assert db.execute("SELECT changes()").fetchone()[0] == 0
