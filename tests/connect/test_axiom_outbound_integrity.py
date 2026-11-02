"""Non-network, bearer-protecting request contracts for Connect -> Axiom.

The HTTP boundary is mocked; the actual executors must refuse malformed
identifiers/arguments before constructing or sending an authenticated request.
"""
import unittest
from unittest.mock import patch

from connect.axiom_gateway import AxiomComputeExecutor, AxiomMcpExecutor


class AxiomOutboundIntegrityTests(unittest.TestCase):
    EXECUTORS = (AxiomComputeExecutor, AxiomMcpExecutor)
    REQUEST = {'request_id': 'MUSITU-CONNECT-run-0123456789abcdef',
               'operation': 'arithmetic.evaluate',
               'args': {'expression': '2+3'}}

    def test_malformed_or_ambiguous_request_ids_never_reach_authorized_transport(self):
        for request_id in ('', 'bad\r\nX-Injected: yes', 'unicode-\N{SNOWMAN}',
                           'x' * 257, 17, None, True):
            for executor_class in self.EXECUTORS:
                with self.subTest(executor=executor_class.__name__, request_id=repr(request_id)):
                    with patch('urllib.request.urlopen') as send:
                        with self.assertRaisesRegex(RuntimeError, 'AXIOM_REQUEST_INVALID'):
                            executor_class('https://axiom.example/test', 'secret')(
                                {**self.REQUEST, 'request_id': request_id})
                        send.assert_not_called()

    def test_falsey_nonobject_args_are_not_silently_rewritten_to_empty_object(self):
        for args in ([], False, 0, '', None):
            for executor_class in self.EXECUTORS:
                with self.subTest(executor=executor_class.__name__, args=repr(args)):
                    with patch('urllib.request.urlopen') as send:
                        with self.assertRaisesRegex(RuntimeError, 'AXIOM_REQUEST_INVALID'):
                            executor_class('https://axiom.example/test', 'secret')(
                                {**self.REQUEST, 'args': args})
                        send.assert_not_called()


if __name__ == '__main__':
    unittest.main()
