"""MCN-072 GET-only Worker bindings: adversarial source-level contracts."""
import importlib.util
import json
import pathlib
import unittest
import urllib.error
from unittest.mock import patch

ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('audit',ROOT/'qualification/mcn072_worker_queue_bindings_readonly.py')
audit=importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)

QID='a'*32
HID='b'*32
class FakeResponse:
    status=200
    headers={'Content-Type':'application/json'}
    def __init__(self,obj): self.obj=obj
    def __enter__(self):return self
    def __exit__(self,*args):pass
    def read(self,*args):return json.dumps(self.obj).encode()
class Fake:
    def __init__(self,workers=None,settings=None,fail=None,queue_id=QID):
        self.workers=['musitu-scheduler','other-worker'] if workers is None else workers
        self.settings=({self.workers[0]:[
            {'type':'queue','queue_name':'safe-target'},
            {'type':'hyperdrive','id':HID}],
            self.workers[-1]:[{'type':'queue','queue_name':'unrelated'}]}
            if settings is None and self.workers else settings or {})
        self.fail=fail
        self.calls=[]
        self.queue_id=queue_id
    def open(self,req,timeout):
        assert req.get_method()=='GET'
        assert req.full_url.startswith(audit.BASE+audit.PREFIX)
        self.calls.append(req.full_url)
        if self.fail=='redirect':raise urllib.error.HTTPError(req.full_url,302,'redirect',{},None)
        if self.fail=='403':raise urllib.error.HTTPError(req.full_url,403,'denied',{},None)
        if req.full_url.endswith('queues?page=1&per_page=100'):
            o={'result':[{'queue_id':self.queue_id}], 'result_info':{'page':1,'total_pages':1,'total_count':1}}
        elif req.full_url.endswith('/queues/'+self.queue_id):
            o={'result':{'queue_id':self.queue_id,'queue_name':'safe-target'}}
        elif req.full_url.endswith('/workers/scripts'):
            o={'result':[{'id':x} for x in self.workers],
               'result_info':{'page':1,'total_pages':1,'total_count':len(self.workers)}}
        else:
            worker=req.full_url.split('/workers/scripts/',1)[1].split('/settings')[0]
            o={'result':{'bindings':self.settings.get(worker,[])}}
        return FakeResponse({'success':True,**o})

class TestAudit(unittest.TestCase):
    def test_get_only_matches_and_never_claims_fairness(self):
        f=Fake()
        v=audit.scan('fake-pinned-token-123',f)
        self.assertEqual(v['worker_count_scanned'],2)
        self.assertTrue(v['worker_inventory_complete'])
        self.assertEqual(len(v['queue_producer_binding_candidates']),1)
        self.assertEqual(len(v['hyperdrive_binding_candidates']),1)
        self.assertFalse(v['mcn072_qualified'])
        self.assertFalse(v['postgres_scheduler_correlated'])
        self.assertFalse(v['tenant_mapping_verified'])
        self.assertTrue(all('/client/v4/accounts/'+audit.ACCOUNT in x for x in f.calls))
        self.assertNotIn('musitu-scheduler',json.dumps(v))
        self.assertNotIn('safe-target',json.dumps(v))
    def test_no_token_no_request(self):
        f=Fake()
        with self.assertRaisesRegex(audit.GateError,'TOKEN_UNAVAILABLE'):audit.scan('',f)
        self.assertEqual(f.calls,[])
    def test_redirect_denied(self):
        with self.assertRaisesRegex(audit.GateError,'API_HTTP_302'):audit.scan('fake-pinned-token-123',Fake(fail='redirect'))
    def test_403_denied(self):
        with self.assertRaisesRegex(audit.GateError,'API_HTTP_403'):audit.scan('fake-pinned-token-123',Fake(fail='403'))
    def test_other_url_denied(self):
        with self.assertRaisesRegex(audit.GateError,'URL_NOT_ALLOWED'):
            audit.get(audit.PREFIX+'/queues/'+QID+'/messages/pull','fake-pinned-token-123',Fake())
    def test_path_injection_worker_denied_before_settings(self):
        f=Fake(workers=['../../bad'],settings={})
        with self.assertRaisesRegex(audit.GateError,'WORKER_ID_INVALID'):audit.scan('fake-pinned-token-123',f)
        self.assertEqual(len(f.calls),3)
    def test_duplicate_worker_denied(self):
        f=Fake(workers=['same','same'],settings={'same':[]})
        with self.assertRaisesRegex(audit.GateError,'WORKER_ID_INVALID_OR_DUPLICATED'):audit.scan('fake-pinned-token-123',f)
    def test_scripts_bounded(self):
        f=Fake(workers=[f'w{i}' for i in range(101)],settings={})
        with self.assertRaisesRegex(audit.GateError,'WORKER_LIST_EXCEEDS_BOUND'):audit.scan('fake-pinned-token-123',f)
    def test_missing_settings_denied(self):
        f=Fake(settings={'musitu-scheduler':None,'other-worker':[]})
        with self.assertRaisesRegex(audit.GateError,'WORKER_SETTINGS_BINDINGS_UNKNOWN'):
            audit.scan('fake-pinned-token-123',f)
    def test_unrelated_queue_not_candidate(self):
        f=Fake(settings={'musitu-scheduler':[{'type':'queue','queue_name':'unrelated'}],
                         'other-worker':[]})
        v=audit.scan('fake-pinned-token-123',f)
        self.assertEqual(v['queue_producer_binding_candidates'],[])
        self.assertFalse(v['mcn072_qualified'])
    def test_bad_hyperdrive_id_refused(self):
        f=Fake(settings={'musitu-scheduler':[{'type':'hyperdrive','id':'not-an-id'}],'other-worker':[]})
        with self.assertRaisesRegex(audit.GateError,'HYPERDRIVE_BINDING_ID_INVALID'):
            audit.scan('fake-pinned-token-123',f)
    def test_plain_text_binding_not_disclosed(self):
        f=Fake(settings={'musitu-scheduler':[{'type':'plain_text','name':'PRIVATE','text':'DO_NOT_LEAK'}],
                         'other-worker':[]})
        v=audit.scan('fake-pinned-token-123',f)
        self.assertNotIn('DO_NOT_LEAK',json.dumps(v))
    def test_no_fake_negative_without_inventory_pagination(self):
        f=Fake()
        old=f.open
        def open_missing_info(req,timeout):
            response=old(req,timeout)
            if req.full_url.endswith('/workers/scripts'):
                response.obj.pop('result_info')
            return response
        f.open=open_missing_info
        self.assertFalse(audit.scan('fake-pinned-token-123',f)['worker_inventory_complete'])

if __name__=='__main__':unittest.main()
