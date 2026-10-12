import http.server
import json
import secrets
import threading
import unittest
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from b12_runner import Broker, TASKS

class LocalSyntheticBrokerTests(unittest.TestCase):
    def setUp(self):
        Broker.state={k:{'token':secrets.token_urlsafe(15),'requests':0,'times':[]} for k in TASKS}
        Broker.first_arrivals=set()
        self.server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Broker)
        self.t=threading.Thread(target=self.server.serve_forever,daemon=True);self.t.start()
        self.base='http://127.0.0.1:'+str(self.server.server_address[1])+'/v1/chat/completions'
    def tearDown(self):self.server.shutdown();self.server.server_close()
    def ask(self,who,token=None,**extra):
        req={'model':'b12-synthetic','messages':[{'role':'user','content':'synthetic'}],
            'tools':[{'function':{'name':'file_editor'}},{'function':{'name':'finish'}}]}
        req.update(extra)
        r=Request(self.base,json.dumps(req).encode(),{'Authorization':'Bearer '+(token if token is not None else Broker.state[who]['token']),'X-Axiom-Workload-ID':who},method='POST')
        with urlopen(r,timeout=6) as resp:return json.load(resp)
    def test_bad_credential_is_rejected_before_quota_mutation(self):
        with self.assertRaises(HTTPError) as e:self.ask('agent-a','incorrect')
        self.assertEqual(e.exception.code,403)
        self.assertEqual(Broker.state['agent-a']['requests'],0)
    def test_stream_request_fails_closed_before_quota_mutation(self):
        with self.assertRaises(HTTPError) as e:self.ask('agent-a',stream=True)
        self.assertEqual(e.exception.code,403)
        self.assertEqual(Broker.state['agent-a']['requests'],0)
    def test_unknown_model_fails_closed(self):
        with self.assertRaises(HTTPError) as e:self.ask('agent-a',model='fake-provider')
        self.assertEqual(e.exception.code,403)
        self.assertEqual(Broker.state['agent-a']['requests'],0)
    def test_concurrent_first_requests_pass_barrier_and_return_distinct_actions(self):
        outputs={};failures={}
        def f(k):
            try:outputs[k]=self.ask(k)
            except Exception as e:failures[k]=str(e)
        a=threading.Thread(target=f,args=('agent-a',));b=threading.Thread(target=f,args=('agent-b',))
        a.start();b.start();a.join(timeout=7);b.join(timeout=7)
        self.assertFalse(failures,failures)
        self.assertEqual(set(outputs),set(TASKS))
        self.assertEqual(set(Broker.first_arrivals),set(TASKS))
        for k in TASKS:
            self.assertEqual(outputs[k]['choices'][0]['message']['tool_calls'][0]['function']['name'],'file_editor')
            self.assertEqual(Broker.state[k]['requests'],1)
            self.assertIn(k,outputs[k]['choices'][0]['message']['tool_calls'][0]['function']['arguments'])
    def test_cap_after_three_calls_denies_without_increment(self):
        Broker.first_arrivals=set(TASKS)
        for index in range(3):self.assertEqual(self.ask('agent-a')['choices'][0]['message']['tool_calls'][0]['function']['name'], ['file_editor','file_editor','finish'][index])
        with self.assertRaises(HTTPError) as e:self.ask('agent-a')
        self.assertEqual(e.exception.code,429)
        self.assertEqual(Broker.state['agent-a']['requests'],3)

if __name__=='__main__':unittest.main()