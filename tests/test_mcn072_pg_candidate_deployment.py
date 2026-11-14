import unittest
from qualification import mcn072_pg_candidate_deployment_readonly as p

class TargetedAudit(unittest.TestCase):
    def test_cue_classifies_pg_and_generic_without_values(self):
        b=[{'name':'DATABASE_URL','type':'secret_text','text':'postgres://secrets'},
           {'name':'R2_DB_BACKUP','type':'r2_bucket','bucket_name':'hidden'},
           {'name':'PGHOST','type':'plain_text','text':'secret-host'},
           {'name':'OTHER','type':'secret_text','text':'hidden'}]
        d=p.classify_bindings(b)
        self.assertEqual(d['strict_pg_cues'],2)
        self.assertEqual(d['generic_db_cues'],1)
        self.assertEqual(d['types'],{'plain_text':1,'r2_bucket':1,'secret_text':2})
        self.assertNotIn('postgres://secrets',str(d))
        self.assertNotIn('private',str(d))
        self.assertNotIn('R2_DB_BACKUP',str(d))

    def test_candidate_inactive_no_credential_promotion(self):
        calls=[]
        def fake(path):
            calls.append(path)
            if path.endswith('/workers/scripts'):
                return {'result':[{'id':'one'},{'id':'two'}]}
            if path.endswith('/two/settings'):
                return {'result':{'bindings':[{'name':'R2_DB_BACKUP','type':'r2_bucket','bucket_name':'private'}]}}
            if path.endswith('/two/deployments'):
                return {'result':{'deployments':[]}}
            raise RuntimeError('unknown')
        d=p.inspect_candidate(fake,'a'*32,p.digest('two'))
        self.assertEqual(d['candidate_found'],True)
        self.assertEqual(d['active_deployment_verified'],False)
        self.assertFalse(d['postgres_authenticated'])
        self.assertFalse(d['mcn072_qualified'])
        self.assertNotIn('two',str(d))
        self.assertEqual(len(calls),3)

    def test_candidate_active_with_version_metadata(self):
        def fake(path):
            if path.endswith('/workers/scripts'):
                return {'result':[{'id':'two'}]}
            if path.endswith('/two/settings'):
                return {'result':{'bindings':[{'name':'PGHOST','type':'secret_text','text':'password'}]}}
            if path.endswith('/two/deployments'):
                return {'result':{'deployments':[{'id':'d'*36,'versions':[{'version_id':'1'*8+'-'+'2'*4+'-'+'3'*4+'-'+'4'*4+'-'+'5'*12,'percentage':100}]}]}}
            if '/versions/' in path:
                return {'result':{'resources':{'bindings':[{'name':'PGHOST','type':'secret_text','text':'password'}]}}}
            raise AssertionError(path)
        d=p.inspect_candidate(fake,'a'*32,p.digest('two'))
        self.assertTrue(d['active_deployment_verified'])
        self.assertTrue(d['active_version_metadata_read'])
        self.assertTrue(d['active_version_strict_pg_cues'])
        self.assertNotIn('password',str(d))
        self.assertFalse(d['postgres_authenticated'])

    def test_duplicate_candidate_listing_fail_closed(self):
        def fake(path):return {'result':[{'id':'two'},{'id':'two'}]}
        d=p.inspect_candidate(fake,'a'*32,p.digest('two'))
        self.assertFalse(d['candidate_found'])
        self.assertFalse(d['active_deployment_verified'])

if __name__=='__main__':unittest.main()
