"""Neon PostgreSQL durable job transport. Tenant RLS is mandatory, fail-closed.
No database or external service calls occur at import time.
"""
from __future__ import annotations
import json
from urllib.parse import urlsplit
from typing import Any
import secrets
import time
from bridge import QueueError

class PostgresQueue:
    def __init__(self,dsn:str):
        url=urlsplit(dsn)
        if url.scheme not in ('postgresql','postgres') or not url.hostname or not url.hostname.endswith('.neon.tech'):
            raise ValueError('dedicated Neon PostgreSQL connection required')
        self.dsn=dsn
    def connect(self,tenant:str):
        try:import psycopg
        except ImportError as e:raise RuntimeError('psycopg is required only for production Neon') from e
        conn=psycopg.connect(self.dsn,sslmode='verify-full',connect_timeout=10)
        # GUC is LOCAL to each transaction. Role must be non-owner and NON-BYPASSRLS.
        conn.execute("SELECT set_config('lifeline.tenant_subject', %s, true)",(tenant,))
        return conn
    def enqueue(self,tenant:str,ident:str,job:dict)->None:
        if job.get('tenant')!=tenant or not isinstance(job.get('job_id'),str):raise ValueError('invalid tenant job')
        from psycopg.types.json import Jsonb
        with self.connect(tenant) as c:
            c.execute('INSERT INTO lifeline.agent_jobs(job_id,tenant_subject,agent_id,job,state) VALUES (%s,%s,%s,%s,\'PENDING\')',
                      (job['job_id'],tenant,ident,Jsonb(job)))
    def nonce_once(self,ident:str,nonce:str,tenant:str)->None:
        import psycopg
        try:
            with self.connect(tenant) as c:
                c.execute('INSERT INTO lifeline.agent_nonces(tenant_subject,agent_id,nonce) VALUES (%s,%s,%s)',
                          (tenant,ident,nonce))
        except psycopg.errors.UniqueViolation as e:
            raise QueueError('replayed agent request') from e
    def pull(self,tenant:str,ident:str,key:bytes)->dict|None:
        from psycopg.types.json import Jsonb
        import agent
        with self.connect(tenant) as c:
            row=c.execute('''SELECT job_id, job, state FROM lifeline.agent_jobs
                WHERE tenant_subject=%s AND agent_id=%s AND state IN ('CLAIMED','PENDING')
                ORDER BY CASE WHEN state='CLAIMED' THEN 0 ELSE 1 END,created_at,job_id
                LIMIT 1 FOR UPDATE SKIP LOCKED''',(tenant,ident)).fetchone()
            if row is None:return None
            _,payload,state=row
            if state=='PENDING':
                payload['issued_at']=int(time.time())
                payload['nonce']=secrets.token_urlsafe(18)
                payload['signature']=agent.sign({k:v for k,v in payload.items() if k!='signature'},key)
                updated=c.execute("UPDATE lifeline.agent_jobs SET state='CLAIMED',claimed_at=now(),job=%s WHERE job_id=%s AND tenant_subject=%s AND state='PENDING' RETURNING job_id",
                                  (Jsonb(payload),row[0],tenant)).fetchone()
                if not updated:raise RuntimeError('job contention fail-closed')
            return payload
    def receipt(self,tenant:str,ident:str,receipt:dict)->bool:
        from psycopg.types.json import Jsonb
        if receipt.get('tenant')!=tenant or not isinstance(receipt.get('job_id'),str):return False
        with self.connect(tenant) as c:
            row=c.execute('SELECT state,receipt FROM lifeline.agent_jobs WHERE job_id=%s AND tenant_subject=%s AND agent_id=%s FOR UPDATE',
                          (receipt['job_id'],tenant,ident)).fetchone()
            if not row:return False
            if row[0]=='COMPLETED':return row[1]==receipt
            if row[0]!='CLAIMED':return False
            return bool(c.execute("UPDATE lifeline.agent_jobs SET state='COMPLETED',receipt=%s,completed_at=now() WHERE job_id=%s AND tenant_subject=%s AND agent_id=%s AND state='CLAIMED' RETURNING job_id",
                                  (Jsonb(receipt),receipt['job_id'],tenant,ident)).fetchone())
    def summary(self,tenant:str,ident:str)->dict:
        with self.connect(tenant) as c:
            rows=c.execute('SELECT state,COUNT(*) FROM lifeline.agent_jobs WHERE tenant_subject=%s AND agent_id=%s GROUP BY state',(tenant,ident)).fetchall()
            return dict(rows)
