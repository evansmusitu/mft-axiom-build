"""Regression contracts for authenticated Connect-to-Axiom response evidence.

Only the HTTP boundary is replaced with deterministic response bytes. All
remote response parsing and ID-correlation logic runs in production code.
"""
import unittest
from unittest.mock import patch

from connect.axiom_gateway import AxiomComputeExecutor, AxiomMcpExecutor


class _RawHttpResponse:
    def __init__(self, content):
        self.content = content.encode('utf-8')

    def read(self):
        return self.content


class AxiomResponseIntegrityTests(unittest.TestCase):
    def _request(self, request_id='req-9'):
        return {'request_id': request_id, 'operation': 'arithmetic.evaluate',
                'args': {'expression': '2+3'}}

    def _mcp(self, content, request_id='req-9'):
        with patch('urllib.request.urlopen', return_value=_RawHttpResponse(content)):
            return AxiomMcpExecutor('https://axiom.example/mcp', 'test-token')(
                self._request(request_id))

    def _compute(self, content):
        with patch('urllib.request.urlopen', return_value=_RawHttpResponse(content)):
            return AxiomComputeExecutor('https://axiom.example/compute', 'test-token')(
                self._request())

    def test_mcp_requires_exact_response_id_type_not_string_coercion(self):
        # Request IDs are strings. A JSON number with the same printed digits
        # does not identify that request according to the JSON-RPC contract.
        response = '{"jsonrpc":"2.0","id":17,"result":{"structuredContent":{"result":5}}}'
        with self.assertRaisesRegex(RuntimeError, 'AXIOM_REQUEST_ID_MISMATCH'):
            self._mcp(response, request_id='17')

    def test_mcp_rejects_ambiguous_duplicate_jsonrpc_id(self):
        response = ('{"jsonrpc":"2.0","id":"wrong","id":"req-9",'
                    '"result":{"structuredContent":{"result":5}}}')
        with self.assertRaisesRegex(RuntimeError, 'AXIOM_REMOTE_RESPONSE_INVALID'):
            self._mcp(response)

    def test_mcp_rejects_ambiguous_nested_request_id(self):
        response = ('{"jsonrpc":"2.0","id":"req-9","result":'
                    '{"structuredContent":{"request_id":"wrong",'
                    '"request_id":"req-9","result":5}}}')
        with self.assertRaisesRegex(RuntimeError, 'AXIOM_REMOTE_RESPONSE_INVALID'):
            self._mcp(response)

    def test_compute_rejects_ambiguous_duplicate_request_id(self):
        response = '{"ok":true,"request_id":"wrong","request_id":"req-9","result":5}'
        with self.assertRaisesRegex(RuntimeError, 'AXIOM_REMOTE_RESPONSE_INVALID'):
            self._compute(response)

    def test_compute_requires_exact_returned_request_id_type(self):
        response = '{"ok":true,"request_id":17,"result":5}'
        with patch('urllib.request.urlopen', return_value=_RawHttpResponse(response)):
            with self.assertRaisesRegex(RuntimeError, 'AXIOM_REQUEST_ID_MISMATCH'):
                AxiomComputeExecutor('https://axiom.example/compute', 'test-token')(
                    self._request('17'))

    def test_mcp_rejects_nonstandard_nan_json_constant(self):
        response = '{"jsonrpc":"2.0","id":"req-9","result":{"structuredContent":{"result":NaN}}}'
        with self.assertRaisesRegex(RuntimeError, 'AXIOM_REMOTE_RESPONSE_INVALID'):
            self._mcp(response)

    def test_mcp_rejects_float_overflow_in_syntactically_valid_json(self):
        # JSON accepts scientific notation, but Python maps 1e400 to +Infinity.
        # Do not allow a remote result to bypass nonfinite checks that way.
        response = '{"jsonrpc":"2.0","id":"req-9","result":{"structuredContent":{"result":1e400}}}'
        with self.assertRaisesRegex(RuntimeError, 'AXIOM_REMOTE_RESPONSE_INVALID'):
            self._mcp(response)

    def test_mcp_retains_sanitized_valid_result_without_structured_request_id(self):
        response = '{"jsonrpc":"2.0","id":"req-9","result":{"structuredContent":{"result":5}}}'
        self.assertEqual(self._mcp(response), {'result': 5})


if __name__ == '__main__':
    unittest.main()
