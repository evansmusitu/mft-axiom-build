"""SQLite/D1 schema and atomic compare-and-swap SQL acceptance tests."""
from pathlib import Path
import sqlite3
DB=sqlite3.connect(':memory:')
DB.executescript(Path(__file__).resolve().parents[1].joinpath('schema.sql').read_text())
DB.execute('INSERT INTO workspace_tenants VALUES (?,?)',('org-123','2026-10-20T00:00:00Z'))
DB.execute('INSERT INTO workspace_tenants VALUES (?,?)',('other-org','2026-10-20T00:00:00Z'))
DB.execute('INSERT INTO workspace_memberships VALUES (?,?,?,?)',('org-123','owner-12345','owner','now'))
DB.execute('INSERT INTO workspace_memberships VALUES (?,?,?,?)',('org-123','viewer-12345','viewer','now'))
ALLOW="EXISTS (SELECT 1 FROM workspace_memberships WHERE tenant_id = ? AND subject = ? AND role IN ('owner','editor'))"
insert=f'''INSERT INTO workspace_blobs (tenant_id,slot,version,encrypted,updated_at)
SELECT ?,?,1,?,? WHERE {ALLOW} ON CONFLICT(tenant_id,slot) DO NOTHING'''
update=f'''UPDATE workspace_blobs SET encrypted=?,version=version+1,updated_at=?
WHERE tenant_id=? AND slot=? AND version=? AND {ALLOW}'''
delete=f'''DELETE FROM workspace_blobs WHERE tenant_id=? AND slot=? AND version=? AND {ALLOW}'''
enc='{'+'"encrypted":"'+'A'*120+'"}'
res=DB.execute(insert,('org-123',1,enc,'now','org-123','owner-12345'))
assert res.rowcount==1
assert DB.execute(insert,('org-123',1,enc,'now','org-123','owner-12345')).rowcount==0
assert DB.execute(update,(enc,'now','org-123',1,0,'org-123','owner-12345')).rowcount==0
assert DB.execute(update,(enc,'now','org-123',1,1,'org-123','viewer-12345')).rowcount==0
assert DB.execute(update,(enc,'now','org-123',1,1,'other-org','owner-12345')).rowcount==0
assert DB.execute(update,(enc,'now','org-123',1,1,'org-123','owner-12345')).rowcount==1
assert DB.execute('SELECT version FROM workspace_blobs WHERE tenant_id=? AND slot=1',('org-123',)).fetchone()==(2,)
assert DB.execute(delete,('org-123',1,1,'org-123','owner-12345')).rowcount==0
DB.execute("DELETE FROM workspace_memberships WHERE tenant_id='org-123' AND subject='owner-12345'")
assert DB.execute(delete,('org-123',1,2,'org-123','owner-12345')).rowcount==0
assert DB.execute('SELECT COUNT(*) FROM workspace_blobs WHERE tenant_id=?',('org-123',)).fetchone()==(1,)
assert DB.execute('SELECT COUNT(*) FROM workspace_blobs WHERE tenant_id=?',('other-org',)).fetchone()==(0,)
print('D1/SQLite workspace schema and atomic tenant-qualified CAS SQL PASS')
