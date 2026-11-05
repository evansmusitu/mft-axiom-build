"""Bounded tenant-scoped native agent queue. SQLite for offline acceptance only.
Production Neon uses the equivalent schema/methods with RLS; do not deploy this SQLite
store on ephemeral Modal containers (data loss on restart).
"""
from __future__ import annotations
import json
from pathlib import Path
import sqlite3
from contextlib import closing
import time
import secrets
from typing import Any

class QueueError(Exception):pass

# Free-tier anti-abuse cap; production retention/pruning needs separate review.
MAX_ACTIVE_JOBS = 8
MAX_TOTAL_JOBS = 250

def dumps(payload:Any)->str:
    return json.dumps(payload,sort_keys=True,separators=(',',':'))

class SQLiteQueue:
    def __init__(self,db:Path):
        self.db=db
        db.parent.mkdir(parents=True,exist_ok=True)
        with closing(sqlite3.connect(db,timeout=15)) as c:
            c.execute('PRAGMA busy_timeout=15000')
            c.executescript('''
            CREATE TABLE IF NOT EXISTS jobs (
              job_id TEXT PRIMARY KEY,tenant TEXT NOT NULL,agent_id TEXT NOT NULL,
              job_json TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'PENDING',
              receipt_json TEXT,created_at INTEGER NOT NULL,claimed_at INTEGER,
              CHECK (state IN ('PENDING','CLAIMED','COMPLETED'))
            );
            CREATE INDEX IF NOT EXISTS idx_queued ON jobs(tenant,agent_id,state,created_at);
            CREATE TABLE IF NOT EXISTS seen_nonces (
              agent_id TEXT NOT NULL, nonce TEXT NOT NULL, ts INTEGER NOT NULL,
              PRIMARY KEY(agent_id,nonce)
            );
            ''')
            c.commit()
    def enqueue(self,tenant:str,ident:str,job:dict)->None:
        if job.get('tenant')!=tenant or not isinstance(job.get('job_id'),str):raise QueueError('invalid tenant or job id')
        with closing(sqlite3.connect(self.db,timeout=15,isolation_level=None)) as c:
            c.execute('BEGIN IMMEDIATE')
            try:
                active,total=c.execute("""SELECT
                   COALESCE(SUM(CASE WHEN state IN ('PENDING','CLAIMED') THEN 1 ELSE 0 END),0),
                   COUNT(*) FROM jobs WHERE tenant=? AND agent_id=?""",(tenant,ident)).fetchone()
                if active>=MAX_ACTIVE_JOBS or total>=MAX_TOTAL_JOBS:
                    raise QueueError('stage job quota exceeded')
                c.execute('INSERT INTO jobs(job_id,tenant,agent_id,job_json,created_at) VALUES (?,?,?,?,?)',
                          (job['job_id'],tenant,ident,dumps(job),int(time.time())))
                c.execute('COMMIT')
            except sqlite3.IntegrityError as e:
                c.execute('ROLLBACK')
                raise QueueError('duplicate job') from e
            except Exception:
                c.execute('ROLLBACK')
                raise
    def nonce_once(self,ident:str,nonce:str,tenant:str)->None:
        with closing(sqlite3.connect(self.db,timeout=15)) as c:
            try:
                c.execute('INSERT INTO seen_nonces(agent_id,nonce,ts) VALUES (?,?,?)',(ident,nonce,int(time.time())))
                c.commit()
            except sqlite3.IntegrityError as e:raise QueueError('replayed request') from e
    def pull(self,tenant:str,ident:str,key:bytes)->dict|None:
        with closing(sqlite3.connect(self.db,timeout=15,isolation_level=None)) as c:
            c.execute('BEGIN IMMEDIATE')
            row=c.execute('SELECT job_id,job_json,state FROM jobs WHERE tenant=? AND agent_id=? AND state IN (?,?) ORDER BY CASE WHEN state=? THEN 0 ELSE 1 END,created_at,job_id LIMIT 1',
                          (tenant,ident,'CLAIMED','PENDING','CLAIMED')).fetchone()
            if row is not None:
                payload=json.loads(row[1])
                import agent
                if payload.get('tenant')!=tenant or not isinstance(payload.get('nonce'),str):
                    raise QueueError('job binding invalid')
                if row[2]=='PENDING':
                    payload['issued_at']=int(time.time())
                    payload['nonce']=secrets.token_urlsafe(18)
                    payload['signature']=agent.sign({k:v for k,v in payload.items() if k!='signature'},key)
                    c.execute('UPDATE jobs SET state=?,claimed_at=?,job_json=? WHERE job_id=? AND state=?',
                              ('CLAIMED',int(time.time()),dumps(payload),row[0],'PENDING'))
                elif row[2]=='CLAIMED':
                    # A task already claimed by the Windows agent must retain its
                    # original nonce. Changing it would block durable receipt replay.
                    unsigned={k:v for k,v in payload.items() if k!='signature'}
                    if not secrets.compare_digest(str(payload.get('signature','')),agent.sign(unsigned,key)):
                        raise QueueError('stored claimed job signature invalid')
                    issued=payload.get('issued_at')
                    if type(issued) is not int:
                        raise QueueError('claimed job issued_at invalid')
                    if int(time.time())-issued>90:
                        payload['issued_at']=int(time.time())
                        payload['signature']=agent.sign({k:v for k,v in payload.items() if k!='signature'},key)
                        c.execute('UPDATE jobs SET job_json=? WHERE job_id=? AND tenant=? AND agent_id=? AND state=?',
                                  (dumps(payload),row[0],tenant,ident,'CLAIMED'))
            else: payload=None
            c.execute('COMMIT')
            return payload
    def receipt(self,tenant:str,ident:str,receipt:dict)->bool:
        job_id=receipt.get('job_id')
        if not isinstance(job_id,str) or receipt.get('tenant')!=tenant:return False
        with closing(sqlite3.connect(self.db,timeout=15,isolation_level=None)) as c:
            c.execute('BEGIN IMMEDIATE')
            row=c.execute('SELECT state,receipt_json,job_json FROM jobs WHERE job_id=? AND tenant=? AND agent_id=?',
                          (job_id,tenant,ident)).fetchone()
            if row is None:
                c.execute('ROLLBACK');return False
            source=json.loads(row[2])
            if (receipt.get('operation')!=source.get('operation') or
                source.get('tenant')!=tenant or receipt.get('trading_enabled') is not False):
                c.execute('ROLLBACK');return False
            if row[0]=='COMPLETED':
                valid=row[1]==dumps(receipt)
                c.execute('COMMIT');return valid
            if row[0]!='CLAIMED':
                c.execute('ROLLBACK');return False
            c.execute('UPDATE jobs SET state=?,receipt_json=? WHERE job_id=? AND state=?',
                      ('COMPLETED',dumps(receipt),job_id,'CLAIMED'))
            c.execute('COMMIT');return True
    def summary(self,tenant:str,ident:str)->dict:
        with closing(sqlite3.connect(self.db,timeout=15)) as c:
            rows=c.execute('SELECT state,COUNT(*) FROM jobs WHERE tenant=? AND agent_id=? GROUP BY state',(tenant,ident)).fetchall()
            return dict(rows)
