"""B15 S0: ephemeral PostgreSQL service is mandatory; no mocks or provider calls."""
import concurrent.futures, json, os, unittest, uuid
from datetime import datetime,timezone,timedelta
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding,PublicFormat
import psycopg
from durable_quota import Ledger,Denied,init_db,AUDIENCE

DSN=os.environ["B15_DATABASE_URL"]

def canonical(d):return json.dumps(d,sort_keys=True,separators=(",",":")).encode()

class NativePostgresQualification(unittest.TestCase):
  @classmethod
  def setUpClass(cls):
    with psycopg.connect(DSN) as c:init_db(c)
  def setUp(self):
    self.key=Ed25519PrivateKey.generate()
    self.pub=self.key.public_key().public_bytes(Encoding.PEM,PublicFormat.SubjectPublicKeyInfo)
    self.account="b15_"+uuid.uuid4().hex
    self.now=datetime.now(timezone.utc).replace(microsecond=0)
    self.day=self.now.date().isoformat()
    self.ledger=Ledger(lambda:psycopg.connect(DSN),self.pub)
  def signed(self, d):
    b=canonical(d);return b,self.key.sign(b)
  def attrs(self, kind):
    return dict(audience=AUDIENCE,kind=kind,account=self.account,day=self.day,epoch=1,
      issued=self.now.isoformat().replace("+00:00","Z"),expires=(self.now+timedelta(minutes=5)).isoformat().replace("+00:00","Z"))
  def policy(self,cap=12,epoch=1,revoked=False):
    return self.signed(dict(self.attrs("policy"),epoch=epoch,ceiling=cap,revoked=revoked))
  def grant(self,worker="a",cost=2,max_calls=12,epoch=1,gid=None):
    return self.signed(dict(self.attrs("grant"),epoch=epoch,workload=worker,
      grant_id=gid or uuid.uuid4().hex,cost=cost,max_calls=max_calls))
  def test_no_policy_denied(self):
    with self.assertRaises(Denied):self.ledger.reserve(*self.grant(),"op1")
  def test_signed_policy_reservation_and_idempotent_replay(self):
    self.ledger.apply_policy(*self.policy())
    b,s=self.grant(cost=3)
    a=self.ledger.reserve(b,s,"op1")
    c=self.ledger.reserve(b,s,"op1")
    self.assertFalse(a["replayed"]);self.assertTrue(c["replayed"])
    self.assertEqual(a["receipt"],c["receipt"])
    self.assertEqual(9,a["remaining"])
  def test_invalid_signature_and_scope(self):
    self.ledger.apply_policy(*self.policy())
    b,s=self.grant()
    with self.assertRaises(Denied):self.ledger.reserve(b,b"0"*64,"op1")
    d=json.loads(b);d["workload"]="other"
    with self.assertRaises(Denied):self.ledger.reserve(canonical(d),s,"op1")
  def test_per_grant_limit_and_account_cap(self):
    self.ledger.apply_policy(*self.policy(cap=5))
    b,s=self.grant(cost=2,max_calls=2)
    self.ledger.reserve(b,s,"op1");self.ledger.reserve(b,s,"op2")
    with self.assertRaises(Denied):self.ledger.reserve(b,s,"op3")
    with self.assertRaises(Denied):self.ledger.reserve(*self.grant("b",cost=2),"op4")
  def test_revocation_is_monotonic(self):
    self.ledger.apply_policy(*self.policy(cap=7))
    b,s=self.grant();self.ledger.reserve(b,s,"op1")
    self.ledger.apply_policy(*self.policy(cap=0,epoch=2,revoked=True))
    with self.assertRaises(Denied):self.ledger.reserve(b,s,"op2")
    with self.assertRaises(Denied):self.ledger.apply_policy(*self.policy(cap=0,epoch=3,revoked=False))
  def test_signed_budget_cannot_increase_same_day(self):
    self.ledger.apply_policy(*self.policy(cap=5))
    with self.assertRaises(Denied):self.ledger.apply_policy(*self.policy(cap=6,epoch=2))
  def test_replayed_operation_cannot_change_grant(self):
    self.ledger.apply_policy(*self.policy())
    self.ledger.reserve(*self.grant(gid="id1"),"op1")
    with self.assertRaises(Denied):self.ledger.reserve(*self.grant(gid="id2"),"op1")
  def test_boolean_amount_rejected(self):
    d=json.loads(self.policy()[0]);d["ceiling"]=True
    with self.assertRaises(Denied):self.ledger.apply_policy(*self.signed(d))
  def test_database_utc_day_denied(self):
    d=json.loads(self.policy()[0]);d["day"]=(self.now.date()-timedelta(days=1)).isoformat()
    with self.assertRaises(Denied):self.ledger.apply_policy(*self.signed(d))
  def test_native_parallel_postgresql_clients_one_budget(self):
    self.ledger.apply_policy(*self.policy(cap=17))
    grants=[self.grant(worker="w"+str(i),cost=2,max_calls=1) for i in range(24)]
    def act(i):
      try:return not self.ledger.reserve(*grants[i],"once")["replayed"]
      except Denied:return False
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as ex:results=list(ex.map(act,range(24)))
    self.assertEqual(8,sum(results))
    with psycopg.connect(DSN) as c:
      n=c.execute("SELECT spent FROM b15_accounts WHERE account=%s",(self.account,)).fetchone()[0]
    self.assertEqual(16,n)

  def test_distinct_broker_processes_share_one_postgres_budget(self):
    import multiprocessing
    self.ledger.apply_policy(*self.policy(cap=11))
    ctx=multiprocessing.get_context("fork")
    receipts=ctx.Queue()
    grants=[self.grant(worker="p"+str(i),cost=2,max_calls=1) for i in range(8)]
    def broker_child(i):
      # Separate process, separate PostgreSQL connection; never passes a session.
      broker=Ledger(lambda:psycopg.connect(DSN),self.pub)
      try:receipts.put((int(not broker.reserve(*grants[i],"unique")["replayed"]),"ADMITTED"))
      except Denied as e:receipts.put((0,str(e)))
    processes=[ctx.Process(target=broker_child,args=(i,)) for i in range(8)]
    for proc in processes:proc.start()
    for proc in processes:
      proc.join(18)
      self.assertFalse(proc.is_alive())
      self.assertEqual(0,proc.exitcode)
    outcomes=[receipts.get(timeout=2) for _ in processes]
    print("B15_MULTIPROCESS_ADMISSION_RECEIPTS="+str(outcomes),flush=True)
    self.assertEqual(5,sum(x[0] for x in outcomes))
    with psycopg.connect(DSN) as conn:
      spent=conn.execute("SELECT spent FROM b15_accounts WHERE account=%s",(self.account,)).fetchone()[0]
    self.assertEqual(10,spent)
  def test_sigkill_of_uncommitted_writer_does_not_burn_budget(self):
    import multiprocessing,os,signal
    self.ledger.apply_policy(*self.policy(cap=2))
    ctx=multiprocessing.get_context("fork")
    locked=ctx.Event()
    def pending_writer():
      with psycopg.connect(DSN) as conn:
        with conn.transaction():
          conn.execute("SELECT spent FROM b15_accounts WHERE account=%s FOR UPDATE",(self.account,))
          conn.execute("UPDATE b15_accounts SET spent=spent+2 WHERE account=%s",(self.account,))
          locked.set()
          while True: __import__("time").sleep(1)
    worker=ctx.Process(target=pending_writer);worker.start()
    try:
      self.assertTrue(locked.wait(8),"Postgres transaction not reached")
      os.kill(worker.pid,signal.SIGKILL)
      worker.join(8)
      self.assertFalse(worker.is_alive())
      self.assertNotEqual(0,worker.exitcode)
      result=self.ledger.reserve(*self.grant(cost=2),"after-dead-transaction")
      self.assertFalse(result["replayed"])
      self.assertEqual(0,result["remaining"])
    finally:
      if worker.is_alive():worker.kill();worker.join(2)

  def test_database_clock_read_must_happen_after_row_lock(self):
    import time
    self.ledger.apply_policy(*self.policy(cap=3))
    b,sig=self.grant(cost=2)
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
      with psycopg.connect(DSN) as owner:
        with owner.transaction():
          owner.execute("SELECT spent FROM b15_accounts WHERE account=%s FOR UPDATE",(self.account,))
          future=executor.submit(self.ledger.reserve,b,sig,"blocked-waiter")
          time.sleep(0.45)
          owner.execute("UPDATE b15_accounts SET last_seen=clock_timestamp() WHERE account=%s",(self.account,))
        # Commit releases the row lock, after last_seen has advanced.
      result=future.result(timeout=9)
    self.assertEqual(1,result["remaining"])
    self.assertFalse(result["replayed"])

if __name__=="__main__":unittest.main()
