import importlib.util
import json
import pathlib
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('scope', ROOT/'account_scope_readonly.py')
scope = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scope)

class ScopeReadOnlyTests(unittest.TestCase):
    def test_validates_only_literal_allowed_get_paths(self):
        self.assertTrue(scope.allowed_path('/client/v4/accounts?page=1&per_page=50'))
        self.assertTrue(scope.allowed_path('/client/v4/accounts/'+'a'*32+'/queues?page=1&per_page=100'))
        self.assertFalse(scope.allowed_path('/client/v4/accounts/'+'a'*32+'/workers/scripts/fake/secrets'))
        self.assertFalse(scope.allowed_path('https://bad.example/'))
        self.assertFalse(scope.allowed_path('/client/v4/accounts/'+'a'*32+'/queues?update=true'))

    def test_all_known_cloudflare_auth_families_are_in_scope(self):
        self.assertEqual(set(scope.AUTH_FAMILIES), {'CLOUDFLARE_API_TOKEN','CLOUDFLARE_GLOBAL_API_KEY','CLOUDFLARE_API_KEY','MUSITU_CF_STAGING_READ_TOKEN'})

    def test_rejects_unrecognized_account_identifiers(self):
        self.assertIsNone(scope.account_id('https://outside.example'))
        self.assertIsNone(scope.account_id('some-account'))
        self.assertEqual(scope.account_id('a'*32),'a'*32)

    def test_inventory_sanitizes_secrets_urls_and_names(self):
        raw={'queue_id':'a'*32,'queue_name':'musitu-scheduler', 'consumers':[{'type':'worker','script':'example-worker','secret':'do-not-release'}], 'config':{'url':'postgres://sensitive'}}
        s=scope.summarize_queue(raw)
        out=json.dumps(s)
        for forbidden in ['musitu-scheduler','example-worker','do-not-release','postgres://sensitive','queue_id']:
            self.assertNotIn(forbidden,out)
        self.assertTrue(s['has_worker_consumer'])
        self.assertEqual(len(s['queue_name_sha256']),64)

    def test_fail_closed_qualification_defaults(self):
        o=scope.initial_report()
        self.assertEqual(o['mcn072'],'NO_GO')
        self.assertFalse(o['postgres_correspondence_authenticated'])
        self.assertEqual(o['qualified_live_windows'],0)
        self.assertFalse(o['credentials_exported'])

    def test_secret_absence_does_not_abort_all_families(self):
        with patch.dict('os.environ', {'CLOUDFLARE_API_TOKEN':'A'*20, 'CLOUDFLARE_GLOBAL_API_KEY':'', 'CLOUDFLARE_EMAIL':'foo@bar.test'},clear=True):
            info=scope.available_auth()
        self.assertTrue(info['CLOUDFLARE_API_TOKEN']['available'])
        self.assertFalse(info['CLOUDFLARE_GLOBAL_API_KEY']['available'])
        self.assertFalse(info['MUSITU_CF_STAGING_READ_TOKEN']['available'])

if __name__=='__main__':unittest.main()
