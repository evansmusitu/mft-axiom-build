import hashlib
import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import unittest

path=Path(__file__).resolve().parents[1]/'recovery/restore_sql_private.py'
spec=importlib.util.spec_from_file_location('private_restore',path);subject=importlib.util.module_from_spec(spec);spec.loader.exec_module(subject)
SQL="""CREATE TABLE parent(id TEXT PRIMARY KEY NOT NULL);
CREATE TABLE child(id INTEGER PRIMARY KEY,parent_id TEXT REFERENCES parent(id),payload BLOB,note TEXT);
CREATE INDEX child_parent ON child(parent_id);
INSERT INTO parent VALUES('PRIVATE_PARENT');
INSERT INTO child VALUES(1,'PRIVATE_PARENT',X'0001FF','PRIVATE_ROW'),(2,'PRIVATE_PARENT',NULL,'unicode_é');"""
def expected(sql=SQL):
 db=sqlite3.connect(':memory:');db.executescript(sql)
 try:return {subject.sha(n.encode()):(kind,subject.sha(ddl.encode())) for kind,n,ddl in db.execute("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL")}
 finally:db.close()
class PrivateRestore(unittest.TestCase):
 def test_restore_preserves_null_blob_unicode_and_rows_and_replays_identically(self):
  with tempfile.TemporaryDirectory() as folder:
   a=subject.restore(SQL.encode(),Path(folder)/'first.sqlite',expected());b=subject.restore(SQL.encode(),Path(folder)/'second.sqlite',expected())
   self.assertEqual(a['user_data_sha256'],b['user_data_sha256']);self.assertEqual(sum(t['rows'] for t in a['tables']),3)
   self.assertFalse(a['hosted_restore_qualified']);self.assertFalse(a['target_admitted']);self.assertFalse(a['release_authority'])
   self.assertNotIn('PRIVATE_',str(a));self.assertEqual((Path(folder)/'first.sqlite').stat().st_mode&0o777,0o600)
   db=sqlite3.connect(Path(folder)/'first.sqlite')
   try:self.assertEqual(db.execute('SELECT payload,note FROM child WHERE id=1').fetchone(),(b'\x00\x01\xff','PRIVATE_ROW'))
   finally:db.close()
 def test_catalog_drift_cannot_qualify(self):
  with tempfile.TemporaryDirectory() as f:
   with self.assertRaisesRegex(ValueError,'RESTORED_CATALOG_MISMATCH'):subject.restore(SQL.encode(),Path(f)/'drift.sqlite',{})
 def test_overwrite_never_changes_existing_file(self):
  with tempfile.TemporaryDirectory() as f:
   p=Path(f)/'existing.sqlite';p.write_bytes(b'ORIGINAL')
   with self.assertRaises(FileExistsError):subject.restore(SQL.encode(),p,expected())
   self.assertEqual(p.read_bytes(),b'ORIGINAL')
 def test_attach_and_writable_schema_are_denied(self):
  with tempfile.TemporaryDirectory() as f:
   external=Path(f)/'external.sqlite'
   for i,sql in enumerate(["ATTACH DATABASE '"+str(external)+"' AS other;",'PRAGMA writable_schema=ON;']):
    with self.assertRaises(sqlite3.Error):subject.restore(sql.encode(),Path(f)/(str(i)+'.sqlite'),{})
   self.assertFalse(external.exists())
 def test_invalid_foreign_key_rows_do_not_pass_post_restore_checks(self):
  dirty=SQL.replace("(1,'PRIVATE_PARENT'","(1,'MISSING_PARENT'")
  with tempfile.TemporaryDirectory() as f:
   with self.assertRaises(sqlite3.Error):subject.restore(dirty.encode(),Path(f)/'bad.sqlite',expected())
 def test_empty_or_invalid_utf8_export_rejected(self):
  with tempfile.TemporaryDirectory() as f:
   for raw in (b'',b'\xff'):
    with self.assertRaises(ValueError):subject.restore(raw,Path(f)/'invalid.sqlite',{})
if __name__=='__main__':unittest.main()
