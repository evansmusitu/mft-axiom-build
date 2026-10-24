import hashlib
import hmac
import json
import sys
from pathlib import Path
import tempfile
import unittest
from fastapi.testclient import TestClient
import poller
import agent

MODAL=Path(__file__).resolve().parents[1]/'infra'/'modal'
if str(MODAL) not in sys.path:sys.path.insert(0,str(MODAL))
from staging_api import create_local_app
from bridge import SQLiteQueue,QueueError

KEY=b'development-only-hmac-key-very-long-for-tests-001'
EDGE='mock-edge-secret-long-for-test-only-00000000000'

class TestHttpAdapter:
    def __init__(self,tc):self.tc=tc
    def post(self,path,body,h):
        r=self.tc.post(path,json=body,headers=h)
        if r.status_code!=200:raise agent.AgentError('gateway rejection '+str(r.status_code))
        return r.json()

class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root=Path(self.tmp.name)
        self.db=SQLiteQueue(root/'bridge.sqlite')
        self.server=create_local_app(self.db,{'agent-A':KEY},{'agent-A':'tenant-A'},EDGE)
        self.tc=TestClient(self.server)
        self.edge_headers={'x-lifeline-edge-secret':EDGE,'x-lifeline-subject':'tenant-A'}
        self.worker=poller.OutboundAgent(TestHttpAdapter(self.tc),'agent-A','tenant-A',KEY,root/'native')
    def enqueue(self):
        r=self.tc.post('/operator/probe',json={'operation':'probe'},headers=self.edge_headers)
        self.assertEqual(r.status_code,200,r.text)
        return r.json()['job_id']
    def test_end_to_end_signed_probe(self):
        task=self.enqueue()
        reply=self.worker.step()
        self.assertEqual(reply['job_id'],task)
        self.assertEqual(reply['state'],'acknowledged')
        self.assertEqual(self.db.summary('tenant-A','agent-A').get('COMPLETED'),1)
        self.assertEqual(self.worker.step(),{'state':'idle'})
    def test_bad_agent_signature(self):
        body={'request':'next','tenant':'tenant-A'}
        h=poller.headers(body,KEY,'agent-A','tenant-A');h['x-lifeline-signature']='a'*64
        r=self.tc.post('/agent/pull',json=body,headers=h)
        self.assertEqual(r.status_code,401)
    def test_replayed_agent_request(self):
        body={'request':'next','tenant':'tenant-A'}
        h=poller.headers(body,KEY,'agent-A','tenant-A')
        self.assertEqual(self.tc.post('/agent/pull',json=body,headers=h).status_code,200)
        self.assertEqual(self.tc.post('/agent/pull',json=body,headers=h).status_code,401)
    def test_wrong_tenant_agent_rejected(self):
        body={'request':'next','tenant':'tenant-B'}
        h=poller.headers(body,KEY,'agent-A','tenant-B')
        self.assertEqual(self.tc.post('/agent/pull',json=body,headers=h).status_code,401)
    def test_wrong_tenant_operator_rejected(self):
        bad=dict(self.edge_headers,**{'x-lifeline-subject':'tenant-B'})
        self.assertEqual(self.tc.post('/operator/probe',json={'operation':'probe'},headers=bad).status_code,403)
    def test_forbid_trade_operation(self):
        self.assertEqual(self.tc.post('/operator/probe',json={'operation':'order_send'},headers=self.edge_headers).status_code,403)
    def test_missing_edge_secret_denied(self):
        self.assertEqual(self.tc.post('/operator/probe',json={'operation':'probe'}).status_code,401)
    def test_claim_at_most_once(self):
        self.enqueue()
        data={'request':'next','tenant':'tenant-A'}
        r=self.tc.post('/agent/pull',json=data,headers=poller.headers(data,KEY,'agent-A','tenant-A'))
        self.assertIsNotNone(r.json()['job'])
        r2=self.tc.post('/agent/pull',json=data,headers=poller.headers(data,KEY,'agent-A','tenant-A'))
        self.assertEqual(r2.json()['job']['job_id'],r.json()['job']['job_id'])
        self.assertEqual(r2.json()['job']['signature'],r.json()['job']['signature'])
        self.assertEqual(self.db.summary('tenant-A','agent-A'),{'CLAIMED':1})
    def test_old_pending_jobs_resigned_when_delivered(self):
        self.enqueue()
        from contextlib import closing
        with closing(__import__('sqlite3').connect(self.db.db)) as conn:
            conn.execute("UPDATE jobs SET job_json=json_set(job_json, '$.issued_at', 1) WHERE state='PENDING'")
            conn.commit()
        reply=self.worker.step()
        self.assertEqual(reply['state'],'acknowledged')
    def test_service_request_body_tampering(self):
        a={'request':'next','tenant':'tenant-A'}
        h=poller.headers(a,KEY,'agent-A','tenant-A')
        self.assertEqual(self.tc.post('/agent/pull',json={'request':'something-else','tenant':'tenant-A'},headers=h).status_code,401)
    def test_missing_receipt_signature(self):
        self.enqueue()
        pulled=self.tc.post('/agent/pull',json={'request':'next','tenant':'tenant-A'},headers=poller.headers({'request':'next','tenant':'tenant-A'},KEY,'agent-A','tenant-A')).json()['job']
        receipt={'schema':'lifeline.agent.receipt.v1','job_id':pulled['job_id'],'tenant':'tenant-A','trading_enabled':False}
        raw={'receipt':receipt}
        self.assertEqual(self.tc.post('/agent/receipt',json=raw,headers=poller.headers(raw,KEY,'agent-A','tenant-A')).status_code,401)
    def test_status_subject_scoped(self):
        self.enqueue()
        r=self.tc.post('/operator/status',json={},headers=self.edge_headers)
        self.assertEqual(r.json()['jobs'],{'PENDING':1})
    def test_mcp_requires_private_edge_secret(self):
        payload={'jsonrpc':'2.0','id':1,'method':'tools/list'}
        r=self.tc.post('/mcp',json=payload)
        self.assertEqual(r.status_code,401)
    def test_mcp_allows_status_only(self):
        payload={'jsonrpc':'2.0','id':1,'method':'tools/list'}
        response=self.tc.post('/mcp',json=payload,headers=self.edge_headers)
        self.assertEqual(response.status_code,200)
        self.assertEqual([t['name'] for t in response.json()['result']['tools']],['lifeline_status'])
        denied=self.tc.post('/mcp',json={'jsonrpc':'2.0','id':2,'method':'tools/call','params':{'name':'order_send'}},headers=self.edge_headers)
        self.assertEqual(denied.json()['error']['code'],-32601)

    def test_private_mcp_rejects_oversized_body(self):
        oversized={'jsonrpc':'2.0','id':1,'method':'tools/list','padding':'x'*70000}
        response=self.tc.post('/mcp',json=oversized,headers=self.edge_headers)
        self.assertEqual(response.status_code,413)

    def test_private_mcp_rejects_bad_json_and_envelope(self):
        malformed=self.tc.post('/mcp',data='invalid-json',
                               headers={**self.edge_headers,'content-type':'application/json'})
        self.assertEqual(malformed.status_code,400)
        wrong_version=self.tc.post('/mcp',json={'jsonrpc':'1.0','id':1,'method':'tools/list'},
                                   headers=self.edge_headers)
        self.assertEqual(wrong_version.status_code,400)

    def test_private_mcp_status_accepts_only_zero_arguments(self):
        payload={'jsonrpc':'2.0','id':1,'method':'tools/call',
                 'params':{'name':'lifeline_status','arguments':{'execute':True}}}
        response=self.tc.post('/mcp',json=payload,headers=self.edge_headers)
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json()['error']['code'],-32602)
        for params in (None,['lifeline_status'],{'name':'lifeline_status','extra':'anything'}):
            response=self.tc.post('/mcp',json={'jsonrpc':'2.0','id':2,
                        'method':'tools/call','params':params},headers=self.edge_headers)
            self.assertEqual(response.json()['error']['code'],-32602)
        valid=self.tc.post('/mcp',json={'jsonrpc':'2.0','id':3,'method':'tools/call',
                        'params':{'name':'lifeline_status','arguments':{}}},headers=self.edge_headers)
        self.assertEqual(valid.status_code,200)
        self.assertIn('result',valid.json())

    def test_stage_queue_capacity_rejected_with_429(self):
        for _ in range(8):
            self.enqueue()
        overflow=self.tc.post('/operator/probe',json={'operation':'probe'},headers=self.edge_headers)
        self.assertEqual(overflow.status_code,429)
        self.assertEqual(self.db.summary('tenant-A','agent-A'),{'PENDING':8})

    def test_signed_receipt_operation_must_match_original_job(self):
        task=self.enqueue()
        body={'request':'next','tenant':'tenant-A'}
        job=self.tc.post('/agent/pull',json=body,headers=poller.headers(body,KEY,'agent-A','tenant-A')).json()['job']
        self.assertEqual(job['job_id'],task)
        malicious={'schema':'lifeline.agent.receipt.v1','job_id':task,
                   'tenant':'tenant-A','operation':'backtest',
                   'outcome':'completed','result':{'verified':True},
                   'created_at':int(__import__('time').time()),
                   'trading_enabled':False}
        malicious['signature']=agent.sign(malicious,KEY)
        payload={'receipt':malicious}
        response=self.tc.post('/agent/receipt',json=payload,headers=poller.headers(payload,KEY,'agent-A','tenant-A'))
        self.assertEqual(response.status_code,409)
        self.assertEqual(self.db.summary('tenant-A','agent-A'),{'CLAIMED':1})

    def test_http_https_required(self):
        with self.assertRaisesRegex(agent.AgentError,'HTTPS'):
            poller.HTTPSClient('http://example.com')
    def test_pinned_gateway_host_and_no_redirect_no_proxy(self):
        import urllib.request
        import urllib.error
        for target in ('https://example.com','https://evil.mftintelligence.com',
                       'https://lifeline-mt5-stage.mftintelligence.com.evil.com',
                       'https://user:password@lifeline-mt5-stage.mftintelligence.com'):
            with self.assertRaisesRegex(agent.AgentError,'pinned'):
                poller.HTTPSClient(target)
        client=poller.HTTPSClient('https://lifeline-mt5-stage.mftintelligence.com')
        self.assertEqual(client.base_url,'https://lifeline-mt5-stage.mftintelligence.com')
        proxies=[h for h in client._client.handlers if isinstance(h,urllib.request.ProxyHandler)]
        # urllib intentionally drops an empty ProxyHandler from the opener.
        # Thus zero effective proxy handlers is the strongest expected result.
        self.assertEqual(len(proxies),0)
        body={'request':'next','tenant':'tenant-A'}
        class Fake:
            def open(self,req,timeout):
                self.url=req.full_url
                raise urllib.error.HTTPError(req.full_url,302,'redirect',{'Location':'https://malicious.test/'},None)
        fake=Fake()
        client._client=fake
        with self.assertRaisesRegex(agent.AgentError,'302'):
            client.post('/agent/pull',body,{'x-lifeline-agent-id':'fake'})
        self.assertEqual(fake.url,'https://lifeline-mt5-stage.mftintelligence.com/agent/pull')

    def test_disallow_nonstandard_https_port(self):
        with self.assertRaisesRegex(agent.AgentError,'nonstandard'):
            poller.HTTPSClient('https://lifeline-mt5-stage.mftintelligence.com:1234')
    def test_no_native_without_opt_in(self):
        from unittest.mock import patch
        unsigned={'job_id':'f1460f82-956f-44b7-802f-b3ac8c71f19e','issued_at':int(__import__('time').time()),
                  'nonce':'goodlongnonce12345678','operation':'compile','args':{},'tenant':'tenant-A'}
        job=dict(unsigned,signature=agent.sign(unsigned,KEY))
        class Fake:
            def post(self,path,body,h):
                if path=='/agent/pull':return {'schema':'lifeline.bridge.v1','job':job}
                return {'schema':'lifeline.bridge.v1','accepted':True,'job_id':job['job_id']}
        with patch.dict(__import__('os').environ,{'LIFELINE_ALLOW_NATIVE_DEVELOPMENT':'0'}):
            worker=poller.OutboundAgent(Fake(),'agent-A','tenant-A',KEY,Path(self.tmp.name)/'non-native')
            with self.assertRaisesRegex(agent.AgentError,'requires explicit'):worker.step()

    def test_private_mcp_rejects_extra_envelope_fields_and_nonconforming_ids(self):
        invalid=[
            {'jsonrpc':'2.0','id':1,'method':'tools/list','extra':'unsafe'},
            {'jsonrpc':'2.0','id':True,'method':'tools/list'},
            {'jsonrpc':'2.0','id':None,'method':'tools/list'},
            {'jsonrpc':'2.0','id':1.5,'method':'tools/list'},
            {'jsonrpc':'2.0','method':'tools/list'},
            {'jsonrpc':'2.0','id':'x'*200,'method':'tools/list'},
        ]
        for payload in invalid:
            with self.subTest(payload=payload):
                response=self.tc.post('/mcp',json=payload,headers=self.edge_headers)
                self.assertEqual(response.status_code,400)

    def test_private_mcp_ping_listing_and_initialize_require_object_parameters(self):
        invalid=[
            {'jsonrpc':'2.0','id':1,'method':'tools/list','params':{'unexpected':'order_send'}},
            {'jsonrpc':'2.0','id':2,'method':'ping','params':['unexpected']},
            {'jsonrpc':'2.0','id':3,'method':'initialize','params':'unexpected'},
        ]
        for payload in invalid:
            with self.subTest(payload=payload):
                response=self.tc.post('/mcp',json=payload,headers=self.edge_headers)
                self.assertEqual(response.status_code,200)
                self.assertEqual(response.json()['error']['code'],-32602)


    def test_mcp_legacy_initialized_notification_has_202_empty_reply(self):
        body={'jsonrpc':'2.0','method':'notifications/initialized'}
        denied=self.tc.post('/mcp',json=body)
        self.assertEqual(denied.status_code,401)
        accepted=self.tc.post('/mcp',json=body,headers=self.edge_headers)
        self.assertEqual(accepted.status_code,202)
        self.assertEqual(accepted.content,b'')
        for bad in ({**body,'id':2},{**body,'params':{'unsafe':True}},
                    {**body,'unexpected':'shell'},{**body,'params':[]}):
            with self.subTest(body=bad):
                response=self.tc.post('/mcp',json=bad,headers=self.edge_headers)
                self.assertEqual(response.status_code,400)


    def test_private_mcp_initialize_requires_bounded_client_protocol_fields(self):
        base={'jsonrpc':'2.0','id':44,'method':'initialize'}
        good={'protocolVersion':'2025-03-26','capabilities':{},
              'clientInfo':{'name':'lifeline-offline-client','version':'1.0.0'}}
        invalid=[None,{},[],
             {'protocolVersion':'bad','capabilities':{},'clientInfo':good['clientInfo']},
             {'protocolVersion':'2025-03-26','capabilities':None,'clientInfo':good['clientInfo']},
             {'protocolVersion':'2025-03-26','capabilities':[],'clientInfo':good['clientInfo']},
             {**good,'clientInfo':{}},
             {**good,'clientInfo':{'name':'','version':'1.0.0'}},
             {**good,'clientInfo':{'name':'x','version':'v','trade':True}},
             {**good,'command':'order_send'}]
        for params in invalid:
            with self.subTest(params=params):
                request=dict(base)
                if params is not None:request['params']=params
                resp=self.tc.post('/mcp',json=request,headers=self.edge_headers)
                self.assertEqual(resp.status_code,200)
                self.assertEqual(resp.json()['error']['code'],-32602)
        allowed=self.tc.post('/mcp',json={**base,'params':good},headers=self.edge_headers)
        self.assertEqual(allowed.status_code,200)
        self.assertEqual(allowed.json()['result']['protocolVersion'],'2025-03-26')

if __name__=='__main__':unittest.main()
