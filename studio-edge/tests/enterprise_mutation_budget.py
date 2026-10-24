"""Contract: global-per-D1, tenant-specific minute mutation budget, enforced atomically.
No Cloudflare, production credentials, account state, or external network.
"""
import sqlite3
from pathlib import Path

root=Path(__file__).parents[1]/"migrations"
db=sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys = ON")
for migration in sorted(root.glob("[0-9][0-9][0-9][0-9]_enterprise_*.sql")):
    db.executescript(migration.read_text())

A,B="tenant_alpha001","tenant_bravo002"
for tenant in (A,B):
    db.execute("INSERT INTO tenants(tenant_id) VALUES(?)",(tenant,))
audit="INSERT INTO tenant_audit(tenant_id, artifact_id, subject, event, at) VALUES (?,?,?,?,?)"

def insert(tenant,index,stamp=1000):
    db.execute(audit,(tenant, f"artifact_{index:08d}", "signed_editor", "put", stamp))

# One signed actor cannot grow durable audit storage without a bounded budget,
# even by overwriting the same object in a tight loop.
for i in range(20):
    insert(A,i)
assert db.execute("SELECT count(*) FROM tenant_audit WHERE tenant_id=?",(A,)).fetchone()[0]==20
try:
    insert(A,20)
except sqlite3.IntegrityError as e:
    assert "tenant_mutation_budget_exceeded" in str(e), str(e)
else:
    raise AssertionError("Unbounded write/audit records accepted for tenant A")

# Tenant B has an independent budget.
for i in range(20):
    insert(B,i)
try:
    insert(B,20)
except sqlite3.IntegrityError as e:
    assert "tenant_mutation_budget_exceeded" in str(e),str(e)
else:
    raise AssertionError("Unbounded write/audit records accepted for tenant B")

# Rolling 60-second window must release capacity for both tenants.
insert(A,21,1060)
insert(B,21,1060)
for tenant in (A,B):
    assert db.execute("SELECT count(*) FROM tenant_audit WHERE tenant_id=?",(tenant,)).fetchone()[0]==21

# Reject same-window inserts with timestamps shifted backwards to evade the cap.
# Treat *relative to the new timestamp*; the production timestamp comes from
# server time, never a client-supplied field.
try:
    insert(A,22,1001)
except sqlite3.IntegrityError as e:
    assert "tenant_mutation_budget_exceeded" in str(e),str(e)
else:
    raise AssertionError("Backdated insertion evaded the rolling mutation budget")
print("PASS: mutation audit budget 20/60s per tenant in SQLite, separate scope, rollback, rolling reset")
