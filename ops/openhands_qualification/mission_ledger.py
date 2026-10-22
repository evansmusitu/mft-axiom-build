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
_LOCAL_ANCHOR_SCHEMA='musitu.axiom.ecc.local-anchor.s0.v2'
_ANCHOR_FIELDS={'schema','generation_id','sequence','mission_state_sha256'}

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
        self.transition=Path(str(self.path)+'.transition')
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

    @staticmethod
    def _state_hash(con):
        # Canonical complete committed-relevant row state, not an external MAC.
        rows=con.execute('SELECT id,tenant,work,workload,request_sha,binding_sha,state,expires,output_sha FROM missions ORDER BY id').fetchall()
        blob=json.dumps(rows,separators=(',',':'),ensure_ascii=True,allow_nan=False).encode()
        return hashlib.sha256(blob).hexdigest()

    @staticmethod
    def _anchor_bytes(generation,sequence,digest):
        doc={'schema':_LOCAL_ANCHOR_SCHEMA,'generation_id':generation,
             'sequence':sequence,'mission_state_sha256':digest}
        return (json.dumps(doc,sort_keys=True,separators=(',',':'))+'\n').encode()

    def _verify_state(self,con):
        try:
            result=con.execute('PRAGMA quick_check').fetchone()
            if result!=('ok',):raise RecoveryHold('local sqlite integrity check failed')
            row=con.execute('SELECT generation_id,sequence FROM ledger_meta WHERE id=1').fetchone()
            if not row or type(row[0]) is not str or not re.fullmatch('[0-9a-f]{32}',row[0]) or type(row[1]) is not int or row[1]<0:
                raise RecoveryHold('local generation metadata absent or invalid')
            generation,sequence=row
            self._check_private(self.anchor)
            fd=os.open(self.anchor,os.O_RDONLY|getattr(os,'O_NOFOLLOW',0))
            try:
                raw=os.read(fd,4096)
                if os.read(fd,1):raise RecoveryHold('oversized anchor')
            finally:os.close(fd)
            try:payload=json.loads(raw)
            except (UnicodeDecodeError,ValueError) as exc:
                raise RecoveryHold('malformed local state anchor') from exc
            if type(payload) is not dict or set(payload)!=_ANCHOR_FIELDS or type(payload['sequence']) is not int:
                raise RecoveryHold('unexpected local anchor format')
            if raw!=self._anchor_bytes(generation,sequence,self._state_hash(con)):
                raise RecoveryHold('local journal and anchor diverged')
            return generation,sequence
        except sqlite3.Error as exc:
            raise RecoveryHold('unreadable local journal') from exc

    def _publish_anchor(self,raw):
        # Publish only after the SQLite commit is durable. A crash between the
        # two durability domains leaves a mismatch that next access DENIES.
        temp=Path(str(self.anchor)+'.pending-'+secrets.token_hex(8))
        fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|getattr(os,'O_NOFOLLOW',0),0o600)
        try:
            os.write(fd,raw);os.fsync(fd)
        finally:os.close(fd)
        os.replace(temp,self.anchor)
        dfd=os.open(self.path.parent,os.O_RDONLY|getattr(os,'O_DIRECTORY',0))
        try:os.fsync(dfd)
        finally:os.close(dfd)

    def _commit_transition(self,con,generation,sequence):
        # A local monotonic counter detects unilateral DB/anchor replacement.
        # It is NOT resistant to privileged rollback of both files.
        # Synchronous transition marker survives ambiguous publication errors.
        # Any orphan marker forces a manual recovery hold, even if DB and
        # anchor appear identical after an uncertain directory fsync.
        flags=os.O_WRONLY|os.O_CREAT|os.O_EXCL|getattr(os,'O_NOFOLLOW',0)
        marker_fd=os.open(self.transition,flags,0o600)
        try:
            os.write(marker_fd,b'LOCAL_S0_PENDING_NOT_EXTERNAL_AUTHORITY\n')
            os.fsync(marker_fd)
        finally:os.close(marker_fd)
        directory=os.open(self.path.parent,os.O_RDONLY|getattr(os,'O_DIRECTORY',0))
        try:os.fsync(directory)
        finally:os.close(directory)
        next_sequence=sequence+1
        con.execute('UPDATE ledger_meta SET sequence=? WHERE id=1',(next_sequence,))
        digest=self._state_hash(con)
        raw=self._anchor_bytes(generation,next_sequence,digest)
        con.commit()
        self._publish_anchor(raw)
        os.unlink(self.transition)
        directory=os.open(self.path.parent,os.O_RDONLY|getattr(os,'O_DIRECTORY',0))
        try:os.fsync(directory)
        finally:os.close(directory)

    @contextmanager
    def _transaction(self):
        try:
            parent=self.path.parent.stat()
            if not stat.S_ISDIR(parent.st_mode) or parent.st_uid!=os.getuid() or parent.st_mode&0o022:
                raise LedgerDenied('ledger parent must be owner-private')
            # All files must already exist; a normal operation never bootstraps.
            for required in (self.lock,self.path,self.anchor):
                self._check_private(required)
            fd=os.open(self.lock,os.O_RDWR|getattr(os,'O_NOFOLLOW',0))
            try:
                fcntl.flock(fd,fcntl.LOCK_EX)
                for required in (self.lock,self.path,self.anchor):
                    self._check_private(required)
                if self.transition.exists() or self.transition.is_symlink():
                    raise RecoveryHold('incomplete local transition requires manual recovery')
                con=sqlite3.connect(self.path,isolation_level=None,timeout=15)
                try:
                    con.execute('PRAGMA busy_timeout=15000')
                    con.execute('PRAGMA synchronous=FULL')
                    con.execute('BEGIN IMMEDIATE')
                    generation,sequence=self._verify_state(con)
                    before=con.total_changes
                    try:
                        yield con
                    except RecoveryHold:
                        # Intentional hold transition (expiry or uncertain local
                        # termination) must persist before the denial is raised.
                        if con.in_transaction and con.total_changes>before:
                            self._commit_transition(con,generation,sequence)
                        elif con.in_transaction:con.rollback()
                        raise
                    except BaseException:
                        if con.in_transaction:con.rollback()
                        raise
                    else:
                        if con.in_transaction and con.total_changes>before:
                            self._commit_transition(con,generation,sequence)
                        elif con.in_transaction:con.commit()
                finally:con.close()
            finally:
                fcntl.flock(fd,fcntl.LOCK_UN);os.close(fd)
        except (RecoveryHold,LedgerDenied):raise
        except (OSError,sqlite3.Error) as exc:
            raise RecoveryHold('local journal/anchor operation failed closed') from exc

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
                raise RecoveryHold('termination not independently witnessed; capacity held')
            if row[6] not in ('ACTIVE','RECOVERY_HOLD'):
                raise LedgerDenied('mission already terminal')
            con.execute("UPDATE missions SET state='TERMINATED_VERIFIED_LOCAL_ONLY' WHERE id=?",(mission_id,))
            return self._receipt(con.execute('SELECT * FROM missions WHERE id=?',(mission_id,)).fetchone())

    def status(self):
        try:
            with self._transaction() as con:
                return 'LOCAL_ONLY_UNQUALIFIED'
        except (RecoveryHold,LedgerDenied):
            return 'RECOVERY_HOLD'
