"""MCN-072 consumer identity evidence: provider schema is not proof by inference."""
import hashlib
import importlib.util
import json
import pathlib
import unittest
from unittest.mock import patch

HERE = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('consumer_diag', HERE / 'qualification/mcn072_cloudflare_consumer_field_diag.py')
D = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(D)
QID = 'a' * 32
CID = 'b' * 32
ACCOUNT = '93f395f5121954671f92fffa453d6b61'
PREFIX = '/client/v4/accounts/' + ACCOUNT + '/queues'


def data(*, detail=None, listed=None, exact=None):
    base={'consumer_id': CID,'type':'worker','queue_name':'private-queue'}
    det=base if detail is None else detail
    lst=base if listed is None else listed
    exc=base if exact is None else exact
    return {
      PREFIX+'?page=1&per_page=100':{'success':True,'result':[{'queue_id':QID}], 'result_info':{'page':1,'total_pages':1,'total_count':1}},
      PREFIX+'/'+QID:{'success':True,'result':{'queue_id':QID,'queue_name':'private-queue','consumers':[det],'consumers_total_count':1}},
      PREFIX+'/'+QID+'/consumers':{'success':True,'result':[lst]},
      PREFIX+'/'+QID+'/consumers/'+CID:{'success':True,'result':exc},
      '/client/v4/accounts/'+ACCOUNT+'/workers/scripts':{'success':True,'result':[{'id':'other-worker'}]},
    }


def run(rows):
    def fake(path, token, opener):
        obj=rows[path]
        return obj, hashlib.sha256(json.dumps(obj,sort_keys=True).encode()).hexdigest()
    with patch.object(D, 'fetch', side_effect=fake):
        return D.inspect('private-test-token',object())

class CloudflareConsumerSchemaTests(unittest.TestCase):
    def test_missing_script_name_is_not_a_resolved_worker(self):
        outcome=run(data())
        self.assertEqual(outcome['consumer_count'],1)
        self.assertEqual(outcome['worker_consumer_count'],1)
        self.assertFalse(outcome['worker_script_identity_resolved'])
        self.assertEqual(outcome['worker_consumer_script_state'],'UNVERIFIABLE')
        self.assertFalse(outcome['tenant_fairness_qualified'])
        self.assertFalse(outcome['mcn072_qualified'])

    def test_matching_script_name_across_sources_yields_only_digest(self):
        worker='PRIVATE-WORKER-SECRET'
        rows=data(detail={'consumer_id':CID,'queue_name':'private-queue','type':'worker','script_name':worker},
                  listed={'consumer_id':CID,'queue_name':'private-queue','type':'worker','script_name':worker},
                  exact={'consumer_id':CID,'queue_name':'private-queue','type':'worker','script_name':worker})
        outcome=run(rows)
        self.assertTrue(outcome['worker_script_identity_resolved'])
        self.assertEqual(outcome['consumers'][0]['script_name_sha256'],hashlib.sha256(worker.encode()).hexdigest())
        self.assertNotIn(worker,json.dumps(outcome))
        self.assertFalse(outcome['mcn072_qualified'])

    def test_exact_only_can_supply_worker_digest_without_inference(self):
        o=run(data(exact={'consumer_id':CID,'type':'worker','queue_name':'private-queue','script_name':'private-worker'}))
        self.assertTrue(o['worker_script_identity_resolved'])
        self.assertEqual(o['consumers'][0]['script_name_present'],{'queue_detail':False,'consumer_list':False,'consumer_exact':True})

    def test_mismatched_script_names_fail_closed(self):
        rows=data(listed={'consumer_id':CID,'type':'worker','script_name':'worker-A'},exact={'consumer_id':CID,'type':'worker','script_name':'worker-B'})
        with self.assertRaises(D.ProbeFailure):run(rows)

    def test_mismatched_exact_consumer_id_fail_closed(self):
        with self.assertRaises(D.ProbeFailure):run(data(exact={'consumer_id':'c'*32,'type':'worker'}))

    def test_mismatched_consumer_type_fail_closed(self):
        with self.assertRaises(D.ProbeFailure):run(data(exact={'consumer_id':CID,'type':'http_pull'}))

    def test_consumer_list_must_match_queue_detail(self):
        with self.assertRaises(D.ProbeFailure):run(data(listed={'consumer_id':'c'*32,'type':'worker'}))

    def test_unsupported_consumer_type_fail_closed(self):
        with self.assertRaises(D.ProbeFailure):run(data(exact={'consumer_id':CID,'type':'new-provider-type'}))

    def test_wrong_queue_identity_fail_closed(self):
        rows=data();rows[PREFIX+'/'+QID]['result']['queue_id']='c'*32
        with self.assertRaises(D.ProbeFailure):run(rows)

    def test_unverified_queue_inventory_fails_closed(self):
        rows=data();rows[PREFIX+'?page=1&per_page=100']['result_info']['total_count']=2
        with self.assertRaises(D.ProbeFailure):run(rows)

    def test_do_not_leak_sensitive_provider_fields(self):
        raw='SENSITIVE-CREDENTIAL-DO-NOT-EXPORT'
        rows=data(detail={'consumer_id':CID,'type':'worker','queue_name':'private-queue','secret':raw,'script':raw})
        self.assertNotIn(raw,json.dumps(run(rows)))

    def test_reject_missing_consumer_id(self):
        with self.assertRaises(D.ProbeFailure):run(data(detail={'type':'worker'}))

    def test_queue_detail_with_no_consumers_fails_if_list_has_one(self):
        rows=data();rows[PREFIX+'/'+QID]['result']['consumers']=[]
        with self.assertRaises(D.ProbeFailure):run(rows)

    def test_no_script_name_alternate_key_does_not_infer(self):
        rows=data(exact={'consumer_id':CID,'type':'worker','script':'private-worker'})
        o=run(rows)
        self.assertFalse(o['worker_script_identity_resolved'])
        self.assertTrue(o['consumers'][0]['known_field_presence']['consumer_exact']['script'])

    def test_consistent_script_alias_matches_worker_inventory_only_as_candidate(self):
        alias='INTERNAL-WORKER-CANDIDATE'
        source={'consumer_id':CID,'type':'worker','queue_name':'private-queue','script':alias}
        rows=data(detail=source, listed=source, exact=source)
        rows['/client/v4/accounts/'+ACCOUNT+'/workers/scripts']['result']=[{'id':alias}]
        result=run(rows)
        self.assertTrue(result.get('worker_script_alias_correspondence_observed'))
        self.assertEqual(result['consumers'][0]['script_alias_sha256'],hashlib.sha256(alias.encode()).hexdigest())
        self.assertFalse(result['mcn072_qualified'])
        self.assertNotIn(alias,json.dumps(result))

    def test_script_alias_only_on_exact_response_is_not_correspondence(self):
        rows=data(exact={'consumer_id':CID,'type':'worker','script':'alias-worker'})
        rows['/client/v4/accounts/'+ACCOUNT+'/workers/scripts']['result']=[{'id':'alias-worker'}]
        self.assertFalse(run(rows).get('worker_script_alias_correspondence_observed',False))

    def test_alias_not_in_worker_inventory_is_unqualified(self):
        source={'consumer_id':CID,'type':'worker','script':'not-listed'}
        self.assertFalse(run(data(detail=source,listed=source,exact=source)).get('worker_script_alias_correspondence_observed',False))

    def test_conflicting_script_aliases_rejected(self):
        source={'consumer_id':CID,'type':'worker','script':'one'}
        rows=data(detail=source,listed=source,exact={'consumer_id':CID,'type':'worker','script':'two'})
        with self.assertRaises(D.ProbeFailure):run(rows)

    def test_script_alias_object_not_promoted_to_worker_identity(self):
        source={'consumer_id':CID,'type':'worker','script':{'name':'hidden-worker'}}
        r=run(data(detail=source,listed=source,exact=source))
        self.assertFalse(r.get('worker_script_alias_correspondence_observed',False))
        self.assertTrue(r.get('consumers') and 'script_alias_field_types' in r['consumers'][0])
        self.assertEqual(r['consumers'][0]['script_alias_field_types']['consumer_exact'],'object')
        self.assertNotIn('hidden-worker',json.dumps(r))

    def test_duplicate_worker_inventory_rejected(self):
        rows=data()
        rows['/client/v4/accounts/'+ACCOUNT+'/workers/scripts']['result']=[{'id':'duplicate'},{'id':'duplicate'}]
        with self.assertRaises(D.ProbeFailure):run(rows)

    def test_get_refuses_unapproved_path_before_network(self):
        class NoNetwork:
            def open(self,*args,**kwargs):raise AssertionError('called network')
        with self.assertRaises(D.ProbeFailure):D.fetch('/client/v4/user/tokens', 'valid-test-token-123', NoNetwork())

    def test_get_requires_token_before_network(self):
        class NoNetwork:
            def open(self,*args,**kwargs):raise AssertionError('called network')
        with self.assertRaises(D.ProbeFailure):D.fetch(PREFIX+'?page=1&per_page=100', '', NoNetwork())

if __name__=='__main__':unittest.main()
