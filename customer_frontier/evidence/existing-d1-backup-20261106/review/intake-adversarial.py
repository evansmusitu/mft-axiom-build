"""Independent synthetic local SQLite restore boundary probes; no provider data."""
import contextlib,hashlib,http.client,importlib.util,io,json,os,socket,ssl,sqlite3,sys,tempfile,unittest,urllib.request
from pathlib import Path
from unittest.mock import patch
sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('intake_restore_subject',ROOT/'existing-d1-recovery/customer_frontier/recovery/restore_sql_private.py')
subject=importlib.util.module_from_spec(spec);spec.loader.exec_module(subject)
SQL="""CREATE TABLE parent(id INTEGER PRIMARY KEY);
CREATE TABLE child(id INTEGER PRIMARY KEY,pid INTEGER REFERENCES parent(id),value BLOB,note TEXT);
CREATE INDEX child_parent ON child(pid);
INSERT INTO parent VALUES(1);
INSERT INTO child VALUES(1,1,X'00FF','PRIVATE_ROW_SENTINEL'),(2,1,NULL,'unicode_é');"""
def expected():
 db=sqlite3.connect(':memory:');db.executescript(SQL)
 try:return {subject.sha(n.encode()):(t,subject.sha(s.encode())) for t,n,s in db.execute("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL")}
 finally:db.close()
class IndependentIntake(unittest.TestCase):
 def folder(self):return tempfile.TemporaryDirectory(dir=ROOT/'reuse-review/intake-tmp')
 def test_fingerprint_is_order_independent_and_content_sensitive(self):
  with self.folder() as f:
   base=subject.restore(SQL.encode(),Path(f)/'a.sqlite',expected())
   reversed_sql=SQL.replace("(1,1,X'00FF','PRIVATE_ROW_SENTINEL'),(2,1,NULL,'unicode_é')","(2,1,NULL,'unicode_é'),(1,1,X'00FF','PRIVATE_ROW_SENTINEL')")
   replay=subject.restore(reversed_sql.encode(),Path(f)/'b.sqlite',expected())
   changed=subject.restore(SQL.replace('PRIVATE_ROW_SENTINEL','OTHER').encode(),Path(f)/'c.sqlite',expected())
   self.assertEqual(base['user_data_sha256'],replay['user_data_sha256']);self.assertNotEqual(base['user_data_sha256'],changed['user_data_sha256'])
   self.assertNotIn('PRIVATE_ROW_SENTINEL',json.dumps(base));self.assertEqual(sum(v['rows'] for v in base['tables']),3)
   for flag in ('hosted_restore_qualified','target_admitted','release_authority'):self.assertIs(base[flag],False)
 def test_existing_file_and_symlink_destination_never_modified(self):
  with self.folder() as f:
   victim=Path(f)/'victim';victim.write_bytes(b'UNCHANGED');link=Path(f)/'link';link.symlink_to(victim)
   for target in (victim,link):
    with self.assertRaises(FileExistsError):subject.restore(SQL.encode(),target,expected())
   self.assertEqual(victim.read_bytes(),b'UNCHANGED')
 def test_attach_and_vacuum_into_cannot_create_external_file(self):
  with self.folder() as f:
   external=Path(f)/'external.sqlite'
   statements=["ATTACH DATABASE '"+str(external)+"' AS x;","COMMIT; VACUUM INTO '"+str(external)+"'; BEGIN;","COMMIT; ATTACH DATABASE '"+str(external)+"' AS x; BEGIN;"]
   for i,sql in enumerate(statements):
    with self.assertRaises(sqlite3.Error):subject.restore(sql.encode(),Path(f)/('probe'+str(i)),{})
    self.assertFalse(external.exists())
 def test_unsafe_pragmas_and_extension_file_functions_fail(self):
  statements=['PRAGMA writable_schema=ON;','PRAGMA journal_mode=OFF;','PRAGMA temp_store_directory="/tmp";',"SELECT load_extension('PRIVATE_PATH');","SELECT readfile('PRIVATE_PATH');","SELECT writefile('PRIVATE_PATH','PRIVATE_VALUE');"]
  with self.folder() as f:
   for i,sql in enumerate(statements):
    with self.assertRaises(sqlite3.Error):subject.restore(sql.encode(),Path(f)/('probe'+str(i)),{})
 def test_post_restore_fk_check_catches_dump_disabling_foreign_keys(self):
  bad='COMMIT; PRAGMA foreign_keys=OFF; BEGIN;\n'+SQL.replace('(1,1,X','(1,999,X')
  with self.folder() as f:
   with self.assertRaisesRegex(ValueError,'RESTORE_INTEGRITY_FAILED'):subject.restore(bad.encode(),Path(f)/'invalid.sqlite',expected())
 def test_extra_view_trigger_or_schema_drift_never_qualifies(self):
  with self.folder() as f:
   for i,extra in enumerate(['CREATE VIEW private_view AS SELECT * FROM parent;','CREATE TRIGGER private_trigger AFTER INSERT ON parent BEGIN SELECT 1; END;','CREATE TABLE private_extra(v);']):
    with self.assertRaisesRegex(ValueError,'RESTORED_CATALOG_MISMATCH'):subject.restore((SQL+extra).encode(),Path(f)/('extra'+str(i)),expected())
 def test_fresh_db_is_private_without_changing_process_umask(self):
  with self.folder() as f:
   old=os.umask(0)
   try:
    p=Path(f)/'private.sqlite';subject.restore(SQL.encode(),p,expected());self.assertEqual(p.stat().st_mode&0o777,0o600)
   finally:os.umask(old)
 def test_invalid_export_rejected_before_file_creation(self):
  with self.folder() as f:
   for raw in (b'',b'\xff',b'x'*8_000_001,None,'notbytes'):
    p=Path(f)/'invalid'
    with self.assertRaises((ValueError,UnicodeError)):subject.restore(raw,p,{})
    self.assertFalse(p.exists())
def deny(*a,**k):raise AssertionError('Independent intake tests forbid network')
if __name__=='__main__':
 with patch.object(socket,'socket',deny),patch.object(socket,'create_connection',deny):unittest.main(verbosity=2)
