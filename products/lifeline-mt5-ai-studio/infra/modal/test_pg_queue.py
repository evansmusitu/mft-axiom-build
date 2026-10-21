"""Retry-safe claimed job and least-privilege Neon connection acceptance."""
from __future__ import annotations
import json
import pathlib
import sqlite3
import sys
import tempfile
import time
import types
import unittest
from unittest.mock import patch

HERE=pathlib.Path(__file__).resolve().parent
WINDOWS=HERE.parents[1]/'windows'
sys.path.insert(0,str(WINDOWS))
sys.path.insert(0,str(HERE))
import agent
from bridge import SQLiteQueue, QueueError
from pg_queue import PostgresQueue

KEY=b'development-only-hmac-key-very-long-for-tests-001'
DSN='postgresql://lifeline_stage_app:fake-test-only@ep-staging.us-east-1.aws.neon.tech/lifeline_mt5_stage?sslmode=require'

class SQLiteRecovery(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root=pathlib.Path(self.tmp.name)
        self.store=SQLiteQueue(self.root/'queue.sqlite')
        self.job={'job_id':'ea9fcc09-c931-4d45-b9d4-7865f251f11b','issued_at':1,
                  'nonce':'originalNonceToBeReplaced',
                  'operation':'probe','args':{},'tenant':'tenant-A'}
        self.job['signature']=agent.sign({k:v for k,v in self.job.items() if k!='signature'},KEY)
        self.store.enqueue('tenant-A','agent-A',self.job)

    def test_refresh_preserves_nonce_and_exact_receipt(self):
        first=self.store.pull('tenant-A','agent-A',KEY)
        agent.verify_job(first,KEY)
        receipt=agent.execute_once(first,KEY,self.root,None,None,self.root/'durable.sqlite')
        with sqlite3.connect(self.store.db) as c:
            stale=json.loads(c.execute('SELECT job_json FROM jobs').fetchone()[0])
            stale['issued_at']=1
            stale['signature']=agent.sign({k:v for k,v in stale.items() if k!='signature'},KEY)
            c.execute("UPDATE jobs SET job_json=? WHERE job_id=?",(json.dumps(stale),first['job_id']))
        renewed=self.store.pull('tenant-A','agent-A',KEY)
        agent.verify_job(renewed,KEY)
        self.assertEqual(renewed['nonce'],first['nonce'])
        self.assertNotEqual(renewed['signature'],stale['signature'])
        again=agent.execute_once(renewed,KEY,self.root,None,None,self.root/'durable.sqlite')
        self.assertEqual(receipt,again)
        self.assertTrue(self.store.receipt('tenant-A','agent-A',again))
        self.assertTrue(self.store.receipt('tenant-A','agent-A',again))
        self.assertEqual(self.store.summary('tenant-A','agent-A'),{'COMPLETED':1})

    def test_corrupted_claimed_signature_fails_closed(self):
        first=self.store.pull('tenant-A','agent-A',KEY)
        with sqlite3.connect(self.store.db) as c:
            corrupted=dict(first,signature='0'*64)
            c.execute('UPDATE jobs SET job_json=?',(json.dumps(corrupted),))
        with self.assertRaisesRegex(QueueError,'signature invalid'):
            self.store.pull('tenant-A','agent-A',KEY)

class FakeResponse:
    def __init__(self,row):self.row=row
    def fetchone(self):return self.row

class FakeConnection:
    def __init__(self,role='lifeline_stage_app', rls=True):
        self.role=role;self.rls=rls;self.calls=[];self.closed=False
    def execute(self,query,params=None):
        self.calls.append((query,params))
        if 'FROM pg_roles' in query:return FakeResponse((self.role,False,False,False))
        if 'row_security_active' in query:return FakeResponse((self.rls,))
        if 'set_config' in query:return FakeResponse(('tenant-A',))
        raise AssertionError('unexpected SQL')
    def close(self):self.closed=True

class PgRoleTests(unittest.TestCase):
    def test_non_neon_or_admin_roles_denied(self):
        for url in ('postgresql://owner:pw@ep-staging.us-east-1.aws.neon.tech/lifeline_mt5_stage',
                    'postgresql://lifeline_runtime:pw@ep-staging.us-east-1.aws.neon.tech/lifeline_mt5_stage',
                    'postgresql://lifeline_stage_app:pw@evil.example/lifeline_mt5_stage'):
            with self.assertRaisesRegex(ValueError,'restricted Neon'):
                PostgresQueue(url)

    def test_tls_verify_full_and_role_rls_required(self):
        fake=FakeConnection()
        kwargs={}
        def connect(dsn,**kw):
            kwargs.update(kw);return fake
        ps=types.SimpleNamespace(connect=connect)
        certifi=types.SimpleNamespace(where=lambda:'/vendor/CA.pem')
        with patch.dict(sys.modules,{'psycopg':ps,'certifi':certifi}):
            c=PostgresQueue(DSN).connect('tenant-A')
        self.assertIs(c,fake)
        self.assertEqual(kwargs['sslmode'],'verify-full')
        self.assertEqual(kwargs['sslrootcert'],'/vendor/CA.pem')
        self.assertEqual(sum('row_security_active' in q for q,_ in fake.calls),3)
        self.assertIn('set_config',fake.calls[-1][0])

    def test_privileged_role_or_missing_rls_fail_closed(self):
        for role,rls in [('neon_owner',True),('lifeline_stage_app',False)]:
            fake=FakeConnection(role,rls)
            with patch.dict(sys.modules,{'psycopg':types.SimpleNamespace(connect=lambda *a,**k:fake),
                                         'certifi':types.SimpleNamespace(where=lambda:'/CA.pem')}):
                with self.assertRaisesRegex(QueueError,'privileged|row-level'):
                    PostgresQueue(DSN).connect('tenant-A')
            self.assertTrue(fake.closed)
            self.assertFalse(any('set_config' in q for q,_ in fake.calls))

    def test_bad_tenant_denied_before_connection(self):
        for tenant in ('../admin','tenant A','',None):
            with self.assertRaisesRegex(QueueError,'tenant identity'):
                PostgresQueue(DSN).connect(tenant)

if __name__=='__main__':unittest.main()
