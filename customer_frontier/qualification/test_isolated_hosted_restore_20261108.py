import unittest
import isolated_hosted_restore_20261108 as m

SQL='''PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE "parent" ("id" TEXT PRIMARY KEY, "tenant" TEXT NOT NULL);
CREATE TABLE "child" ("id" TEXT PRIMARY KEY, "parent_id" TEXT NOT NULL, "tenant" TEXT NOT NULL, FOREIGN KEY ("parent_id","tenant") REFERENCES "parent"("id","tenant"));
INSERT INTO "child" ("id","parent_id","tenant") VALUES ('child01','p01','t01');
CREATE UNIQUE INDEX "ix_parent_tenant" ON "parent" ("id","tenant");
INSERT INTO "parent" ("id","tenant") VALUES ('p01','t01');
CREATE TRIGGER "t_child" AFTER INSERT ON "child"
BEGIN
  SELECT 1;
END;
'''
class ExactRestoreContract(unittest.TestCase):
    def test_foreign_key_enforced_restore_requires_index_before_rows(self):
        order,classes=m.reorder_sql(SQL,strict=False)
        self.assertEqual({k:len(v) for k,v in classes.items()},
                         {'PRAGMA':1,'TABLE':2,'INDEX':1,'INSERT':2,'TRIGGER':1})
        self.assertLess(order.index('CREATE UNIQUE INDEX'),order.index('INSERT INTO'))
        out=m.offline_fkreplay(order,expected_tables=2,expected_rows=2)
        self.assertTrue(out['foreign_keys_on'])
        self.assertEqual(out['integrity'],'ok')
        self.assertEqual(out['foreign_key_violations'],0)

    def test_original_interleaved_dump_not_safe_in_fk_enforced_sqlite(self):
        import sqlite3
        db=sqlite3.connect(':memory:')
        db.execute('PRAGMA foreign_keys=ON')
        with self.assertRaises(sqlite3.DatabaseError):
            db.executescript('BEGIN;\n'+SQL+'\nCOMMIT;')
        db.close()

    def test_rejects_unknown_statement_and_incomplete_sql(self):
        with self.assertRaisesRegex(m.Rejected,'UNKNOWN_DUMP_SQL_STATEMENT'):
            m.reorder_sql(SQL+'DROP TABLE "parent";\n',strict=False)
        with self.assertRaisesRegex(m.Rejected,'INCOMPLETE_SQL_STATEMENT'):
            m.reorder_sql(SQL+'INSERT INTO not_a_table VALUES(',strict=False)

    def test_rejects_unexpected_foreign_existing_catalog(self):
        allowed=[{'type':'table','name':'_cf_KV','tbl_name':'_cf_KV','sql':'CREATE TABLE _cf_KV(id TEXT)'}]
        self.assertTrue(m.checked_target_empty(allowed))
        with self.assertRaisesRegex(m.Rejected,'TARGET_NOT_EMPTY_OR_FOREIGN_SCHEMA'):
            m.checked_target_empty(allowed+[{'type':'table','name':'users','tbl_name':'users','sql':'CREATE TABLE users(id TEXT)'}])

    def test_prevents_forged_source_and_cross_account_target(self):
        with self.assertRaisesRegex(m.Rejected,'SOURCE_CATALOG_DRIFT'):
            m.checked_source_catalog([])
        with self.assertRaisesRegex(m.Rejected,'CROSS_ACCOUNT_RESOURCE_NOT_ALLOWED'):
            m.endpoint(m.SOURCE_ACCOUNT,m.TARGET_DB,'/import')
        with self.assertRaisesRegex(m.Rejected,'API_SUFFIX_NOT_ALLOWED'):
            m.endpoint(m.TARGET_ACCOUNT,m.TARGET_DB,'/delete')

    def test_guarded_query_reader_rejects_all_mutations(self):
        for sql in ('DELETE FROM customer', 'DROP TABLE work', 'SELECT * FROM "unexpected"', 'PRAGMA table_info("customer")'):
            with self.assertRaisesRegex(m.Rejected,'UNADMITTED_SQL'):
                m.sql_query(m.SOURCE_ACCOUNT,m.SOURCE_DB,'unused',sql)
        self.assertFalse(m.READ_BUDGET>100)

    def test_source_and_target_ids_distinct_and_archive_pin(self):
        self.assertNotEqual(m.SOURCE_ACCOUNT,m.TARGET_ACCOUNT)
        self.assertNotEqual(m.SOURCE_DB,m.TARGET_DB)
        self.assertEqual(m.ARCHIVED_SQL_SHA,'1daa973a46c012f9c61b36814bf339fe93ae374e418b7938bb86c36f1dcde627')
        self.assertEqual(m.REORDERED_SQL_SHA,'84fc058d1ae5986b15c996449827b05af962ad0483f47a3b14655be9a90c1d53')
        self.assertEqual(m.ARCHIVED_SQL_SIZE,28985)

if __name__=='__main__':unittest.main()
