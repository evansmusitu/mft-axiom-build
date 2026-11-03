"""Authenticated Connect-to-Axiom HTTP responses are bounded before JSON parsing."""
import unittest
from unittest.mock import patch

from connect.axiom_gateway import AxiomComputeExecutor, AxiomMcpExecutor


class _StreamingResponse:
    def __init__(self, raw):
        self.raw = raw
        self.read_sizes = []
        self.closed = False

    def read(self, size=-1):
        self.read_sizes.append(size)
        if size < 0:
            raise AssertionError("unbounded remote body read")
        return self.raw[:size]

    def close(self):
        self.closed = True


class AxiomRemoteResponseBoundTests(unittest.TestCase):
    LIMIT = 65536
    REQUEST = {"request_id":"synthetic-req-8", "operation":"arithmetic.evaluate",
               "args":{"expression":"2+3"}}
    RESPONSES = (
        (AxiomComputeExecutor, b'{"ok":true,"result":{"result":5}}'),
        (AxiomMcpExecutor, b'{"jsonrpc":"2.0","id":"synthetic-req-8",'
                           b'"result":{"structuredContent":{"result":5}}}'),
    )

    def test_oversized_response_is_rejected_with_bounded_read_and_close(self):
        for executor_class, valid in self.RESPONSES:
            response = _StreamingResponse(valid + b' ' * (self.LIMIT + 16))
            with self.subTest(executor=executor_class.__name__):
                with patch('urllib.request.urlopen', return_value=response) as network:
                    with self.assertRaisesRegex(RuntimeError, 'AXIOM_REMOTE_RESPONSE_TOO_LARGE'):
                        executor_class('https://axiom.example/test', 'synthetic-secret')(
                            self.REQUEST)
                    network.assert_called_once()
                self.assertEqual(response.read_sizes, [self.LIMIT + 1])
                self.assertTrue(response.closed)

    def test_valid_response_at_exact_limit_retains_general_arithmetic(self):
        for executor_class, valid in self.RESPONSES:
            response = _StreamingResponse(valid + b' ' * (self.LIMIT - len(valid)))
            with self.subTest(executor=executor_class.__name__):
                with patch('urllib.request.urlopen', return_value=response):
                    result = executor_class('https://axiom.example/test',
                                            'synthetic-secret')(self.REQUEST)
                self.assertEqual(result['result']['result'] if executor_class is AxiomComputeExecutor
                                 else result['result'], 5)
                self.assertEqual(response.read_sizes, [self.LIMIT + 1])
                self.assertTrue(response.closed)


if __name__ == '__main__':
    unittest.main()
