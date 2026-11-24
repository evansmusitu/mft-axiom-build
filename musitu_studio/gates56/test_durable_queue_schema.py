"""Offline SQLite rehearsal of proposed isolated Durable Object G5/6 schema.

No Cloudflare deployment, Modal calls, billing, customer data, or QA mutations.
"""
import sqlite3
import tempfile
from pathlib import Path
import unittest

SQL = Path(__file__).with_name("durable_queue_schema.sql")


class DurableQueueSchemaTests(unittest.TestCase):
    def setUp(self):
        self.work = tempfile.TemporaryDirectory()
        self.addCleanup(self.work.cleanup)
        self.db = sqlite3.connect(str(Path(self.work.name)/"queue.db"),
                                  timeout=0.2, isolation_level=None)
        self.addCleanup(self.db.close)
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.executescript(SQL.read_text())
        for tenant in ("tenantA", "tenantB"):
            self.db.execute("""INSERT INTO g56_do_tenants
              (tenant,daily_cents,monthly_cents,max_active,total_credit_units)
              VALUES(?,150,450,2,10)""",(tenant,))

    def new_job(self, jid="G56_A", tenant="tenantA", key="submissionA"):
        self.db.execute("""INSERT INTO g56_do_jobs
          (id,tenant,project,submission_key,payload_sha256,state,
           reserved_cents,credit_hold,max_attempts,created,updated)
          VALUES(?,?,?,?,?,'QUEUED',60,3,2,1000,1000)""",
          (jid,tenant,"projectA",key,"a"*64))

    def test_separate_default_on_emergency_stop(self):
        self.assertEqual(self.db.execute(
            "SELECT killed FROM g56_do_control WHERE id=1").fetchone()[0],1)

    def test_idempotency_unique_per_tenant_not_global(self):
        self.new_job()
        with self.assertRaises(sqlite3.IntegrityError):
            self.new_job("G56_DUP","tenantA","submissionA")
        self.new_job("G56_OTHER","tenantB","submissionA")
        self.assertEqual(self.db.execute(
            "SELECT count(*) FROM g56_do_jobs").fetchone()[0],2)

    def test_unique_attempt_fence_and_provider_call_across_jobs(self):
        self.new_job()
        self.new_job("G56_B","tenantB","submissionB")
        self.db.execute("""INSERT INTO g56_do_attempts
          (job_id,attempt_no,fence,worker_id,provider_call_id,started)
          VALUES('G56_A',1,'fenceA','cpuA','fc-provider-unique',1001)""")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("""INSERT INTO g56_do_attempts
              (job_id,attempt_no,fence,worker_id,provider_call_id,started)
              VALUES('G56_B',1,'fenceB','cpuB','fc-provider-unique',1002)""")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("""INSERT INTO g56_do_attempts
              (job_id,attempt_no,fence,worker_id,started)
              VALUES('G56_B',1,'fenceA','cpuB',1002)""")

    def test_terminal_states_are_not_reopened(self):
        self.new_job()
        self.db.execute("UPDATE g56_do_jobs SET state='CANCELED' WHERE id='G56_A'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE g56_do_jobs SET state='QUEUED' WHERE id='G56_A'")

    def test_completed_requires_cost_and_exactly_three_verified_artifacts(self):
        self.new_job()
        self.db.execute("UPDATE g56_do_jobs SET state='RUNNING' WHERE id='G56_A'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE g56_do_jobs SET state='COMPLETED' WHERE id='G56_A'")
        for name in ("scene.blend","scene.glb","preview.png"):
            self.db.execute("""INSERT INTO g56_do_artifacts
              (job_id,filename,sha256,bytes,private_key)
              VALUES(?,?,?,?,?)""",
              ("G56_A",name,"b"*64,2048,"private/tenantA/G56_A/"+name))
        self.db.execute("""UPDATE g56_do_jobs
          SET state='COMPLETED',charged_cents=31,credit_charge=2
          WHERE id='G56_A'""")
        self.assertEqual(self.db.execute(
            "SELECT state FROM g56_do_jobs WHERE id='G56_A'").fetchone()[0],
            "COMPLETED")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("DELETE FROM g56_do_artifacts WHERE job_id='G56_A'")

    def test_audit_event_immutable(self):
        self.new_job()
        self.db.execute("""INSERT INTO g56_do_events(job_id,at,event,detail)
          VALUES('G56_A',1000,'RESERVED','')""")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE g56_do_events SET detail='changed' WHERE job_id='G56_A'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("DELETE FROM g56_do_events WHERE job_id='G56_A'")

    def test_attempt_ceiling_and_negative_budget_rejected(self):
        self.new_job()
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE g56_do_jobs SET attempts=3 WHERE id='G56_A'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE g56_do_jobs SET charged_cents=61 WHERE id='G56_A'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE g56_do_jobs SET credit_charge=4 WHERE id='G56_A'")

    def test_financial_reservation_cannot_mutate_after_admission(self):
        """Changing the reserved ceiling or credit hold invalidates job economics."""
        self.new_job()
        for column,value in (
            ("reserved_cents", 100),
            ("credit_hold", 9),
            ("payload_sha256", "c"*64),
            ("tenant", "tenantB"),
            ("submission_key", "changed-idempotency"),
            ("max_attempts", 1),
        ):
            with self.subTest(column=column):
                with self.assertRaisesRegex(sqlite3.IntegrityError,
                                            "G56_RESERVATION_IMMUTABLE"):
                    self.db.execute(
                        f"UPDATE g56_do_jobs SET {column}=? WHERE id='G56_A'",
                        (value,)
                    )
        original=self.db.execute(
            "SELECT reserved_cents,credit_hold,max_attempts FROM g56_do_jobs WHERE id='G56_A'"
        ).fetchone()
        self.assertEqual(original, (60,3,2))

    def test_terminal_cost_and_credit_cannot_change_after_reconciliation(self):
        """A completed job must not be billed a second time via row updates."""
        self.new_job()
        self.db.execute("UPDATE g56_do_jobs SET state='FAILED', charged_cents=12, credit_charge=1 WHERE id='G56_A'")
        for column,value in (
            ("charged_cents", 18),
            ("credit_charge", 2),
            ("charged_cents", None),
            ("credit_charge", None),
            ("outcome_code", "post-settlement-edit"),
        ):
            with self.subTest(column=column,value=value):
                with self.assertRaisesRegex(sqlite3.IntegrityError,
                                            "G56_TERMINAL_ECONOMICS_IMMUTABLE"):
                    self.db.execute(
                        f"UPDATE g56_do_jobs SET {column}=? WHERE id='G56_A'",
                        (value,)
                    )
        row=self.db.execute(
            "SELECT charged_cents,credit_charge FROM g56_do_jobs WHERE id='G56_A'"
        ).fetchone()
        self.assertEqual(row,(12,1))

    def test_schema_persists_only_modal_t4_gpu_jobs(self):
        self.new_job()
        gpu=self.db.execute(
            "SELECT device,gpu_type FROM g56_do_jobs WHERE id='G56_A'"
        ).fetchone()
        self.assertEqual(gpu, ("GPU","T4"))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "UPDATE g56_do_jobs SET device='CPU' WHERE id='G56_A'"
            )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "UPDATE g56_do_jobs SET gpu_type='A100' WHERE id='G56_A'"
            )
        self.assertEqual(self.db.execute(
            "SELECT device,gpu_type FROM g56_do_jobs WHERE id='G56_A'"
        ).fetchone(),("GPU","T4"))

    def test_schema_allows_modal_cpu_and_gpu_but_forbids_mixed_hardware(self):
        # CPU selected intentionally; it must not implicitly allocate a GPU.
        self.db.execute("""INSERT INTO g56_do_jobs
          (id,tenant,project,submission_key,payload_sha256,device,gpu_type,
           state,reserved_cents,credit_hold,max_attempts,created,updated)
          VALUES('CPU_TEST','tenantA','projectA','cpu-mode',?,'CPU',NULL,
                 'QUEUED',60,3,2,1000,1000)""",("a"*64,))
        self.assertEqual(self.db.execute(
            "SELECT device,gpu_type FROM g56_do_jobs WHERE id='CPU_TEST'"
        ).fetchone(),("CPU",None))
        self.new_job("GPU_TEST",key="gpu-mode")
        self.assertEqual(self.db.execute(
            "SELECT device,gpu_type FROM g56_do_jobs WHERE id='GPU_TEST'"
        ).fetchone(),("GPU","T4"))
        for device,gpu_type in (("CPU","T4"),("GPU",None),("GPU","A100")):
            with self.subTest(device=device,gpu_type=gpu_type):
                with self.assertRaises(sqlite3.IntegrityError):
                    self.db.execute("""INSERT INTO g56_do_jobs
                      (id,tenant,project,submission_key,payload_sha256,
                       device,gpu_type,state,reserved_cents,credit_hold,
                       max_attempts,created,updated)
                      VALUES(?,?, 'projectA', ?, ?,?,?,'QUEUED',
                             60,3,2,1000,1000)""",
                      ("BAD_"+str(gpu_type), "tenantB",
                       "bad-"+str(device)+str(gpu_type), "b"*64,
                       device,gpu_type))

    def test_single_writer_lock_serializes_claims(self):
        other=sqlite3.connect(str(Path(self.work.name)/"queue.db"),
                              timeout=0.05,isolation_level=None)
        try:
            self.db.execute("BEGIN IMMEDIATE")
            with self.assertRaises(sqlite3.OperationalError):
                other.execute("BEGIN IMMEDIATE")
            self.db.execute("ROLLBACK")
            other.execute("BEGIN IMMEDIATE")
            other.execute("ROLLBACK")
        finally:
            other.close()


if __name__ == "__main__":
    unittest.main()
