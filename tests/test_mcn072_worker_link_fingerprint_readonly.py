import unittest
from qualification import mcn072_worker_link_fingerprint_readonly as p

class ContentLinkContract(unittest.TestCase):
    def test_no_raw_content_or_names_ever_exported(self):
        qname='queue-name'; cname='candidate-name'; content=b"import { neon } from 'neon-js'; fetch('https://candidate-name.workers.dev'); axiom_tenant_fair_cursor"; candidate=b'axiom_distributed_execution_jobs DATABASE_URL'
        result=p.fingerprint_pair(qname,cname,content,candidate)
        self.assertTrue(result['candidate_name_literal_in_queue_current_content'])
        self.assertTrue(result['queue_current_content_neon_cue'])
        self.assertTrue(result['queue_current_content_fair_cursor_cue'])
        self.assertTrue(result['candidate_current_content_job_table_cue'])
        for raw in ['queue-name','candidate-name','neon-js','workers.dev','axiom_tenant_fair_cursor','DATABASE_URL']:
            self.assertNotIn(raw,str(result))
        self.assertFalse(result['correspondence_authenticated'])

    def test_absent_markers_do_not_prove_no_connection(self):
        r=p.fingerprint_pair('queue-worker-full','candidate-worker-full',b'const x=42',b'console.log(1)')
        self.assertFalse(r['candidate_name_literal_in_queue_current_content'])
        self.assertFalse(r['correspondence_authenticated'])
        self.assertEqual(r['source_scope'],'CURRENT_CONTENT_ONLY_NOT_DEPLOYED_VERSION')

    def test_duplicates_and_missing_targets_fail_closed(self):
        def fake_get(path):return {'result':[{'id':'queue-name'},{'id':'queue-name'},{'id':'candidate-name'}]}
        def fake_binary(path):raise AssertionError('should not read content after duplicate script list')
        r=p.inspect_pair(fake_get,fake_binary,'a'*32,p.digest('queue-name'),p.digest('candidate-name'))
        self.assertFalse(r['source_pair_complete'])
        self.assertFalse(r['correspondence_authenticated'])

    def test_pair_uses_only_two_exact_worker_content_paths(self):
        calls=[]
        def get(path):return {'result':[{'id':'queue-name'},{'id':'candidate-name'}]}
        def binary(path):
            calls.append(path)
            return b'hello'
        r=p.inspect_pair(get,binary,'a'*32,p.digest('queue-name'),p.digest('candidate-name'))
        self.assertTrue(r['source_pair_complete'])
        self.assertEqual(len(calls),2)
        self.assertTrue(all(path.endswith('/content/v2') and path.startswith('/accounts/'+'a'*32+'/workers/scripts/') for path in calls))
        self.assertNotIn('queue-name',str(r))

if __name__=='__main__':unittest.main()
