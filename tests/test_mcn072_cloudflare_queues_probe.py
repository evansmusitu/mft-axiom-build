import importlib.util
import io
import json
import pathlib
import unittest
import urllib.error
from unittest.mock import patch

root = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('probe', root/'qualification/mcn072_cloudflare_queues_probe.py')
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)
QUEUE = 'a' * 32


class FakeResponse:
    status = 200
    headers = {'Content-Type':'application/json'}
    def __init__(self, obj): self.obj = obj
    def __enter__(self): return self
    def __exit__(self, *a): pass
    def read(self, *a): return json.dumps(self.obj).encode()


class Opener:
    def __init__(self, *, bad=None, queues=None):
        self.paths = []
        self.bad = bad
        self.queues = queues if queues is not None else [QUEUE]
    def open(self, req, timeout):
        assert req.get_method() == 'GET'
        assert req.full_url.startswith(p.ORIGIN+p.PREFIX)
        self.paths.append(req.full_url)
        if self.bad == 'redirect': raise urllib.error.HTTPError(req.full_url,302,'redirect',{},None)
        if self.bad == 'forbidden': raise urllib.error.HTTPError(req.full_url,403,'denied',{},None)
        if req.full_url.endswith('page=1&per_page=100'):
            return FakeResponse({'success':True,'result':[{'queue_id':q} for q in self.queues],
                                 'result_info':{'total_pages':1,'page':1,'total_count':len(self.queues)}})
        return FakeResponse({'success':True,'result':{'backlog_bytes':2,'backlog_count':1,
                                                    'oldest_message_timestamp_ms':0}})


class Contracts(unittest.TestCase):
    def test_reads_only_pinned_paths_and_does_not_qualify(self):
        o=Opener(); r=p.inspect('test-token',o)
        self.assertEqual(r['queue_count'],1)
        self.assertEqual(len(o.paths),2)
        self.assertNotIn(QUEUE,str(r))
    def test_no_credentials_fails_before_network(self):
        o=Opener()
        with self.assertRaisesRegex(p.ProbeFailure,'AUTH_UNAVAILABLE'):
            p.inspect('',o)
        self.assertEqual(o.paths,[])
    def test_arbitrary_path_rejected(self):
        with self.assertRaisesRegex(p.ProbeFailure,'PATH_NOT_ALLOWLISTED'):
            p.fetch(p.PREFIX+'/messages/pull','token',Opener())
    def test_redirect_rejected(self):
        with self.assertRaisesRegex(p.ProbeFailure,'UPSTREAM_HTTP_302'):
            p.inspect('token',Opener(bad='redirect'))
    def test_forbidden_rejected(self):
        with self.assertRaisesRegex(p.ProbeFailure,'UPSTREAM_HTTP_403'):
            p.inspect('token',Opener(bad='forbidden'))
    def test_duplicate_queue_rejected(self):
        with self.assertRaisesRegex(p.ProbeFailure,'QUEUE_IDENTIFIER_INVALID'):
            p.inspect('token',Opener(queues=[QUEUE, QUEUE]))
    def test_malicious_queue_id_rejected_before_metrics(self):
        o=Opener(queues=['https://evil.example/secret'])
        with self.assertRaisesRegex(p.ProbeFailure,'QUEUE_IDENTIFIER_INVALID'):
            p.inspect('token',o)
        self.assertEqual(len(o.paths),1)
    def test_bounded_inventory(self):
        with self.assertRaisesRegex(p.ProbeFailure,'INVENTORY_EXCEEDS_SAFE_BOUND'):
            p.inspect('token',Opener(queues=[format(i,'032x') for i in range(33)]))
    def test_boolean_as_metric_rejected(self):
        self.assertRaises(p.ProbeFailure,p.checked_int,True,'COUNT')
    def test_oldest_future_rejected(self):
        self.assertRaises(p.ProbeFailure,p.checked_int,-1,'AGE')
    def test_queue_not_promoted_to_tenant_fairness(self):
        with patch.object(p,'inspect',return_value={'queue_count':1,'queue_observations':[]}):
            with patch.object(p,'OUT',pathlib.Path('/tmp/mcn072-test-probe-output.json')):
                with patch.dict(p.os.environ,{'CLOUDFLARE_API_TOKEN':'test-token'}):
                    self.assertEqual(p.main(),0)
                    doc=json.loads(pathlib.Path('/tmp/mcn072-test-probe-output.json').read_text())
                    self.assertFalse(doc['mcn072_qualified'])
                    self.assertFalse(doc['tenant_mapping_verified'])
                    self.assertFalse(doc['postgres_scheduler_correlated'])
                    self.assertFalse(doc['fairness_attested'])

if __name__ == '__main__': unittest.main()
