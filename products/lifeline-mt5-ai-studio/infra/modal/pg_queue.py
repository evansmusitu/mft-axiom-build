"""Neon PostgreSQL durable job transport. Tenant RLS is mandatory, fail-closed.
No database or external service calls occur at import time.
"""
from __future__ import annotations
import json
from urllib.parse import urlsplit
from typing import Any
import secrets
import time
from bridge import QueueError, MAX_ACTIVE_JOBS, MAX_TOTAL_JOBS

class PostgresQueue:
    def __init__(self,dsn:str):
        url=urlsplit(dsn)
        if (url.scheme not in ('postgresql','postgres') or not url.hostname or
            not url.hostname.endswith('.neon.tech') or
            url.username != 'lifeline_stage_app' or url.path != '/lifeline_mt5_stage' or
            url.fragment or not url.password):
            raise ValueError('dedicated restricted Neon app identity required')
        self.dsn=dsn
    def connect(self,tenant:str):
        import re
        if not isinstance(tenant,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}',tenant):
            raise QueueError('invalid tenant identity')
        try:
            import psycopg, certifi
        except ImportError as e:
            raise RuntimeError('psycopg and certifi are required for private Neon') from e
        # Always verify the *hostname* and CA trust even if DSN contains sslmode=require.
        conn=psycopg.connect(self.dsn,sslmode='verify-full',
                             sslrootcert=certifi.where(),connect_timeout=10)
        try:
            # Do not rely solely on the URL role name: check the actual database role.
            identity=conn.execute("SELECT current_user,rolbypassrls,rolcreaterole,rolsuper "
                                  "FROM pg_roles WHERE rolname=current_user").fetchone()
            if identity is None or identity[0]!='lifeline_stage_app' or any(identity[1:]):
                raise QueueError('privileged or mismatched Neon runtime identity')
            for table in ('lifeline.agent_jobs','lifeline.agent_nonces','lifeline.research_receipts'):
                row=conn.execute("SELECT row_security_active(%s::regclass)",(table,)).fetchone()
                if row is None or row[0] is not True:
                    raise QueueError('tenant row-level security inactive')
            # GUC is LOCAL to this transaction, never a shared session GUC.
            conn.execute("SELECT set_config('lifeline.tenant_subject', %s, true)",(tenant,))
            return conn
        except Exception:
            conn.close()
            raise
    def enqueue(self,tenant:str,ident:str,job:dict)->None:
        if job.get('tenant')!=tenant or not isinstance(job.get('job_id'),str):raise ValueError('invalid tenant job')
        from psycopg.types.json import Jsonb
        with self.connect(tenant) as c:
            # Transaction-scoped lock makes capacity checks serializable per tenant/agent.
            c.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s,0))',(tenant+':'+ident,))
            counts=c.execute("""SELECT
                COUNT(*) FILTER (WHERE state IN ('PENDING','CLAIMED')),
                COUNT(*) FROM lifeline.agent_jobs
                WHERE tenant_subject=%s AND agent_id=%s""",(tenant,ident)).fetchone()
            if counts is None or counts[0]>=MAX_ACTIVE_JOBS or counts[1]>=MAX_TOTAL_JOBS:
                raise QueueError('stage job quota exceeded')
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
            if payload.get('tenant')!=tenant or not isinstance(payload.get('nonce'),str):
                raise QueueError('stored job tenant/nonce mismatch')
            if state=='PENDING':
                payload['issued_at']=int(time.time())
                payload['nonce']=secrets.token_urlsafe(18)
                payload['signature']=agent.sign({k:v for k,v in payload.items() if k!='signature'},key)
                updated=c.execute("UPDATE lifeline.agent_jobs SET state='CLAIMED',claimed_at=now(),job=%s WHERE job_id=%s AND tenant_subject=%s AND state='PENDING' RETURNING job_id",
                                  (Jsonb(payload),row[0],tenant)).fetchone()
                if not updated:raise QueueError('job contention fail-closed')
            elif state=='CLAIMED':
                unsigned={k:v for k,v in payload.items() if k!='signature'}
                if not secrets.compare_digest(str(payload.get('signature','')),agent.sign(unsigned,key)):
                    raise QueueError('stored claimed job signature invalid')
                issued=payload.get('issued_at')
                if type(issued) is not int:
                    raise QueueError('stored claimed job timestamp invalid')
                if int(time.time())-issued>90:
                    # Refresh signature age for crash/reconnect but NEVER rotate the nonce:
                    # the Windows durable claim/receipt is keyed by original nonce.
                    payload['issued_at']=int(time.time())
                    payload['signature']=agent.sign({k:v for k,v in payload.items() if k!='signature'},key)
                    updated=c.execute("UPDATE lifeline.agent_jobs SET job=%s WHERE job_id=%s AND tenant_subject=%s AND agent_id=%s AND state='CLAIMED' RETURNING job_id",
                                      (Jsonb(payload),row[0],tenant,ident)).fetchone()
                    if not updated:raise QueueError('claimed task no longer available')
            return payload
    def receipt(self,tenant:str,ident:str,receipt:dict)->bool:
        from psycopg.types.json import Jsonb
        if receipt.get('tenant')!=tenant or not isinstance(receipt.get('job_id'),str):return False
        with self.connect(tenant) as c:
            row=c.execute('SELECT state,receipt,job FROM lifeline.agent_jobs WHERE job_id=%s AND tenant_subject=%s AND agent_id=%s FOR UPDATE',
                          (receipt['job_id'],tenant,ident)).fetchone()
            if not row:return False
            if (receipt.get('operation')!=row[2].get('operation') or
                row[2].get('tenant')!=tenant or receipt.get('trading_enabled') is not False):
                return False
            if row[0]=='COMPLETED':return row[1]==receipt
            if row[0]!='CLAIMED':return False
            return bool(c.execute("UPDATE lifeline.agent_jobs SET state='COMPLETED',receipt=%s,completed_at=now() WHERE job_id=%s AND tenant_subject=%s AND agent_id=%s AND state='CLAIMED' RETURNING job_id",
                                  (Jsonb(receipt),receipt['job_id'],tenant,ident)).fetchone())
    def summary(self,tenant:str,ident:str)->dict:
        with self.connect(tenant) as c:
            rows=c.execute('SELECT state,COUNT(*) FROM lifeline.agent_jobs WHERE tenant_subject=%s AND agent_id=%s GROUP BY state',(tenant,ident)).fetchall()
            return dict(rows)
