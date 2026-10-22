import importlib.util
import pathlib
import unittest

MODULE = pathlib.Path(__file__).parents[1] / 'studio_v03_release_readonly_gate_20261022.py'
spec = importlib.util.spec_from_file_location('studio_v03_release_no_go', MODULE)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
SHA='a'*40


def provider_with_secrets(path):
    # All sensitive provider metadata below must be discarded and NEVER logged.
    if '/settings' in path:
        return {'status':200,'result':{'bindings':[
            {'name':'STUDIO_LEDGER','type':'durable_object_namespace','id':'SECRET_DO_ID'},
            {'name':'STUDIO_ASSETS','type':'r2_bucket','bucket_name':'secret-name'},
            {'name':'ENABLE_RENDER_DISPATCH','type':'plain_text','text':'false'},
            {'name':'GPU_EXECUTION_APPROVED','type':'plain_text','text':'false'},
            {'name':'BUDGET_GUARD_APPROVED','type':'plain_text','text':'false'},
            {'name':'STUDIO_MODAL_CONTROL_KEY','type':'secret_text','text':'SECRET_TOKEN_DO_NOT_PRINT'},
        ]}}
    if '/hyperdrive/' in path:
        return {'status':200,'result':[{'name':'hidden-neon-endpoint',
             'origin':{'service_id':'some-service-id','host':'hidden-internal.example','password':'HIDDEN_PASSWORD'}},
            {'name':'generic-public', 'origin':{'host':'somewhere.example'}}]}
    if '/cfd_tunnel' in path:
        return {'status':200,'result':[{'name':'secret-tunnel-name','token':'SECRET_TUNNEL_TOKEN'}]}
    raise AssertionError('unlisted query')


class StudioReleaseReadOnlyTests(unittest.TestCase):
    def test_existing_vpc_config_is_only_a_candidate(self):
        report=mod.evaluate(provider_with_secrets, SHA)
        self.assertFalse(report['production_cutover_allowed'])
        self.assertEqual(report['decision'],'NO_GO')
        self.assertEqual(report['blocked_gate_count'],10)
        self.assertEqual(report['provider']['hyperdrive_vpc_candidate_count'],1)
        self.assertTrue(report['provider']['live_sqlite_do_binding_observed'])
        self.assertTrue(report['provider']['rendering_disabled_in_runtime'])
        self.assertFalse(report['provider']['private_transport_independently_verified'])
        for secret in ('SECRET_TOKEN_DO_NOT_PRINT','HIDDEN_PASSWORD','SECRET_TUNNEL_TOKEN',
                       'hidden-neon-endpoint','secret-tunnel-name','SECRET_DO_ID'):
            self.assertNotIn(secret,repr(report))

    def test_no_provider_permissions_never_becomes_go(self):
        report=mod.evaluate(lambda path:{'status':403,'result':None}, SHA)
        self.assertEqual(report['decision'],'NO_GO')
        self.assertEqual(report['provider']['cloudflare_hyperdrive_list_http_status'],403)
        self.assertFalse(report['provider']['rendering_disabled_in_runtime'])
        self.assertTrue(all(not x['provider_proven'] for x in report['release_gates'].values()))

    def test_read_only_endpoint_allowlist(self):
        for p in ('/workers/scripts/musitu-studio-v03-do', '/r2/buckets',
                  '/hyperdrive/configs?per_page=500', '//untrusted-host'):
            with self.assertRaises(ValueError): mod.safe_get(p, 'dummy')
        self.assertEqual(mod.safe_get('/hyperdrive/configs?per_page=100','')['status'],0)

    def test_untrusted_or_missing_commit_sha_rejected(self):
        for sha in ('','nothex'*9,'b'*41, 'a'*39):
            with self.assertRaises(ValueError): mod.evaluate(provider_with_secrets,sha)

    def test_provider_invalid_shape_fails_closed(self):
        for malformed in ([1,None],None,'sensitive'):
            def mock(path): return {'status':200, 'result':malformed}
            p=mod.evaluate(mock,SHA)
            self.assertEqual(p['blocked_gate_count'],10)
            self.assertFalse(p['provider']['live_sqlite_do_binding_observed'])
            self.assertFalse(p['provider']['private_transport_independently_verified'])

if __name__=='__main__': unittest.main()
