"""Native sqlite3 acceptance of the SAME SQL referenced by gateway.mjs/DO adapter."""
import re
import sqlite3
import unittest
from pathlib import Path

BASE=Path(__file__).parent.parent
schema_src=(BASE/'durable-sql-adapter.mjs').read_text(encoding='utf-8')
gateway=(BASE/'gateway.mjs').read_text(encoding='utf-8')
schema=re.search(r'export const DURABLE_SCHEMA=\x60(.*?)\x60;',schema_src,re.S)
assert schema, "Missing embedded Durable Object schema"
permission="EXISTS (SELECT 1 FROM workspace_memberships WHERE tenant_id = ? AND subject = ? AND role IN ('owner','editor'))"


def capture(fragment):
    matches=re.findall(r'\x60('+fragment+r'.*?)\x60',gateway,re.S)
    assert len(matches)==1, f"Expected one SQL statement matching {fragment}, got {len(matches)}"
    return matches[0].replace('${permission}',permission)


INSERT=capture(r'INSERT INTO workspace_blobs')
UPDATE=capture(r'UPDATE workspace_blobs SET')
DELETE=capture(r'DELETE FROM workspace_blobs WHERE')
assert 'ON CONFLICT(tenant_id,slot) DO NOTHING' in INSERT
assert 'version=version+1' in UPDATE

class DurableSQLiteContract(unittest.TestCase):
    def setUp(self):
        self.con=sqlite3.connect(':memory:')
        self.con.row_factory=sqlite3.Row
        self.con.execute('PRAGMA foreign_keys=ON')
        self.con.executescript(schema.group(1))
        self.con.execute('INSERT INTO workspace_tenants VALUES (?,?)',('tenantalpha','2026-10-21'))
        self.con.execute('INSERT INTO workspace_tenants VALUES (?,?)',('tenantbeta','2026-10-21'))
        self.con.execute('INSERT INTO workspace_memberships VALUES (?,?,?,?)',
                         ('tenantalpha','alpha-owner-0123','owner','2026-10-21'))
        self.con.execute('INSERT INTO workspace_memberships VALUES (?,?,?,?)',
                         ('tenantalpha','alpha-viewer-123','viewer','2026-10-21'))
        self.vault='{'+'"kind":"musitu-local-encrypted-workspace"'+','+'"pad":"'+('X'*120)+'"}'
        self.ts='2026-10-21T01:00:00Z'

    def tearDown(self):
        self.con.close()

    def write(self,sql,args):
        old=self.con.total_changes
        self.con.execute(sql,args)
        return self.con.total_changes-old

    def test_sqlite_schema_enforces_tenant_foreign_key_and_five_slots(self):
        names={x['name'] for x in self.con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        for expected in ('workspace_tenants','workspace_memberships','workspace_blobs'):
            self.assertIn(expected,names)
        with self.assertRaises(sqlite3.IntegrityError):
            self.con.execute('INSERT INTO workspace_memberships VALUES (?,?,?,?)',
                 ('nonexistent','missing-subject-123','owner',self.ts))
        with self.assertRaises(sqlite3.IntegrityError):
            self.con.execute('INSERT INTO workspace_blobs VALUES (?,?,?,?,?)',
                 ('tenantalpha',6,1,self.vault,self.ts))

    def test_owner_create_duplicate_rejected_then_cas_update_and_delete(self):
        args=('tenantalpha',1,self.vault,self.ts,'tenantalpha','alpha-owner-0123')
        self.assertEqual(self.write(INSERT,args),1)
        self.assertEqual(self.write(INSERT,args),0)
        self.assertEqual(self.write(UPDATE,(self.vault,self.ts,'tenantalpha',1,0,'tenantalpha','alpha-owner-0123')),0)
        self.assertEqual(self.write(UPDATE,(self.vault,self.ts,'tenantalpha',1,1,'tenantalpha','alpha-owner-0123')),1)
        row=self.con.execute('SELECT version FROM workspace_blobs WHERE tenant_id=? AND slot=1',('tenantalpha',)).fetchone()
        self.assertEqual(row['version'],2)
        self.assertEqual(self.write(DELETE,('tenantalpha',1,1,'tenantalpha','alpha-owner-0123')),0)
        self.assertEqual(self.write(DELETE,('tenantalpha',1,2,'tenantalpha','alpha-owner-0123')),1)

    def test_cross_tenant_and_viewer_cannot_create_or_modify(self):
        outsider=('tenantbeta',2,self.vault,self.ts,'tenantbeta','alpha-owner-0123')
        self.assertEqual(self.write(INSERT,outsider),0)
        viewer=('tenantalpha',2,self.vault,self.ts,'tenantalpha','alpha-viewer-123')
        self.assertEqual(self.write(INSERT,viewer),0)
        self.assertEqual(self.write(INSERT,('tenantalpha',2,self.vault,self.ts,'tenantalpha','alpha-owner-0123')),1)
        self.assertEqual(self.write(UPDATE,(self.vault,self.ts,'tenantalpha',2,1,'tenantalpha','alpha-viewer-123')),0)

    def test_membership_revocation_blocks_write_inside_sql_statement(self):
        self.assertEqual(self.write(INSERT,('tenantalpha',1,self.vault,self.ts,'tenantalpha','alpha-owner-0123')),1)
        self.con.execute('DELETE FROM workspace_memberships WHERE tenant_id=? AND subject=?',
                         ('tenantalpha','alpha-owner-0123'))
        self.assertEqual(self.write(UPDATE,(self.vault,self.ts,'tenantalpha',1,1,'tenantalpha','alpha-owner-0123')),0)
        self.assertEqual(self.write(DELETE,('tenantalpha',1,1,'tenantalpha','alpha-owner-0123')),0)
        self.assertIsNotNone(self.con.execute('SELECT 1 FROM workspace_blobs WHERE slot=1').fetchone())


if __name__=='__main__':
    unittest.main()
