"""Source-only Gate 5/6 candidate for MUSITU Studio: fail-closed SQLite ledger.

IMPORTANT: This is an isolated engineering candidate, NOT a public endpoint,
provider budget certificate, Paynow ledger, horizontally distributed queue,
or permission to call a billed renderer. No live QA/Storage resources used.
"""
from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
import hashlib
import secrets
import sqlite3
import time


ACTIVE = frozenset(("QUEUED", "RUNNING", "CANCEL_REQUESTED", "NEEDS_REVIEW"))
TERMINAL = frozenset(("COMPLETED", "FAILED", "CANCELED"))
ALLOWED = ACTIVE | TERMINAL
MAX_ATTEMPTS = 2


class GateClosed(RuntimeError):
    pass


class Conflict(RuntimeError):
    pass


@dataclass(frozen=True)
class VerifiedProviderCap:
    """Must be sourced from authenticated provider control-plane evidence.

    Merely constructing this class is NOT a provider verification. Only a
    trusted, independently audited provider adapter may return one.
    """
    provider: str
    control_id: str
    monthly_cap_cents: int
    remaining_cents: int
    checked_unix: int
    hard_enforced: bool


class StudioG56Ledger:
    """One-writer SQLite prototype. Do not use across multiple hosted workers.

    For hosted operation replace SQLite with the separately reviewed Studio
    Durable Object/transactional store and preserve these invariants.
    """

    def __init__(self, db_path, *, provider_guard=None, authorization=None, now=None,
                 cost_verifier=None, termination_verifier=None, artifact_verifier=None):
        self.db_path = Path(db_path)
        self.provider_guard = provider_guard
        self.authorization = authorization
        self.cost_verifier = cost_verifier
        self.termination_verifier = termination_verifier
        self.artifact_verifier = artifact_verifier
        self.now = now or (lambda: int(time.time()))
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with self._connection() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS g56_control (
                  id INTEGER PRIMARY KEY CHECK(id=1),
                  killed INTEGER NOT NULL DEFAULT 1 CHECK(killed IN (0,1)),
                  changed_at INTEGER NOT NULL
                );
                INSERT OR IGNORE INTO g56_control(id,killed,changed_at) VALUES(1,1,0);
                CREATE TABLE IF NOT EXISTS g56_tenants (
                  tenant TEXT PRIMARY KEY,
                  daily_cents INTEGER NOT NULL CHECK(daily_cents>0),
                  monthly_cents INTEGER NOT NULL CHECK(monthly_cents>0),
                  max_active INTEGER NOT NULL CHECK(max_active BETWEEN 1 AND 5),
                  total_credit_units INTEGER NOT NULL CHECK(total_credit_units>=0)
                );
                CREATE TABLE IF NOT EXISTS g56_jobs (
                  id TEXT PRIMARY KEY,
                  tenant TEXT NOT NULL REFERENCES g56_tenants(tenant),
                  project TEXT NOT NULL,
                  submission_key TEXT NOT NULL,
                  payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
                  state TEXT NOT NULL CHECK(state IN
                    ('QUEUED','RUNNING','CANCEL_REQUESTED','NEEDS_REVIEW',
                     'COMPLETED','FAILED','CANCELED')),
                  reserved_cents INTEGER NOT NULL CHECK(reserved_cents>0),
                  charged_cents INTEGER,
                  credit_hold INTEGER NOT NULL CHECK(credit_hold>=0),
                  credit_charge INTEGER,
                  max_attempts INTEGER NOT NULL CHECK(max_attempts BETWEEN 1 AND 2),
                  attempts INTEGER NOT NULL DEFAULT 0,
                  current_fence TEXT,
                  lease_until INTEGER,
                  provider_call_id TEXT,
                  progress INTEGER NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
                  outcome_code TEXT,
                  created INTEGER NOT NULL,
                  updated INTEGER NOT NULL,
                  UNIQUE(tenant,submission_key)
                );
                CREATE INDEX IF NOT EXISTS g56_jobs_by_queue
                  ON g56_jobs(state,created,id);
                CREATE INDEX IF NOT EXISTS g56_jobs_by_tenant
                  ON g56_jobs(tenant,created);
                CREATE TABLE IF NOT EXISTS g56_events (
                  seq INTEGER PRIMARY KEY AUTOINCREMENT,
                  job_id TEXT NOT NULL REFERENCES g56_jobs(id),
                  at INTEGER NOT NULL,
                  event TEXT NOT NULL,
                  detail TEXT NOT NULL DEFAULT ''
                );
                CREATE TRIGGER IF NOT EXISTS g56_events_no_update
                  BEFORE UPDATE ON g56_events
                  BEGIN SELECT RAISE(ABORT,'AUDIT_IMMUTABLE'); END;
                CREATE TRIGGER IF NOT EXISTS g56_events_no_delete
                  BEFORE DELETE ON g56_events
                  BEGIN SELECT RAISE(ABORT,'AUDIT_IMMUTABLE'); END;
                CREATE TABLE IF NOT EXISTS g56_artifacts (
                  job_id TEXT NOT NULL REFERENCES g56_jobs(id),
                  filename TEXT NOT NULL,
                  sha256 TEXT NOT NULL CHECK(length(sha256)=64),
                  bytes INTEGER NOT NULL CHECK(bytes>0),
                  private_key TEXT NOT NULL UNIQUE,
                  PRIMARY KEY(job_id,filename)
                );
            """)

    @contextmanager
    def _connection(self):
        db = sqlite3.connect(str(self.db_path), timeout=10, isolation_level=None)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("PRAGMA busy_timeout=10000")
        try:
            yield db
        finally:
            db.close()

    @contextmanager
    def _write(self):
        with self._connection() as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                yield db
                db.commit()
            except BaseException:
                db.rollback()
                raise

    def _authorize(self, purpose):
        if self.authorization is None or self.authorization(purpose) is not True:
            raise GateClosed("INDEPENDENT_OPERATOR_AUTHORIZATION_REQUIRED")

    def _cap(self, minimum_cents=0):
        # This call MUST be independently bound to a real provider source.
        if self.provider_guard is None:
            raise GateClosed("PROVIDER_HARD_BUDGET_NOT_VERIFIED")
        cap = self.provider_guard()
        if not isinstance(cap, VerifiedProviderCap) or not cap.hard_enforced:
            raise GateClosed("PROVIDER_HARD_BUDGET_NOT_VERIFIED")
        if (cap.provider != "MODAL" or not cap.control_id or
                isinstance(cap.monthly_cap_cents, bool) or
                isinstance(cap.remaining_cents, bool) or
                not isinstance(cap.monthly_cap_cents, int) or
                not isinstance(cap.remaining_cents, int) or
                cap.monthly_cap_cents <= 0 or
                cap.remaining_cents < minimum_cents or
                abs(self.now() - cap.checked_unix) > 60):
            raise GateClosed("PROVIDER_BUDGET_STALE_OR_INSUFFICIENT")
        return cap

    def configure_tenant(self, tenant, *, daily_cents, monthly_cents,
                         max_active=1, total_credit_units=0):
        self._authorize("CONFIGURE_TENANT")
        if not tenant or len(tenant)>100 or not isinstance(tenant,str):
            raise ValueError("INVALID_TENANT")
        for field in (daily_cents,monthly_cents,max_active,total_credit_units):
            if isinstance(field,bool) or not isinstance(field,int):
                raise ValueError("INVALID_LIMIT")
        if (daily_cents<=0 or monthly_cents<daily_cents or
                not 1<=max_active<=5 or total_credit_units<0):
            raise ValueError("INVALID_LIMIT")
        with self._write() as db:
            if db.execute("SELECT 1 FROM g56_jobs WHERE tenant=? LIMIT 1",(tenant,)).fetchone():
                raise Conflict("QUOTA_CHANGE_REQUIRES_INDEPENDENT_RECONCILIATION")
            db.execute("""INSERT INTO g56_tenants VALUES(?,?,?,?,?)
                       ON CONFLICT(tenant) DO UPDATE SET
                       daily_cents=excluded.daily_cents,
                       monthly_cents=excluded.monthly_cents,
                       max_active=excluded.max_active,
                       total_credit_units=excluded.total_credit_units""",
                       (tenant,daily_cents,monthly_cents,max_active,total_credit_units))

    def set_emergency_stop(self, enabled=True):
        """Emergency stop may always be requested. Arming is separately gated."""
        if enabled is not True:
            self._authorize("ARM_COMPUTE")
            self._cap()
        with self._write() as db:
            db.execute("UPDATE g56_control SET killed=?,changed_at=? WHERE id=1",
                       (int(bool(enabled)),self.now()))

    def _admit_open(self, db, minimum_cents=0):
        if db.execute("SELECT killed FROM g56_control WHERE id=1").fetchone()[0]:
            raise GateClosed("STUDIO_COMPUTE_KILL_SWITCH_ON")
        return self._cap(minimum_cents)

    def _spend(self, db, tenant, since):
        row=db.execute("""SELECT
          COALESCE(SUM(CASE WHEN state IN ('QUEUED','RUNNING','CANCEL_REQUESTED',
                    'NEEDS_REVIEW') THEN reserved_cents
            ELSE COALESCE(charged_cents,0) END),0) AS cents
          FROM g56_jobs WHERE tenant=? AND created>=?""",(tenant,since)).fetchone()
        return row["cents"]

    def _credit_usage(self, db, tenant):
        row=db.execute("""SELECT COALESCE(SUM(
          CASE WHEN state IN ('QUEUED','RUNNING','CANCEL_REQUESTED','NEEDS_REVIEW')
            THEN credit_hold ELSE COALESCE(credit_charge,0) END),0) AS units
          FROM g56_jobs WHERE tenant=?""",(tenant,)).fetchone()
        return row["units"]

    @staticmethod
    def _day_and_month(unix):
        import datetime as dt
        day=dt.datetime.fromtimestamp(unix, dt.timezone.utc)
        d=int(dt.datetime(day.year,day.month,day.day,tzinfo=dt.timezone.utc).timestamp())
        m=int(dt.datetime(day.year,day.month,1,tzinfo=dt.timezone.utc).timestamp())
        return d,m

    @staticmethod
    def _validate_sha(text):
        if not isinstance(text,str) or len(text)!=64 or any(c not in "0123456789abcdef" for c in text):
            raise ValueError("INVALID_SHA256")

    def submit(self, *, tenant, project, submission_key, payload_sha256,
               max_cost_cents, credit_units, max_attempts=1):
        """Atomic reservation. Idempotency key scoped to tenant and payload."""
        self._validate_sha(payload_sha256)
        if not all(isinstance(s,str) and 1<=len(s)<=128 for s in (tenant,project,submission_key)):
            raise ValueError("INVALID_IDENTITY_OR_KEY")
        for n in (max_cost_cents,credit_units,max_attempts):
            if isinstance(n,bool) or not isinstance(n,int):
                raise ValueError("INVALID_RESERVATION")
        if max_cost_cents<=0 or credit_units<0 or not 1<=max_attempts<=MAX_ATTEMPTS:
            raise ValueError("INVALID_RESERVATION")
        now=self.now()
        with self._write() as db:
            old=db.execute("""SELECT * FROM g56_jobs WHERE tenant=? AND submission_key=?""",
                           (tenant,submission_key)).fetchone()
            if old:
                if any((old[k]!=v for k,v in (
                    ("project",project),("payload_sha256",payload_sha256),
                    ("reserved_cents",max_cost_cents),("credit_hold",credit_units),
                    ("max_attempts",max_attempts)))):
                    raise Conflict("IDEMPOTENCY_KEY_PAYLOAD_CONFLICT")
                return dict(old)
            cap=self._admit_open(db,max_cost_cents)
            limits=db.execute("SELECT * FROM g56_tenants WHERE tenant=?",(tenant,)).fetchone()
            if not limits:raise GateClosed("TENANT_NOT_APPROVED")
            day,month=self._day_and_month(now)
            active=db.execute("""SELECT COUNT(*) FROM g56_jobs WHERE tenant=? AND
                      state IN ('QUEUED','RUNNING','CANCEL_REQUESTED','NEEDS_REVIEW')""",
                      (tenant,)).fetchone()[0]
            if active>=limits["max_active"]:
                raise GateClosed("TENANT_CONCURRENCY_CAP")
            if (self._spend(db,tenant,day)+max_cost_cents>limits["daily_cents"] or
                self._spend(db,tenant,month)+max_cost_cents>limits["monthly_cents"]):
                raise GateClosed("TENANT_COST_CAP")
            if self._credit_usage(db,tenant)+credit_units>limits["total_credit_units"]:
                raise GateClosed("INSUFFICIENT_VERIFIED_CREDITS")
            jid="G56_"+secrets.token_hex(16)
            db.execute("""INSERT INTO g56_jobs(
              id,tenant,project,submission_key,payload_sha256,state,reserved_cents,
              credit_hold,max_attempts,created,updated)
              VALUES(?,?,?,?,?,'QUEUED',?,?,?,?,?)""",
              (jid,tenant,project,submission_key,payload_sha256,max_cost_cents,
               credit_units,max_attempts,now,now))
            self._event(db,jid,"RESERVED",f"cap_ref={cap.control_id[:64]}")
            return dict(db.execute("SELECT * FROM g56_jobs WHERE id=?",(jid,)).fetchone())

    def _event(self, db, jid, event, detail=""):
        db.execute("INSERT INTO g56_events(job_id,at,event,detail) VALUES(?,?,?,?)",
                   (jid,self.now(),event,str(detail)[:160]))

    def get(self, tenant, jid):
        with self._connection() as db:
            row=db.execute("SELECT * FROM g56_jobs WHERE tenant=? AND id=?",
                           (tenant,jid)).fetchone()
            if not row:raise GateClosed("JOB_NOT_IN_TENANT")
            return dict(row)

    def claim(self, *, worker, lease_seconds=120):
        """Fenced claim. A lost worker becomes NEEDS_REVIEW, never auto-retried."""
        if not isinstance(worker,str) or not 1<=len(worker)<=100:
            raise ValueError("INVALID_WORKER")
        if not isinstance(lease_seconds,int) or not 10<=lease_seconds<=600:
            raise ValueError("INVALID_LEASE")
        with self._write() as db:
            self._admit_open(db)
            row=db.execute("""SELECT * FROM g56_jobs WHERE state='QUEUED'
                           ORDER BY created,id LIMIT 1""").fetchone()
            if not row:return None
            # Require a fresh provider cap before each chargeable attempt.
            self._cap(row["reserved_cents"])
            if row["attempts"]>=row["max_attempts"]:
                raise Conflict("RETRY_CEILING_REACHED")
            fence=secrets.token_hex(24)
            now=self.now()
            db.execute("""UPDATE g56_jobs SET state='RUNNING',attempts=attempts+1,
                current_fence=?,lease_until=?,progress=1,updated=?
                WHERE id=? AND state='QUEUED'""",
                (fence,now+lease_seconds,now,row["id"]))
            self._event(db,row["id"],"ATTEMPT_CLAIMED",f"number={row['attempts']+1}")
            return {"job":dict(db.execute("SELECT * FROM g56_jobs WHERE id=?",(row["id"],)).fetchone()),
                    "fence":fence}

    def attach_provider_call(self, *, tenant, jid, fence, call_id):
        if not isinstance(call_id,str) or not 3<=len(call_id)<=150:
            raise ValueError("INVALID_PROVIDER_CALL")
        with self._write() as db:
            row=self._locked_job(db,tenant,jid,fence,("RUNNING",))
            if row["provider_call_id"] is not None:
                if row["provider_call_id"]==call_id:return
                raise Conflict("MULTIPLE_PROVIDER_CALLS_REJECTED")
            db.execute("""UPDATE g56_jobs SET provider_call_id=?,updated=? WHERE id=?""",
                       (call_id,self.now(),jid))
            self._event(db,jid,"PROVIDER_CALL_BOUND")

    def _locked_job(self, db, tenant, jid, fence, states):
        row=db.execute("SELECT * FROM g56_jobs WHERE tenant=? AND id=?",(tenant,jid)).fetchone()
        if not row:raise GateClosed("JOB_NOT_IN_TENANT")
        if row["state"] not in states or row["current_fence"]!=fence:
            raise Conflict("STALE_FENCE_OR_STATE")
        return row

    def heartbeat(self, *, tenant, jid, fence, percent):
        if isinstance(percent,bool) or not isinstance(percent,int) or not 1<=percent<=99:
            raise ValueError("PROGRESS_MUST_BE_OBSERVED_1_TO_99")
        with self._write() as db:
            row=self._locked_job(db,tenant,jid,fence,("RUNNING","CANCEL_REQUESTED"))
            if percent<row["progress"]:raise Conflict("PROGRESS_NOT_MONOTONIC")
            db.execute("UPDATE g56_jobs SET progress=?,lease_until=?,updated=? WHERE id=?",
                       (percent,max(row['lease_until'] or 0,self.now()+30),self.now(),jid))
            self._event(db,jid,"OBSERVED_PROGRESS",str(percent))

    def cancel(self, *, tenant, jid):
        with self._write() as db:
            row=db.execute("SELECT * FROM g56_jobs WHERE tenant=? AND id=?",(tenant,jid)).fetchone()
            if not row:raise GateClosed("JOB_NOT_IN_TENANT")
            if row["state"] in TERMINAL:return {"state":row["state"],"provider_cancel_required":False}
            if row["state"]=="QUEUED":
                db.execute("""UPDATE g56_jobs SET state='CANCELED',charged_cents=0,
                    credit_charge=0,updated=? WHERE id=?""",(self.now(),jid))
                self._event(db,jid,"CANCELED_BEFORE_DISPATCH")
                return {"state":"CANCELED","provider_cancel_required":False}
            db.execute("UPDATE g56_jobs SET state='CANCEL_REQUESTED',updated=? WHERE id=?",
                       (self.now(),jid))
            self._event(db,jid,"CANCEL_REQUESTED")
            return {"state":"CANCEL_REQUESTED","provider_cancel_required":True,
                    "provider_call_id":row["provider_call_id"]}

    def quarantine_stale(self):
        """Lease expiry is NOT proof provider work stopped or costs are zero."""
        with self._write() as db:
            rows=db.execute("""SELECT id FROM g56_jobs WHERE state IN ('RUNNING','CANCEL_REQUESTED')
                       AND lease_until<?""",(self.now(),)).fetchall()
            for row in rows:
                db.execute("""UPDATE g56_jobs SET state='NEEDS_REVIEW',
                              outcome_code='LEASE_EXPIRED_COST_UNKNOWN',updated=? WHERE id=?""",
                           (self.now(),row["id"]))
                self._event(db,row["id"],"RECONCILIATION_REQUIRED")
            return len(rows)

    def confirm_terminal(self, *, tenant, jid, fence, result, actual_cents,
                         charged_credit_units, provider_evidence, verified_artifacts=()):
        """Only trusted backend may call after *independently verified* provider billing.

        Do NOT expose actual_cents or verified_artifacts as public client input.
        Artifact objects must already exist privately and independently pass
        byte/sha/type/ownership verification before this atomic commit.
        """
        if result not in ("COMPLETED","FAILED","CANCELED"):
            raise ValueError("INVALID_TERMINAL_RESULT")
        if (self.cost_verifier is None or
                self.cost_verifier(tenant,jid,fence,result,actual_cents,
                                   charged_credit_units,provider_evidence) is not True):
            raise GateClosed("PROVIDER_COST_EVIDENCE_REQUIRED")
        for n in (actual_cents,charged_credit_units):
            if isinstance(n,bool) or not isinstance(n,int) or n<0:
                raise ValueError("INVALID_ACTUAL_COST")
        artifacts=list(verified_artifacts)
        if result=="COMPLETED" and set(a[0] for a in artifacts)!={
            "scene.blend","scene.glb","preview.png"}:
            raise GateClosed("VERIFIED_ARTIFACT_SET_INCOMPLETE")
        if result=="COMPLETED" and (self.artifact_verifier is None or
                self.artifact_verifier(tenant,jid,artifacts) is not True):
            raise GateClosed("INDEPENDENT_PRIVATE_ARTIFACT_PROOF_REQUIRED")
        if result!="COMPLETED" and artifacts:
            raise GateClosed("UNVERIFIED_TERMINAL_ASSETS")
        with self._write() as db:
            row=self._locked_job(db,tenant,jid,fence,("RUNNING","CANCEL_REQUESTED","NEEDS_REVIEW"))
            if row["state"]=="CANCEL_REQUESTED" and result=="COMPLETED":
                raise GateClosed("CANCELED_JOB_CANNOT_COMPLETE")
            if actual_cents>row["reserved_cents"] or charged_credit_units>row["credit_hold"]:
                raise GateClosed("PROVIDER_OVERSPEND_NEEDS_MANUAL_RECONCILIATION")
            if result=="COMPLETED":
                for name,sha,size,key in artifacts:
                    self._validate_sha(sha)
                    if (not isinstance(size,int) or not 1024<=size<=64*1024*1024 or
                         not isinstance(key,str) or not key.startswith(f"private/{tenant}/{jid}/") or
                         len(key)>350):
                        raise GateClosed("PRIVATE_ARTIFACT_INTEGRITY_MISMATCH")
                    db.execute("""INSERT INTO g56_artifacts VALUES(?,?,?,?,?)""",
                               (jid,name,sha,size,key))
            db.execute("""UPDATE g56_jobs SET state=?,charged_cents=?,credit_charge=?,
                      progress=?,outcome_code=?,updated=? WHERE id=?""",
                       (result,actual_cents,charged_credit_units,
                        100 if result=="COMPLETED" else row["progress"],
                        'PROVIDER_BILL_VERIFIED',self.now(),jid))
            self._event(db,jid,"TERMINAL_RECONCILED",result)
            return dict(db.execute("SELECT * FROM g56_jobs WHERE id=?",(jid,)).fetchone())

    def allow_retry_after_authoritative_stop(self, *, tenant, jid, fence, provider_proof):
        """Manual recovery; no retry on timeout or ambiguous dispatch alone."""
        if (self.termination_verifier is None or
                self.termination_verifier(tenant,jid,fence,provider_proof) is not True):
            raise GateClosed("INDEPENDENT_PROVIDER_TERMINATION_PROOF_REQUIRED")
        with self._write() as db:
            row=self._locked_job(db,tenant,jid,fence,("NEEDS_REVIEW",))
            self._admit_open(db,row["reserved_cents"])
            if row["attempts"]>=row["max_attempts"]:raise GateClosed("RETRY_CEILING_REACHED")
            db.execute("""UPDATE g56_jobs SET state='QUEUED',current_fence=NULL,
                provider_call_id=NULL,lease_until=NULL,progress=0,updated=? WHERE id=?""",
                (self.now(),jid))
            self._event(db,jid,"MANUAL_RETRY_AUTHORIZED")

    def mark_dispatch_uncertain(self, *, tenant, jid, fence):
        """Spawn timeout/HTTP uncertainty must block a second provider call."""
        with self._write() as db:
            self._locked_job(db,tenant,jid,fence,("RUNNING","CANCEL_REQUESTED"))
            db.execute("""UPDATE g56_jobs SET state='NEEDS_REVIEW',
                outcome_code='PROVIDER_DISPATCH_UNKNOWN',updated=? WHERE id=?""",
                (self.now(),jid))
            self._event(db,jid,"DISPATCH_AMBIGUOUS_NO_AUTO_RETRY")
