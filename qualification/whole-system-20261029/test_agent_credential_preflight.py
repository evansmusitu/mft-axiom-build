import importlib.util
import io
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch
import urllib.error

spec = importlib.util.spec_from_file_location('credential_preflight', Path(__file__).resolve().parents[2] / 'ops/axiom_openai_credential_preflight.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CredentialPreflight(unittest.TestCase):
    def test_presence_only_or_missing_key_never_calls_a_provider(self):
        class Reject:
            def open(self, *args, **kwargs):
                raise AssertionError('unexpected provider call')
        with patch.dict(os.environ, {'OPENAI_API_KEY': 'fixture-reuse'}, clear=True):
            result = module.inspect_existing_credential(opener=Reject())
            self.assertTrue(result['existing_key_present'])
            self.assertFalse(result['api_request_made'])
        with patch.dict(os.environ, {}, clear=True):
            self.assertFalse(module.inspect_existing_credential(True, Reject())['api_request_made'])

    def test_access_probe_is_one_fixed_get_and_never_reads_response_content(self):
        calls = []
        class Response:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, *args): raise AssertionError('response body must be discarded')
        class Opener:
            def open(self, request, timeout):
                calls.append((request, timeout))
                return Response()
        with patch.dict(os.environ, {'OPENAI_API_KEY': 'fixture-reuse'}, clear=True):
            result = module.inspect_existing_credential(True, Opener())
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][0].get_method(), 'GET')
        self.assertEqual(calls[0][0].full_url, 'https://api.openai.com/v1/agents/sessions?limit=1')
        self.assertEqual(calls[0][0].get_header('Openai-beta'), 'agents=v1')
        self.assertTrue(result['agents_read_access_verified'])
        self.assertFalse(result['hosted_access_verified'])
        self.assertFalse(result['session_created'])
        self.assertFalse(result['model_inference_requested'])
        self.assertNotIn('fixture-reuse', json.dumps(result))

    def test_http_denial_records_status_without_serializing_provider_error_body(self):
        class Opener:
            def open(self, *args, **kwargs):
                raise urllib.error.HTTPError('https://api.openai.com', 403, 'sensitive-provider-message', {}, io.BytesIO(b'sensitive-provider-body'))
        with patch.dict(os.environ, {'OPENAI_API_KEY': 'fixture-reuse'}, clear=True):
            result = module.inspect_existing_credential(True, Opener())
        self.assertEqual(result['http_status'], 403)
        self.assertFalse(result['agents_read_access_verified'])
        self.assertNotIn('sensitive-provider', json.dumps(result))

    def test_network_error_cannot_echo_credentials(self):
        class Opener:
            def open(self, *args, **kwargs):
                raise urllib.error.URLError('fixture-reuse in a provider error')
        with patch.dict(os.environ, {'OPENAI_API_KEY': 'fixture-reuse'}, clear=True):
            result = module.inspect_existing_credential(True, Opener())
        self.assertEqual(result['access_check_error'], 'NETWORK_OR_TIMEOUT')
        self.assertNotIn('fixture-reuse', json.dumps(result))

    def test_redirects_are_not_followed(self):
        self.assertIsNone(module.NoRedirect().redirect_request(None, None, 307, 'redirect', {}, 'https://untrusted.example/'))


if __name__ == '__main__':
    unittest.main()
