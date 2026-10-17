"""Durable single-tenant SQLite queue with explicit approval and audit trail.

The queue is SQLite-backed and intentionally limited to one local approved host.
No public GPU allocation, multi-tenant access, or horizontal scaling is implied.
"""
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import sqlite3
import time
from contextlib import contextmanager, closing

from .job_schema import validate_job

TERMINAL = frozenset(('VERIFIED', 'FAILED', 'CANCELED'))

class Conflict(Exception):
    pass

class Missing(Exception):
    pass

class StudioStore:
    def __init__(self, root, csrf_key=None):
        self.csrf_key = csrf_key or secrets.token_bytes(32)
        if isinstance(self.csrf_key, str): self.csrf_key = self.csrf_key.encode()
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        for name in ('jobs', 'runs'):
            p = self.root / name
            p.mkdir(mode=0o700, exist_ok=True)
        self.db_path = self.root / 'studio.sqlite3'
        self._setup()

    def _db(self):
        db = sqlite3.connect(str(self.db_path), timeout=20, isolation_level=None)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        db.execute('PRAGMA busy_timeout=20000')
        return db

    @contextmanager
    def transaction(self):
        with closing(self._db()) as db:
            db.execute('BEGIN IMMEDIATE')
            try:
                yield db
                db.commit()
            except BaseException:
                db.rollback()
                raise

    def _setup(self):
        with closing(self._db()) as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.executescript('''
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY, name TEXT NOT NULL,
                created INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id),
                state TEXT NOT NULL CHECK (state IN
                    ('DRAFT','QUEUED','RUNNING','VERIFIED','FAILED','CANCELED')),
                job_sha256 TEXT NOT NULL, input_path TEXT NOT NULL,
                created INTEGER NOT NULL, approved INTEGER,
                started INTEGER, completed INTEGER, failure TEXT,
                execution_receipt_sha256 TEXT,
                FOREIGN KEY(project_id) REFERENCES projects(id));
            CREATE INDEX IF NOT EXISTS jobs_by_state ON jobs(state,approved);
            CREATE TABLE IF NOT EXISTS sessions (
                digest TEXT PRIMARY KEY, csrf_digest TEXT NOT NULL,
                created INTEGER NOT NULL, expires INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS audit (
                seq INTEGER PRIMARY KEY AUTOINCREMENT,
                ts INTEGER NOT NULL, event TEXT NOT NULL, subject TEXT NOT NULL,
                detail TEXT NOT NULL);
            ''')

    def audit(self, event, subject, detail=''):
        with self.transaction() as db:
            self._audit(db, event, subject, detail)

    def _audit(self, db, event, subject, detail=''):
        db.execute('INSERT INTO audit(ts,event,subject,detail) VALUES(?,?,?,?)',
                   (int(time.time()),event,subject,str(detail)[:250]))

    def create_project(self, name):
        if not isinstance(name, str) or not 1 <= len(name) <= 75 or not name.strip():
            raise ValueError('Project name must be 1 to 75 characters')
        if any(ord(c) < 32 or ord(c) == 127 for c in name):
            raise ValueError('Project name includes control characters')
        pid = 'P_' + secrets.token_hex(9)
        now = int(time.time())
        with self.transaction() as db:
            db.execute('INSERT INTO projects VALUES(?,?,?)',(pid,name.strip(),now))
            self._audit(db,'project.created',pid)
        return self.project(pid)

    def project(self, pid):
        with closing(self._db()) as db:
            row = db.execute('SELECT * FROM projects WHERE id=?',(pid,)).fetchone()
        if row is None: raise Missing('Project not found')
        return dict(row)

    def projects(self):
        with closing(self._db()) as db:
            return [dict(r) for r in db.execute('SELECT * FROM projects ORDER BY created DESC,id DESC LIMIT 200')]

    def create_job(self, project_id, specification):
        self.project(project_id)
        if type(specification) is not dict:
            raise ValueError('Job specification must be JSON object')
        # IDs are issued by this server. Ignore client-supplied IDs only by rejecting them.
        if 'job_id' in specification:
            raise ValueError('job_id is server-assigned; remove this field')
        jid = 'J_' + secrets.token_hex(12)
        job = dict(specification)
        job['job_id'] = jid
        validate_job(job)
        payload = (json.dumps(job, separators=(',', ':'), ensure_ascii=True, sort_keys=True)+'\n').encode('utf-8')
        if len(payload) > 64*1024: raise ValueError('Job too large')
        checksum = hashlib.sha256(payload).hexdigest()
        target = self.root/'jobs'/f'{jid}.json'
        fd = os.open(target, os.O_WRONLY|os.O_CREAT|os.O_EXCL, 0o600)
        try:
            with os.fdopen(fd, 'wb') as handle:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            with self.transaction() as db:
                existing = db.execute("SELECT COUNT(*) FROM jobs WHERE state IN ('DRAFT','QUEUED','RUNNING')").fetchone()[0]
                if existing >= 100: raise Conflict('Queue admission cap is 100 jobs')
                db.execute('''INSERT INTO jobs(id,project_id,state,job_sha256,input_path,created)
                              VALUES(?,?,?,?,?,?)''', (jid,project_id,'DRAFT',checksum,str(target),int(time.time())))
                self._audit(db,'job.drafted',jid,checksum)
        except BaseException:
            target.unlink(missing_ok=True)
            raise
        return self.job(jid)

    def job(self, jid):
        with closing(self._db()) as db:
            row = db.execute('SELECT * FROM jobs WHERE id=?',(jid,)).fetchone()
        if row is None: raise Missing('Job not found')
        return dict(row)

    def jobs(self, project_id=None):
        with closing(self._db()) as db:
            if project_id:
                cur=db.execute('SELECT * FROM jobs WHERE project_id=? ORDER BY created DESC,id DESC LIMIT 200',(project_id,))
            else:
                cur=db.execute('SELECT * FROM jobs ORDER BY created DESC,id DESC LIMIT 200')
            return [dict(r) for r in cur]

    def approve(self,jid):
        with self.transaction() as db:
            row=db.execute('SELECT state,input_path,job_sha256 FROM jobs WHERE id=?',(jid,)).fetchone()
            if not row: raise Missing('Job not found')
            if row['state']!='DRAFT': raise Conflict('Only DRAFT jobs can be approved')
            actual=hashlib.sha256(Path(row['input_path']).read_bytes()).hexdigest()
            if actual!=row['job_sha256']:raise Conflict('Input digest changed: approval refused')
            now=int(time.time())
            db.execute("UPDATE jobs SET state='QUEUED',approved=? WHERE id=? AND state='DRAFT'",(now,jid))
            self._audit(db,'job.approved',jid,actual)
        return self.job(jid)

    def cancel(self,jid):
        with self.transaction() as db:
            row=db.execute('SELECT state FROM jobs WHERE id=?',(jid,)).fetchone()
            if not row: raise Missing('Job not found')
            if row['state'] not in ('DRAFT','QUEUED'):raise Conflict('Only DRAFT or QUEUED jobs can be canceled')
            db.execute("UPDATE jobs SET state='CANCELED',completed=? WHERE id=?",(int(time.time()),jid))
            self._audit(db,'job.canceled',jid)
        return self.job(jid)

    def claim(self):
        with self.transaction() as db:
            row=db.execute("SELECT * FROM jobs WHERE state='QUEUED' AND approved IS NOT NULL ORDER BY approved,id LIMIT 1").fetchone()
            if row is None:return None
            db.execute("UPDATE jobs SET state='RUNNING',started=? WHERE id=? AND state='QUEUED'",(int(time.time()),row['id']))
            self._audit(db,'job.claimed',row['id'])
            return dict(db.execute('SELECT * FROM jobs WHERE id=?',(row['id'],)).fetchone())

    def finish(self,jid,success,receipt_hash=None,failure=''):
        with self.transaction() as db:
            row=db.execute('SELECT state FROM jobs WHERE id=?',(jid,)).fetchone()
            if not row:raise Missing('Job not found')
            if row['state']!='RUNNING':raise Conflict('Only RUNNING jobs can finish')
            state='VERIFIED' if success else 'FAILED'
            db.execute('''UPDATE jobs SET state=?, completed=?, failure=?, execution_receipt_sha256=? WHERE id=?''',
                       (state,int(time.time()),str(failure)[:250] or None,receipt_hash,jid))
            self._audit(db,'job.'+state.lower(),jid,receipt_hash or failure)
        return self.job(jid)

    def recover_interrupted(self):
        with self.transaction() as db:
            rows=db.execute("SELECT id FROM jobs WHERE state='RUNNING'").fetchall()
            for r in rows:
                db.execute("UPDATE jobs SET state='FAILED',failure='INTERRUPTED_WORKER_REQUIRES_NEW_JOB',completed=? WHERE id=?",
                           (int(time.time()),r['id']))
                self._audit(db,'job.interrupted',r['id'])
        return len(rows)

    def session_create(self):
        token=secrets.token_urlsafe(40)
        csrf=self.session_csrf(token)
        now=int(time.time())
        d=hashlib.sha256(token.encode()).hexdigest()
        c=hashlib.sha256(csrf.encode()).hexdigest()
        with self.transaction() as db:
            db.execute('DELETE FROM sessions WHERE expires < ?', (now,))
            db.execute('INSERT INTO sessions VALUES(?,?,?,?)',(d,c,now,now+8*3600))
            self._audit(db,'session.created','admin')
        return token,csrf

    def session_check(self,token,csrf=None):
        if not token or not isinstance(token,str):return False
        d=hashlib.sha256(token.encode()).hexdigest()
        with closing(self._db()) as db:
            row=db.execute('SELECT csrf_digest,expires FROM sessions WHERE digest=?',(d,)).fetchone()
        if row is None or row['expires'] <= int(time.time()):return False
        if csrf is not None:
            if not isinstance(csrf,str):return False
            return secrets.compare_digest(row['csrf_digest'],hashlib.sha256(csrf.encode()).hexdigest())
        return True

    def session_csrf(self,token):
        return hmac.new(self.csrf_key,token.encode(),hashlib.sha256).hexdigest()

    def session_delete(self,token):
        d=hashlib.sha256(token.encode()).hexdigest()
        with self.transaction() as db:
            db.execute('DELETE FROM sessions WHERE digest=?',(d,))
            self._audit(db,'session.revoked','admin')

    def audit_log(self):
        with closing(self._db()) as db:
            return [dict(r) for r in db.execute('SELECT * FROM audit ORDER BY seq DESC LIMIT 200')]
