"""SQL contract tests on genuine SQLite; no production DB, secrets, or network."""
import sqlite3
from pathlib import Path

db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys=ON")
db.executescript(Path(__file__).parents[1].joinpath("migrations/0001_enterprise_workspace.sql").read_text())

A, B, OBJECT = "tenant_alpha001", "tenant_bravo002", "artifact_entry_001"
for tenant in (A, B):
    db.execute("INSERT INTO tenants VALUES (?)", (tenant,))
db.executemany(
    "INSERT INTO tenant_memberships VALUES (?,?,?,?)",
    [(A, "signed-user-A", "owner", "active"), (B, "signed-user-B", "viewer", "active")],
)
membership = "SELECT role FROM tenant_memberships WHERE tenant_id=? AND subject=? AND status=?"
assert db.execute(membership, (A, "signed-user-A", "active")).fetchone() == ("owner",)
assert db.execute(membership, (B, "signed-user-A", "active")).fetchone() is None
assert db.execute(membership, (B, "signed-user-B", "active")).fetchone() == ("viewer",)

upsert = """INSERT INTO tenant_artifacts (tenant_id, artifact_id, iv, ciphertext, version, updated_at)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(tenant_id, artifact_id)
DO UPDATE SET iv=excluded.iv, ciphertext=excluded.ciphertext, version=excluded.version,
updated_at=excluded.updated_at"""
get = "SELECT ciphertext FROM tenant_artifacts WHERE tenant_id=? AND artifact_id=?"
db.execute(upsert, (A, OBJECT, "nonce-a", "ciphertext-a", 1, 100))
db.execute(upsert, (B, OBJECT, "nonce-b", "ciphertext-b", 1, 100))
assert db.execute(get, (A, OBJECT)).fetchone() == ("ciphertext-a",)
assert db.execute(get, (B, OBJECT)).fetchone() == ("ciphertext-b",)
db.execute(upsert, (A, OBJECT, "nonce-a-new", "ciphertext-a-new", 1, 101))
assert db.execute(get, (B, OBJECT)).fetchone() == ("ciphertext-b",)

# A scoped delete must not delete identically named records in other tenants.
db.execute("DELETE FROM tenant_artifacts WHERE tenant_id=? AND artifact_id=?", (A, OBJECT))
assert db.execute(get, (A, OBJECT)).fetchone() is None
assert db.execute(get, (B, OBJECT)).fetchone() == ("ciphertext-b",)

# Membership revocation is read at request time; a revocation blocks lookup.
db.execute("UPDATE tenant_memberships SET status='revoked' WHERE tenant_id=? AND subject=?", (A, "signed-user-A"))
assert db.execute(membership, (A, "signed-user-A", "active")).fetchone() is None

# SQLite enforces cross-table references and role/status constraints.
for sql, args in [
    ("INSERT INTO tenant_artifacts VALUES (?,?,?,?,?,?)", ("unknown_tenant", OBJECT, "iv", "opaque", 1, 100)),
    ("INSERT INTO tenant_memberships VALUES (?,?,?,?)", (A, "invalid-role", "superadmin", "active")),
    ("INSERT INTO tenant_memberships VALUES (?,?,?,?)", (A, "invalid-status", "viewer", "unknown")),
]:
    try:
        db.execute(sql, args)
    except sqlite3.IntegrityError:
        pass
    else:
        raise AssertionError("Invalid schema row accepted: " + sql)

print("PASS: real SQLite compound tenant isolation, scoped mutation/deletion, revocation and constraints")
