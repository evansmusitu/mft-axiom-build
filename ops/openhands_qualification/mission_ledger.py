"""S0 local engineering mission coordination. NOT a security witness or release gate.

Actual OpenHands inference/GitHub mutations must occur only in separately governed
providers after operation-scoped approval; this module does not perform either.
"""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import stat
import time
from contextlib import contextmanager

class LedgerDenied(ValueError):pass
class RecoveryHold(LedgerDenied):pass

_DIGEST=re.compile(r'^[0-9a-f]{64}$')
_ID=re.compile(r'^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,99}$')
_SCHEMA='musitu.axiom.openhands.mission.s0.v1'
_FIELDS={'schema','tenant_id','work_id','workload_identity_id','request_sha256','risk_class','production_authority'}

def _check(req):
    if type(req) is not dict or set(req)!=_FIELDS:raise LedgerDenied('exact mission request required')
    if req['schema']!=_SCHEMA or req['risk_class']!='S0' or req['production_authority'] is not False:
        raise LedgerDenied('S0 nonproduction only')
    for key in ('tenant_id','work_id','workload_identity_id'):
        if type(req[key]) is not str or not _ID.fullmatch(req[key]) or '..' in req[key]:
            raise LedgerDenied('invalid operation identity')
    if type(req['request_sha256']) is not str or not _DIGEST.fullmatch(req['request_sha256']):
        raise LedgerDenied('invalid request digest')
    return hashlib.sha256(json.dumps(req,sort_keys=True,separators=(',',':')).encode()).hexdigest()

class MissionLedger:
    def __init__(self,path,*,max_active=4,max_per_tenant=None,ttl_seconds=120,clock=time.time):
        if max_per_tenant is None:max_per_tenant=min(max_active,2)
        self.path=Path(path)
        self.anchor=Path(str(self.path)+'.local-anchor')
        self.lock=Path(str(self.path)+'.lock')
        if (not self.path.is_absolute() or type(max_active) is not int or not 1<=max_active<=16 or
            type(max_per_tenant) is not int or not 1<=max_per_tenant<=max_active or
            type(ttl_seconds) is not int or not 1<=ttl_seconds<=3600 or not callable(clock)):
            raise LedgerDenied('invalid ledger configuration')
        self.max_active=max_active;self.max_per_tenant=max_per_tenant;self.ttl=ttl_seconds;self.clock=clock

    def _now(self):
        now=self.clock()
        if type(now) not in (int,float) or not 0<=now<float('inf'):
            raise LedgerDenied('invalid local clock')
        return float(now)

    def _check_private(self,path):
        if path.is_symlink():raise LedgerDenied('symlink ledger state forbidden')
        try:s=path.stat()
        except FileNotFoundError:raise RecoveryHold('required ledger state is missing') from None
        if not stat.S_ISREG(s.st_mode) or s.st_uid!=os.getuid() or stat.S_IMODE(s.st_mode)!=0o600:
            raise LedgerDenied('ledger state permissions invalid')

    @contextmanager
    def _transaction(self):
        try:
            parent=self.path.parent.stat()
            if not stat.S_ISDIR(parent.st_mode) or parent.st_uid!=os.getuid() or parent.st_mode&0o022:
                raise LedgerDenied('ledger parent must be owner-private')
            if self.lock.is_symlink():raise LedgerDenied('symlink lock forbidden')
            fd=os.open(self.lock,os.O_RDWR|os.O_CREAT|getattr(os,'O_NOFOLLOW',0),0o600)
            try:
                self._check_private(self.lock)
                fcntl.flock(fd,fcntl.LOCK_EX)
                exists_db=self.path.exists() or self.path.is_symlink()
                exists_anchor=self.anchor.exists() or self.anchor.is_symlink()
                if exists_db!=exists_anchor:raise RecoveryHold('ledger/anchor divergence: manual recovery required')
                if not exists_db:
                    # A missing lock implies no prior observable state. Loss of ALL three
                    # files bypasses this local-only marker; NOT an independent witness.
                    con=sqlite3.connect(self.path,isolation_level=None,timeout=15)
                    os.chmod(self.path,0o600)
                    con.execute('PRAGMA journal_mode=DELETE')
                    con.execute('PRAGMA synchronous=FULL')
                    con.execute('BEGIN IMMEDIATE')
                    con.execute('CREATE TABLE IF NOT EXISTS missions (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, work TEXT NOT NULL, workload TEXT NOT NULL, request_sha TEXT UNIQUE NOT NULL, binding_sha TEXT NOT NULL, state TEXT NOT NULL, expires REAL NOT NULL, output_sha TEXT)')
                    con.execute('CREATE UNIQUE INDEX IF NOT EXISTS unique_work ON missions(tenant,work)')
                    con.commit();con.close()
                    x=os.open(self.anchor,os.O_WRONLY|os.O_CREAT|os.O_EXCL|getattr(os,'O_NOFOLLOW',0),0o600)
                    os.write(x,b'LOCAL_S0_ONLY_NOT_ANTIROLLBACK\n');os.fsync(x);os.close(x)
                self._check_private(self.path);self._check_private(self.anchor)
                con=sqlite3.connect(self.path,isolation_level=None,timeout=15)
                con.execute('PRAGMA busy_timeout=15000')
                con.execute('PRAGMA synchronous=FULL')
                con.execute('BEGIN IMMEDIATE')
                try:
                    yield con
                    con.commit()
                except BaseException:
                    con.rollback();raise
                finally:con.close()
            finally:
                fcntl.flock(fd,fcntl.LOCK_UN);os.close(fd)
        except (RecoveryHold,LedgerDenied):raise
        except (OSError,sqlite3.Error) as e:
            raise RecoveryHold('ledger operation failed closed') from e

    def _receipt(self,row):
        return {'schema':'musitu.axiom.openhands.mission-local-receipt.v1','mission_id':row[0],
                'tenant_id':row[1],'work_id':row[2],'workload_identity_id':row[3],
                'state':row[6],'result_sha256':row[8],
                'provider_dispatch_allowed':False,'production_authority':False,
                'independent_verifier':'NOT_PROVEN','external_action_executed':'NOT_PROVEN'}

    def admit(self,request):
        binding=_check(request);now=self._now()
        with self._transaction() as con:
            old=con.execute('SELECT * FROM missions WHERE tenant=? AND work=?',(request['tenant_id'],request['work_id'])).fetchone()
            if old:
                if old[5]!=binding:raise LedgerDenied('conflicting mission identity')
                if now>=old[7] or old[6]=='RECOVERY_HOLD':
                    con.execute("UPDATE missions SET state='RECOVERY_HOLD' WHERE id=?",(old[0],))
                    # Must commit hold before throwing, without rollback.
                    con.commit()
                    raise RecoveryHold('expired/ambiguous mission requires independent recovery')
                if old[6]!='ACTIVE':raise LedgerDenied('terminal mission cannot be re-admitted')
                return self._receipt(old)
            active=con.execute("SELECT count(*) FROM missions WHERE state!='TERMINATED_VERIFIED_LOCAL_ONLY'").fetchone()[0]
            tenant=con.execute("SELECT count(*) FROM missions WHERE tenant=? AND state!='TERMINATED_VERIFIED_LOCAL_ONLY'",(request['tenant_id'],)).fetchone()[0]
            if active>=self.max_active or tenant>=self.max_per_tenant:raise LedgerDenied('capacity exhausted or recovery hold')
            ident=secrets.token_hex(16)
            con.execute('INSERT INTO missions VALUES(?,?,?,?,?,?,?,?,?)',(ident,request['tenant_id'],request['work_id'],request['workload_identity_id'],request['request_sha256'],binding,'ACTIVE',now+self.ttl,None))
            row=con.execute('SELECT * FROM missions WHERE id=?',(ident,)).fetchone()
            return self._receipt(row)

    def inspect(self,mission_id):
        with self._transaction() as con:
            row=con.execute('SELECT * FROM missions WHERE id=?',(mission_id,)).fetchone()
            if not row:raise LedgerDenied('unknown mission')
            return self._receipt(row)

    def active_count(self):
        with self._transaction() as con:
            return con.execute("SELECT COUNT(*) FROM missions WHERE state!='TERMINATED_VERIFIED_LOCAL_ONLY'").fetchone()[0]

    def complete_local(self,mission_id,*,termination_verified):
        if type(termination_verified) is not bool:raise LedgerDenied('boolean local termination proof required')
        with self._transaction() as con:
            row=con.execute('SELECT * FROM missions WHERE id=?',(mission_id,)).fetchone()
            if not row:raise LedgerDenied('unknown mission')
            if not termination_verified:
                con.execute("UPDATE missions SET state='RECOVERY_HOLD' WHERE id=?",(mission_id,))
                con.commit()
                raise RecoveryHold('termination not independently witnessed; capacity held')
            if row[6] not in ('ACTIVE','RECOVERY_HOLD'):
                raise LedgerDenied('mission already terminal')
            con.execute("UPDATE missions SET state='TERMINATED_VERIFIED_LOCAL_ONLY' WHERE id=?",(mission_id,))
            return self._receipt(con.execute('SELECT * FROM missions WHERE id=?',(mission_id,)).fetchone())

    def status(self):
        try:
            with self._transaction() as con:
                return 'LOCAL_ONLY_UNQUALIFIED'
        except RecoveryHold:
            return 'RECOVERY_HOLD'
