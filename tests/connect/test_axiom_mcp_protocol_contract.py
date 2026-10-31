"""Fail-closed Connect to Axiom JSON-RPC response and outbound JSON contracts.

Only the network boundary is mocked; protocol validation uses the real executor.
No production credentials, network calls, or customer admission are involved.
"""
import unittest
from unittest.mock import patch

from connect.axiom_gateway import AxiomComputeExecutor, AxiomMcpExecutor


class _Response:
    def __init__(self, raw):
        self.raw = raw.encode('utf-8')

    def read(self):
        return self.raw


class AxiomMcpProtocolContractTests(unittest.TestCase):
    REQUEST = {'request_id': 'contract-id', 'operation': 'arithmetic.evaluate',
               'args': {'expression': '1+2'}}
    SUCCESS = '{"jsonrpc":"2.0","id":"contract-id","result":{"structuredContent":{"result":3}}}'

    def run_mcp(self, raw):
        with patch('urllib.request.urlopen', return_value=_Response(raw)):
            return AxiomMcpExecutor('https://axiom.example/mcp', 'isolated-token')(self.REQUEST)

    def test_valid_sanitized_mcp_result_keeps_normal_computation(self):
        self.assertEqual(self.run_mcp(self.SUCCESS), {'result': 3})

    def test_missing_or_wrong_jsonrpc_version_must_not_return_success(self):
        for payload in (
            '{"id":"contract-id","result":{"structuredContent":{"result":3}}}',
            '{"jsonrpc":"1.0","id":"contract-id","result":{"structuredContent":{"result":3}}}',
            '{"jsonrpc":2,"id":"contract-id","result":{"structuredContent":{"result":3}}}',
        ):
            with self.subTest(payload=payload):
                with self.assertRaisesRegex(RuntimeError, 'AXIOM_REMOTE_RESPONSE_INVALID'):
                    self.run_mcp(payload)

    def test_jsonrpc_error_cannot_be_disguised_as_success(self):
        raw = ('{"jsonrpc":"2.0","id":"contract-id",'
               '"error":{"code":-32603,"message":"failure"},'
               '"result":{"structuredContent":{"result":3}}}')
        with self.assertRaisesRegex(RuntimeError, 'AXIOM_REMOTE_RESPONSE_INVALID'):
            self.run_mcp(raw)

    def test_unambiguous_jsonrpc_error_reports_remote_failure(self):
        raw = '{"jsonrpc":"2.0","id":"contract-id","error":{"code":-32603,"message":"failure"}}'
        with self.assertRaisesRegex(RuntimeError, 'AXIOM_REMOTE_ERROR'):
            self.run_mcp(raw)

    def test_missing_or_malformed_success_shapes_fail_closed(self):
        for suffix in (
            '',
            ',"result":null',
            ',"result":[]',
            ',"result":{"structuredContent":null}',
            ',"result":{"structuredContent":[]}',
            ',"result":{"isError":"true","structuredContent":{"result":3}}',
        ):
            with self.subTest(suffix=suffix):
                raw = '{"jsonrpc":"2.0","id":"contract-id"' + suffix + '}'
                with self.assertRaisesRegex(RuntimeError, 'AXIOM_REMOTE_RESPONSE_INVALID'):
                    self.run_mcp(raw)

    def test_remote_tool_error_keeps_existing_error_contract(self):
        raw = '{"jsonrpc":"2.0","id":"contract-id","result":{"isError":true}}'
        with self.assertRaisesRegex(RuntimeError, 'AXIOM_REMOTE_ERROR'):
            self.run_mcp(raw)

    def test_nonfinite_arguments_cannot_be_sent_with_bearer_credentials(self):
        for cls in (AxiomMcpExecutor, AxiomComputeExecutor):
            for invalid in (float('nan'), float('inf'), float('-inf')):
                with self.subTest(executor=cls.__name__, invalid=repr(invalid)):
                    req = {**self.REQUEST, 'args': {'value': invalid}}
                    with patch('urllib.request.urlopen') as mocked:
                        with self.assertRaisesRegex(RuntimeError, 'AXIOM_REQUEST_INVALID'):
                            cls('https://axiom.example/mcp', 'isolated-token')(req)
                        mocked.assert_not_called()


if __name__ == '__main__':
    unittest.main()
