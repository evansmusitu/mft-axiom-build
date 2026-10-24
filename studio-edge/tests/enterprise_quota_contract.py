"""Real SQLite, transactional per-tenant row-cap contract. Uses every known migration."""
import sqlite3
from pathlib import Path

ROOT=Path(__file__).parents[1]
db=sqlite3.connect(':memory:')
db.execute('PRAGMA foreign_keys=ON')
for migration in sorted((ROOT/'migrations').glob('[0-9][0-9][0-9][0-9]_enterprise_*.sql')):
    db.executescript(migration.read_text())
A,B='tenant_alpha001','tenant_bravo002'
for tenant in (A,B):
    db.execute('INSERT INTO tenants VALUES (?)',(tenant,))

UPSERT="""INSERT INTO tenant_artifacts
(tenant_id,artifact_id,iv,ciphertext,version,updated_at) VALUES (?,?,?,?,?,?)
ON CONFLICT(tenant_id,artifact_id)
DO UPDATE SET iv=excluded.iv,ciphertext=excluded.ciphertext,
version=excluded.version,updated_at=excluded.updated_at"""
def put(tenant,num,content='opaque'):
    db.execute(UPSERT,(tenant,f'artifact_{num:08d}','nonce',content,1,100+num))
def count(tenant):
    return db.execute('SELECT count(*) FROM tenant_artifacts WHERE tenant_id=?',(tenant,)).fetchone()[0]

for i in range(50):
    put(A,i)
assert count(A)==50
try:
    put(A,50)
except sqlite3.IntegrityError as error:
    assert 'tenant_artifact_limit_exceeded' in str(error)
else:
    raise AssertionError('Tenant A exceeded database-enforced 50-item cap')
assert count(A)==50

put(A,0,'ciphertext-replacement')
assert db.execute('SELECT ciphertext FROM tenant_artifacts WHERE tenant_id=? AND artifact_id=?',
  (A,'artifact_00000000')).fetchone()==('ciphertext-replacement',)

for i in range(50):
    put(B,i)
assert count(B)==50
try:
    put(B,50)
except sqlite3.IntegrityError as error:
    assert 'tenant_artifact_limit_exceeded' in str(error)
else:
    raise AssertionError('Tenant B exceeded database-enforced 50-item cap')

db.execute('DELETE FROM tenant_artifacts WHERE tenant_id=? AND artifact_id=?',(A,'artifact_00000001'))
put(A,50)
assert count(A)==50 and count(B)==50
assert db.execute('SELECT 1 FROM tenant_artifacts WHERE tenant_id=? AND artifact_id=?',
  (B,'artifact_00000001')).fetchone()==(1,)
print('PASS: real SQLite atomic per-tenant 50-row cap, upsert at cap, release and isolation')
