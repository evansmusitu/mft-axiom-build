"""Read-only SQLite capture must locate exact Workerd-equivalent table shapes.
These sqlite fixture tests do NOT substitute for running real local workerd.
"""
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from storage import capture
from evidence import JoinDenied
from test_evidence import valid

class StorageCaptureCases(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.root=Path(self.temp.name)
        _,_,_,journal,quota=valid()
        db1=sqlite3.connect(self.root/'j.sqlite')
        db1.execute('CREATE TABLE b22_dispatch ('+', '.join(f'{x} TEXT' for x in journal[0])+')')
        for row in journal:db1.execute('INSERT INTO b22_dispatch VALUES('+','.join('?' for _ in row)+')',list(row.values()))
        db1.commit();db1.close()
        db2=sqlite3.connect(self.root/'q.sqlite')
        db2.execute('CREATE TABLE reservations ('+', '.join(f'{x} TEXT' for x in quota[0])+')')
        for row in quota:db2.execute('INSERT INTO reservations VALUES('+','.join('?' for _ in row)+')',list(row.values()))
        db2.commit();db2.close()
    def tearDown(self):self.temp.cleanup()
    def test_exact_two_disjoint_sqlite_stores(self):
        j,q,_=capture(self.root)
        self.assertEqual((len(j),len(q)),(6,6))
    def test_missing_persisted_sqlite_file_denied(self):
        (self.root/'q.sqlite').unlink()
        with self.assertRaises(JoinDenied):capture(self.root)
    def test_duplicate_journal_file_denied(self):
        (self.root/'jcopy.sqlite').write_bytes((self.root/'j.sqlite').read_bytes())
        with self.assertRaises(JoinDenied):capture(self.root)
    def test_truncated_quota_denied(self):
        db=sqlite3.connect(self.root/'q.sqlite');db.execute('DELETE FROM reservations WHERE request_id=(SELECT request_id FROM reservations LIMIT 1)');db.commit();db.close()
        with self.assertRaises(JoinDenied):capture(self.root)
    def test_nonsqlite_file_ignored(self):
        (self.root/'note.txt').write_text('not sqlite')
        self.assertEqual(len(capture(self.root)[0]),6)
    def test_symlink_ignored(self):
        (self.root/'link.sqlite').symlink_to(self.root/'j.sqlite')
        self.assertEqual(len(capture(self.root)[0]),6)
if __name__=='__main__':unittest.main()
