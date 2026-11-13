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
        if path not in rows:
            raise D.ProbeFailure('TEST_ENDPOINT_UNAVAILABLE')
        obj=rows[path]
        return obj, hashlib.sha256(json.dumps(obj,sort_keys=True).encode()).hexdigest()
    with patch.object(D, 'fetch', side_effect=fake), patch.object(D, 'fetch_worker_content', side_effect=D.ProbeFailure('TEST_SOURCE_UNAVAILABLE')):
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

    def _deployment_sample(self, handlers=('fetch','queue')):
        worker='candidate-worker'
        row={'consumer_id':CID,'type':'worker','queue_name':'private-queue','script':worker}
        rows=data(detail=row, listed=row, exact=row)
        rows['/client/v4/accounts/'+ACCOUNT+'/workers/scripts']['result']=[{'id':worker}]
        version='1a2b3c4d-1111-2222-3333-444455556666'
        deployments='/client/v4/accounts/'+ACCOUNT+'/workers/scripts/'+worker+'/deployments'
        version_path='/client/v4/accounts/'+ACCOUNT+'/workers/scripts/'+worker+'/versions/'+version
        rows[deployments]={'success':True,'result':{'deployments':[{'id':version,'versions':[{'version_id':version,'percentage':100}]}]}}
        rows[version_path]={'success':True,'result':{'id':version,'resources':{'script':{'handlers':list(handlers)},'bindings':[{'type':'hyperdrive','name':'PRIVATE_BINDING'}]}}}
        return rows, deployments, version_path

    def test_active_deployed_version_queue_handler_observed_not_fairness(self):
        rows,_,_=self._deployment_sample()
        result=run(rows)
        self.assertTrue(result['worker_script_alias_correspondence_observed'])
        self.assertTrue(result.get('active_deployed_queue_handler_observed', False))
        self.assertEqual(result.get('deployment_observation_status'),'QUEUE_HANDLER_OBSERVED_ONLY')
        self.assertFalse(result['postgres_scheduler_correspondence_qualified'])
        self.assertFalse(result['tenant_fairness_qualified'])
        self.assertNotIn('PRIVATE_BINDING',json.dumps(result))

    def test_deployed_version_without_queue_handler_not_promoted(self):
        rows,_,_=self._deployment_sample(('fetch',))
        self.assertFalse(run(rows).get('active_deployed_queue_handler_observed',False))

    def test_invalid_deployment_version_rejected_without_secret_leak(self):
        rows,path,_=self._deployment_sample()
        rows[path]['result']['deployments'][0]['versions'][0]['version_id']='../secret'
        result=run(rows)
        self.assertFalse(result.get('active_deployed_queue_handler_observed', False))
        self.assertEqual(result.get('deployment_observation_status'),'BLOCKED')
        self.assertNotIn('../secret',json.dumps(result))

    def test_multiple_versions_not_claimed_as_single_active_handler(self):
        rows,path,_=self._deployment_sample()
        rows[path]['result']['deployments'][0]['versions'].append({'version_id':'1a2b3c4d-1111-2222-3333-444455556667','percentage':30})
        result=run(rows)
        self.assertFalse(result.get('active_deployed_queue_handler_observed', False))
        self.assertEqual(result.get('deployment_observation_status'),'BLOCKED')

    def test_unobserved_alias_skips_deployment(self):
        result=run(data())
        self.assertEqual(result.get('deployment_observation_status'),'NO_MATCHING_WORKER_CANDIDATE')
        self.assertFalse(result.get('active_deployed_queue_handler_observed', False))

    def _run_with_content_sha(self, rows, digest):
        def fake(path, token, opener):
            if path not in rows:
                raise D.ProbeFailure('TEST_ENDPOINT_UNAVAILABLE')
            obj=rows[path]
            return obj, hashlib.sha256(json.dumps(obj,sort_keys=True).encode()).hexdigest()
        content={'content_provenance_status':'CURRENT_SCRIPT_CONTENT_ONLY',
                 'worker_script_content_sha256':digest,
                 'worker_script_content_bytes':4096,
                 'content_matches_active_version_qualified':False,
                 'mcn072_qualified':False}
        with patch.object(D,'fetch',side_effect=fake), patch.object(D,'fetch_worker_content',return_value=content):
            return D.inspect('private-test-token',object())

    def test_matching_active_version_etag_and_current_script_digest_is_observation_only(self):
        rows,_,version_path=self._deployment_sample()
        digest='a'*64
        rows[version_path]['result']['resources']['script']['etag']=digest
        result=self._run_with_content_sha(rows,digest)
        self.assertTrue(result['active_version_content_sha256_equality_observed'])
        self.assertEqual(result['active_version_etag_sha256'],hashlib.sha256(digest.encode()).hexdigest())
        self.assertFalse(result['content_matches_active_version_qualified'])
        self.assertFalse(result['tenant_fairness_qualified'])
        self.assertFalse(result['mcn072_qualified'])

    def test_mismatched_current_script_digest_never_promotes_version_content(self):
        rows,_,version_path=self._deployment_sample()
        rows[version_path]['result']['resources']['script']['etag']='b'*64
        result=self._run_with_content_sha(rows,'a'*64)
        self.assertFalse(result['active_version_content_sha256_equality_observed'])
        self.assertFalse(result['content_matches_active_version_qualified'])

    def test_missing_or_opaque_etag_cannot_be_called_corresponding_content(self):
        rows,_,version_path=self._deployment_sample()
        for val in (None, 'secret-invalid-opaque-etag'):
            if val is None:rows[version_path]['result']['resources']['script'].pop('etag',None)
            else:rows[version_path]['result']['resources']['script']['etag']=val
            result=self._run_with_content_sha(rows,'a'*64)
            self.assertFalse(result['active_version_content_sha256_equality_observed'])
            self.assertNotIn('secret-invalid-opaque-etag',json.dumps(result))

    def test_multipart_raw_boundary_changes_do_not_change_module_payload_digest(self):
        source=b'export default { async queue() { return 123; } }'
        def body(boundary):
            b=boundary.encode()
            return (b'--'+b+b'\r\nContent-Disposition: form-data; name="main"; filename="worker.mjs"\r\n'
                    b'Content-Type: application/javascript\r\n\r\n'+source+b'\r\n--'+b+b'--\r\n')
        def get(raw, boundary):
            class Resp:
                status=200
                headers={'Content-Type':f'multipart/form-data; boundary={boundary}'}
                def __enter__(self):return self
                def __exit__(self,*a):return False
                def read(self,n):return raw[:n]
            class Opener:
                def open(self,*a,**k):return Resp()
            return D.fetch_worker_content('candidate-worker','valid-secret-token-123',Opener())
        first=get(body('firstboundary'),'firstboundary')
        second=get(body('secondboundary'),'secondboundary')
        self.assertNotEqual(first['worker_script_content_sha256'],second['worker_script_content_sha256'])
        self.assertEqual(first['canonical_module_content_sha256'],second['canonical_module_content_sha256'])
        self.assertEqual(first['javascript_module_part_count'],1)
        self.assertEqual(first['worker_content_mime_class'],'multipart/form-data')
        self.assertFalse(first['content_matches_active_version_qualified'])
        self.assertNotIn(source.decode(),json.dumps(first))

    def test_multipart_without_javascript_module_has_no_canonical_fingerprint(self):
        content=(b'--boundary123\r\nContent-Disposition: form-data; name="metadata"\r\n'
                 b'Content-Type: application/json\r\n\r\n{}\r\n--boundary123--\r\n')
        result=D.summarize_worker_content(content,'multipart/form-data; boundary=boundary123')
        self.assertIsNone(result['canonical_module_content_sha256'])
        self.assertEqual(result['javascript_module_part_count'],0)
        self.assertFalse(result['content_matches_active_version_qualified'])

    def test_two_get_replay_records_stable_canonical_content_without_qualifying_scheduler(self):
        rows,_,_=self._deployment_sample()
        fake_outputs=[{'content_provenance_status':'CURRENT_SCRIPT_CONTENT_ONLY',
                      'worker_script_content_sha256':c*64,'canonical_module_content_sha256':'c'*64,
                      'content_matches_active_version_qualified':False} for c in 'ab']
        def fake(path,token,opener):
            if path not in rows:raise D.ProbeFailure('TEST_ENDPOINT_UNAVAILABLE')
            obj=rows[path]
            return obj,hashlib.sha256(json.dumps(obj,sort_keys=True).encode()).hexdigest()
        with patch.object(D,'fetch',side_effect=fake),patch.object(D,'fetch_worker_content',side_effect=fake_outputs) as read:
            result=D.inspect('private-test-token',object())
        self.assertEqual(read.call_count,2)
        self.assertFalse(result['current_content_replay_raw_sha256_equal'])
        self.assertTrue(result['current_content_replay_canonical_modules_equal'])
        self.assertFalse(result['content_matches_active_version_qualified'])
        self.assertFalse(result['tenant_fairness_qualified'])
        self.assertFalse(result['mcn072_qualified'])

    def test_multipart_plain_text_js_filename_is_canonicalized_without_exporting_name(self):
        def package(boundary):
            return (b'--'+boundary.encode()+b'\r\nContent-Disposition: form-data; name="secret"; filename="private-worker.mjs"\r\n'
                    b'Content-Type: text/plain\r\n\r\nexport default { async queue() {} }\r\n--'+boundary.encode()+b'--\r\n')
        a=D.summarize_worker_content(package('oneboundary'),'multipart/form-data; boundary=oneboundary')
        b=D.summarize_worker_content(package('twoboundary'),'multipart/form-data; boundary=twoboundary')
        self.assertEqual(a['javascript_module_part_count'],1)
        self.assertEqual(a['canonical_module_content_sha256'],b['canonical_module_content_sha256'])
        self.assertNotIn('private-worker',json.dumps(a))
        self.assertFalse(a['content_matches_active_version_qualified'])

    def test_multipart_metadata_and_untrusted_non_script_name_not_canonicalized(self):
        raw=(b'--boundaryfoo\r\nContent-Disposition: form-data; name="meta"; filename="metadata.json"\r\n'
             b'Content-Type: application/json\r\n\r\n{ "secret": "HIDE" }\r\n'
             b'--boundaryfoo\r\nContent-Disposition: form-data; name="untrusted"\r\n'
             b'Content-Type: text/plain\r\n\r\nsecret text\r\n--boundaryfoo--\r\n')
        r=D.summarize_worker_content(raw,'multipart/form-data; boundary=boundaryfoo')
        self.assertEqual(r['javascript_module_part_count'],0)
        self.assertIsNone(r['canonical_module_content_sha256'])
        self.assertEqual(r['multipart_part_count'],2)
        self.assertNotIn('HIDE',json.dumps(r))

    def test_get_refuses_unapproved_path_before_network(self):
        class NoNetwork:
            def open(self,*args,**kwargs):raise AssertionError('called network')
        with self.assertRaises(D.ProbeFailure):D.fetch('/client/v4/user/tokens', 'valid-test-token-123', NoNetwork())

    def test_get_requires_token_before_network(self):
        class NoNetwork:
            def open(self,*args,**kwargs):raise AssertionError('called network')
        with self.assertRaises(D.ProbeFailure):D.fetch(PREFIX+'?page=1&per_page=100', '', NoNetwork())

    def test_worker_content_get_returns_only_digest_and_literal_marker_counts(self):
        self.assertTrue(hasattr(D, 'fetch_worker_content'))
        secret = 'MUST-NOT-LEAK-PROPRIETARY-SCRIPT-OR-SECRET'
        body = ("export default { async queue(batch, env) { "
                "/* axiom_tenant_fair_cursor axiom_distributed_execution_jobs */ "
                + secret + " }}").encode()
        class Resp:
            status=200
            headers={'Content-Type':'application/javascript'}
            def __enter__(self): return self
            def __exit__(self,*a):return False
            def read(self,n):return body
        class Opener:
            def __init__(self):self.requests=[]
            def open(self,request,timeout):self.requests.append(request);return Resp()
        opener=Opener()
        out=D.fetch_worker_content('candidate-worker','secret-token-example',opener)
        self.assertEqual(out['worker_script_content_sha256'],hashlib.sha256(body).hexdigest())
        self.assertEqual(out['pg_scheduler_table_literal_count'],2)
        self.assertEqual(out['content_provenance_status'],'CURRENT_SCRIPT_CONTENT_ONLY')
        self.assertFalse(out['content_matches_active_version_qualified'])
        self.assertFalse(out['postgres_correspondence_qualified'])
        self.assertNotIn(secret,json.dumps(out))
        self.assertEqual(opener.requests[0].get_method(),'GET')
        self.assertEqual(opener.requests[0].full_url,
            'https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+'/workers/scripts/candidate-worker/content/v2')

    def test_worker_content_get_rejects_unapproved_script_and_does_not_network(self):
        self.assertTrue(hasattr(D, 'fetch_worker_content'))
        class NoNetwork:
            def open(self,*args,**kwargs):raise AssertionError('network called')
        with self.assertRaises(D.ProbeFailure):
            D.fetch_worker_content('../private','secret-token-example',NoNetwork())

    def test_worker_content_get_rejects_redirect_or_oversize(self):
        self.assertTrue(hasattr(D, 'fetch_worker_content'))
        class Resp:
            def __init__(self,status,body):self.status=status;self.headers={'Content-Type':'application/javascript'};self.body=body
            def __enter__(self):return self
            def __exit__(self,*args):return False
            def read(self,n):return self.body[:n]
        class Opener:
            def __init__(self,resp):self.resp=resp
            def open(self,*a,**k):return self.resp
        with self.assertRaises(D.ProbeFailure):
            D.fetch_worker_content('candidate-worker','secret-token-example',Opener(Resp(302,b'redirect')))
        with self.assertRaises(D.ProbeFailure):
            D.fetch_worker_content('candidate-worker','secret-token-example',Opener(Resp(200,b'a' * (2*1024*1024+1))))

    def test_worker_content_no_privileged_claim_even_with_all_markers(self):
        self.assertTrue(hasattr(D, 'summarize_worker_content'))
        result=D.summarize_worker_content(b'axiom_tenant_fair_cursor axiom_tenant_fair_served axiom_distributed_execution_jobs')
        self.assertEqual(result['pg_scheduler_table_literal_count'],3)
        self.assertFalse(result['postgres_correspondence_qualified'])
        self.assertFalse(result['content_matches_active_version_qualified'])
        self.assertNotIn('raw_source',result)

if __name__=='__main__':unittest.main()
