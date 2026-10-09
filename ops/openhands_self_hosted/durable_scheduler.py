"""Single-host persistent S0 admission and termination evidence, NOT production.

A local SQLite ledger retains capacity after process restart and denies unsafe
reuse until an independent readback verifies the worker's removal. Not a
multi-region scheduler, identity issuer, or production authorization gateway.
"""
import hashlib
import json
import math
import os
from pathlib import Path
import re
import secrets
import sqlite3
import stat
import time

class LeaseDenied(ValueError):
    pass

class TerminationUnverified(RuntimeError):
    pass

_FIELDS={'schema','tenant_id','work_id','workload_identity_id','request_sha256',
         'worker_name','risk_class','operation'}
_ID=re.compile(r'^[a-zA-Z0-9][a-zA-Z0-9_:/.-]{0,99}$')
_NAME=re.compile(r'^axiom-openhands-[a-z0-9]{8}$')
_DIGEST=re.compile(r'^[0-9a-f]{64}$')
_SCHEMA='musitu.axiom.trackb.s0-worker-request.v1'

def _validate(request):
    if type(request) is not dict or set(request)!=_FIELDS:
        raise LeaseDenied('exact S0 worker request schema required')
    if request['schema']!=_SCHEMA or request['risk_class']!='S0' or request['operation']!='B1_ISOLATED_CONTAINER_SMOKE':
        raise LeaseDenied('only B1 isolated S0 worker admission allowed')
    for k in ('tenant_id','work_id','workload_identity_id'):
        v=request[k]
        if type(v) is not str or not _ID.fullmatch(v) or '..' in v:
            raise LeaseDenied('invalid worker operation identity')
    if type(request['request_sha256']) is not str or not _DIGEST.fullmatch(request['request_sha256']):
        raise LeaseDenied('request digest invalid')
    if type(request['worker_name']) is not str or not _NAME.fullmatch(request['worker_name']):
        raise LeaseDenied('worker namespace invalid')
    return hashlib.sha256(json.dumps(request,sort_keys=True,separators=(',',':')).encode()).hexdigest()

class DurableS0Scheduler:
    def __init__(self,path,*,max_active=4,max_per_tenant=2,ttl_seconds=30,clock=time.time):
        self.path=Path(path)
        if (not self.path.is_absolute() or type(max_active) is not int or not 1<=max_active<=10 or
            type(max_per_tenant) is not int or not 1<=max_per_tenant<=max_active or
            type(ttl_seconds) is not int or not 1<=ttl_seconds<=300 or not callable(clock)):
            raise LeaseDenied('durable scheduler configuration invalid')
        self.max_active=max_active
        self.max_per_tenant=max_per_tenant
        self.ttl=ttl_seconds
        self.clock=clock

    def _now(self):
        value=self.clock()
        if type(value) not in (float,int) or not math.isfinite(value) or value<0:
            raise LeaseDenied('trusted wall-clock timestamp invalid')
        return float(value)

    def _private_db(self):
        try:
            if self.path.is_symlink():raise LeaseDenied('symlink state file forbidden')
            parent=self.path.parent.stat()
            if not stat.S_ISDIR(parent.st_mode) or parent.st_uid!=os.getuid() or parent.st_mode & 0o022:
                raise LeaseDenied('durable ledger directory is not owner-private')
            if not self.path.exists():
                try:
                    fd=os.open(self.path,os.O_CREAT|os.O_EXCL|os.O_WRONLY|getattr(os,'O_NOFOLLOW',0),0o600)
                    os.close(fd)
                except FileExistsError:pass
            if self.path.is_symlink():raise LeaseDenied('state file was replaced')
            st=self.path.stat()
            if not stat.S_ISREG(st.st_mode) or st.st_uid!=os.getuid() or stat.S_IMODE(st.st_mode)!=0o600:
                raise LeaseDenied('durable ledger path permission violation')
        except LeaseDenied:raise
        except OSError:raise LeaseDenied('durable ledger storage inaccessible') from None

    def _transaction(self):
        self._private_db()
        try:
            con=sqlite3.connect(self.path,timeout=15,isolation_level=None)
            con.execute('PRAGMA busy_timeout=15000')
            con.execute('PRAGMA synchronous=FULL')
            con.execute('BEGIN IMMEDIATE')
            con.execute('CREATE TABLE IF NOT EXISTS leases ('
                        'lease_id TEXT PRIMARY KEY NOT NULL,'
                        'request_sha TEXT UNIQUE NOT NULL,'
                        'binding TEXT NOT NULL,'
                        'tenant TEXT NOT NULL,'
                        'worker_name TEXT UNIQUE NOT NULL,'
                        'workload TEXT NOT NULL,'
                        'expires_unix REAL NOT NULL,'
                        'state TEXT NOT NULL)')
            return con
        except (OSError,sqlite3.Error):
            raise LeaseDenied('durable scheduler cannot transact safely') from None

    def _receipt(self,row):
        return {'schema':'musitu.axiom.trackb.durable-s0-lease-receipt.v1',
                'lease_id':row[0],'tenant_id':row[3],'state':row[7],
                'risk_class':'S0','external_action_executed':False,
                'production_authority':False,'release_authority':False,
                'certification_authority':False,'live_runtime_qualification':'NOT_PROVEN'}

    def acquire(self,request):
        binding=_validate(request)
        now=self._now()
        con=self._transaction()
        try:
            existing=con.execute('SELECT * FROM leases WHERE request_sha=?',(request['request_sha256'],)).fetchone()
            if existing is not None:
                if existing[2]!=binding or existing[7]!='ACTIVE' or now>=existing[6]:
                    raise LeaseDenied('worker request conflict, revoked or expired')
                con.commit()
                return self._receipt(existing)
            used=con.execute("SELECT COUNT(*) FROM leases WHERE state!='TERMINATED'").fetchone()[0]
            by_tenant=con.execute("SELECT COUNT(*) FROM leases WHERE tenant=? AND state!='TERMINATED'",(request['tenant_id'],)).fetchone()[0]
            if used>=self.max_active or by_tenant>=self.max_per_tenant:
                raise LeaseDenied('global or per-tenant admission limit reached')
            lease_id=secrets.token_hex(16)
            row=(lease_id,request['request_sha256'],binding,request['tenant_id'],
                 request['worker_name'],request['workload_identity_id'],now+self.ttl,'ACTIVE')
            con.execute('INSERT INTO leases VALUES (?,?,?,?,?,?,?,?)',row)
            con.commit()
            return self._receipt(row)
        except LeaseDenied:
            con.rollback()
            raise
        except (sqlite3.Error,OSError):
            con.rollback()
            raise LeaseDenied('durable worker admission failed closed') from None
        finally:con.close()

    def active_count(self):
        con=self._transaction()
        try:
            result=con.execute("SELECT COUNT(*) FROM leases WHERE state!='TERMINATED'").fetchone()[0]
            con.commit()
            return result
        except sqlite3.Error:
            con.rollback()
            raise LeaseDenied('durable capacity unknown') from None
        finally:con.close()

    def release(self,lease_id,tenant_id,*,terminate,verify_absent):
        if (type(lease_id) is not str or not re.fullmatch(r'[0-9a-f]{32}',lease_id) or
            type(tenant_id) is not str or not _ID.fullmatch(tenant_id) or
            not callable(terminate) or not callable(verify_absent)):
            raise LeaseDenied('operation-scoped termination authority malformed')
        con=self._transaction()
        try:
            row=con.execute('SELECT * FROM leases WHERE lease_id=?',(lease_id,)).fetchone()
            if row is None or row[3]!=tenant_id:
                raise LeaseDenied('lease termination identity mismatch')
            if row[7]=='TERMINATED':
                con.commit()
                return self._receipt(row)
            con.execute("UPDATE leases SET state='TERMINATION_REQUIRED' WHERE lease_id=?",(lease_id,))
            con.commit()
        except LeaseDenied:
            con.rollback()
            raise
        except sqlite3.Error:
            con.rollback()
            raise TerminationUnverified('termination intent not committed') from None
        finally:con.close()
        try:
            terminate(row[4])
            if verify_absent(row[4]) is not True:
                raise TerminationUnverified('sandbox removal was not independently verified')
        except Exception:
            raise TerminationUnverified('sandbox termination not independently verified') from None
        con=self._transaction()
        try:
            old=con.execute('SELECT * FROM leases WHERE lease_id=?',(lease_id,)).fetchone()
            if old is None or old[7]!='TERMINATION_REQUIRED' or old[3]!=tenant_id:
                raise TerminationUnverified('termination state diverged')
            con.execute("UPDATE leases SET state='TERMINATED' WHERE lease_id=?",(lease_id,))
            newer=con.execute('SELECT * FROM leases WHERE lease_id=?',(lease_id,)).fetchone()
            con.commit()
            return self._receipt(newer)
        except TerminationUnverified:
            con.rollback()
            raise
        except sqlite3.Error:
            con.rollback()
            raise TerminationUnverified('verified shutdown could not be persisted') from None
        finally:con.close()

    def reap_expired(self,*,terminate,verify_absent):
        now=self._now()
        con=self._transaction()
        try:
            rows=con.execute("SELECT lease_id,tenant FROM leases WHERE state!='TERMINATED' AND (expires_unix<=? OR state='TERMINATION_REQUIRED')",(now,)).fetchall()
            con.commit()
        except sqlite3.Error:
            con.rollback()
            raise LeaseDenied('expiry recovery read unavailable') from None
        finally:con.close()
        results=[]
        for lease_id,tenant in rows:
            results.append(self.release(lease_id,tenant,terminate=terminate,verify_absent=verify_absent))
        return results
