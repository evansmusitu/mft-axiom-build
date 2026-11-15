import hashlib
import json
import unittest
from qualification.mcn072_static_link_getonly import inspect_static

A='93f395f5121954671f92fffa453d6b61'
Q='mcn072-queue-consumer-fixture'
P='mcn072-pg-worker-fixture'
QH=hashlib.sha256(Q.encode()).hexdigest()
PH=hashlib.sha256(P.encode()).hexdigest()
V='11111111-1111-4111-8111-111111111111'
ROOT=f'/accounts/{A}/workers/scripts'

def provider(*, linked=True, table=True, duplicates=False, percent=100):
    names=[Q,P,P] if duplicates else [Q,P]
    def get(path):
        if path==ROOT:return {'success':True,'result':[{'id':n} for n in names]}
        if path.endswith('/deployments'):
            return {'success':True,'result':{'deployments':[{'versions':[{'version_id':V,'percentage':percent}]}]}}
        if f'/versions/{V}' in path:
            handlers=['queue'] if f'/{Q}/' in path else ['fetch']
            return {'success':True,'result':{'resources':{'script':{'handlers':handlers},'bindings':[]}}}
        raise AssertionError('unexpected provider path: '+path)
    def content(path):
        if path==f'{ROOT}/{Q}/content/v2':
            return (('const url = "'+P+'";') if linked else 'const url = "unrelated";').encode()
        if path==f'{ROOT}/{P}/content/v2':
            return (('const x = "axiom_tenant_fair_cursor";') if table else 'export default {fetch(){}};').encode()
        raise AssertionError('unexpected content path: '+path)
    return get,content

class StaticLinkTests(unittest.TestCase):
    def test_positive_literal_is_static_only_not_postgres_qualification(self):
        get, content=provider()
        r=inspect_static(get,content,A,QH,PH)
        self.assertTrue(r['read_complete'])
        self.assertTrue(r['queue_candidate_literal_reference'])
        self.assertEqual(r['candidate_scheduler_table_marker_count'],1)
        self.assertEqual(r['queue_handler_observed'],True)
        self.assertEqual(r['candidate_fetch_handler_observed'],True)
        self.assertFalse(r['postgres_authenticated'])
        self.assertFalse(r['mcn072_qualified'])
    def test_no_cross_reference_not_evidence_absent_runtime_link(self):
        get,content=provider(linked=False,table=False)
        r=inspect_static(get,content,A,QH,PH)
        self.assertTrue(r['read_complete'])
        self.assertFalse(r['queue_candidate_literal_reference'])
        self.assertEqual(r['candidate_scheduler_table_marker_count'],0)
        self.assertFalse(r['mcn072_qualified'])
    def test_duplicate_worker_fails_closed(self):
        get,content=provider(duplicates=True)
        r=inspect_static(get,content,A,QH,PH)
        self.assertFalse(r['read_complete'])
    def test_deployment_percent_invalid_fails_closed(self):
        get,content=provider(percent=95)
        r=inspect_static(get,content,A,QH,PH)
        self.assertFalse(r['read_complete'])
    def test_secret_like_literals_never_echoed(self):
        get,content=provider()
        def seeded(p):
            return content(p)+b' postgres://username:superSecret@somehost/db  TokenABC'
        r=inspect_static(get,seeded,A,QH,PH)
        s=json.dumps(r)
        for needle in ['superSecret','username','somehost','TokenABC',Q,P]:
            self.assertNotIn(needle,s)
    def test_network_failure_fails_closed(self):
        def nope(_):raise RuntimeError('connection secret found')
        r=inspect_static(nope,nope,A,QH,PH)
        self.assertFalse(r['read_complete'])
        self.assertNotIn('secret found',json.dumps(r))

if __name__=='__main__':unittest.main()
