"""Non-network, bearer-protecting request contracts for Connect -> Axiom.

The HTTP boundary is mocked; the actual executors must refuse malformed
identifiers/arguments before constructing or sending an authenticated request.
"""
import unittest
import urllib.request
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

    def test_invalid_operation_never_reaches_authenticated_axiom(self):
        for operation in (None, False, 0, [], {}, '', ' bad',
                          'arithmetic.evaluate\r\nX-Hijack: yes',
                          'arithmetic.\N{SNOWMAN}', 'x' * 129):
            for executor_class in self.EXECUTORS:
                with self.subTest(executor=executor_class.__name__, operation=repr(operation)):
                    with patch('urllib.request.urlopen') as send:
                        with self.assertRaisesRegex(RuntimeError, 'AXIOM_REQUEST_INVALID'):
                            executor_class('https://axiom.example/test', 'secret')(
                                {**self.REQUEST, 'operation': operation})
                        send.assert_not_called()
        for executor_class in self.EXECUTORS:
            with self.subTest(executor=executor_class.__name__, operation='missing'):
                request = {k:v for k,v in self.REQUEST.items() if k != 'operation'}
                with patch('urllib.request.urlopen') as send:
                    with self.assertRaisesRegex(RuntimeError, 'AXIOM_REQUEST_INVALID'):
                        executor_class('https://axiom.example/test', 'secret')(request)
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


    def test_bearer_token_is_never_inherited_by_cross_host_http_redirect(self):
        for executor_class in self.EXECUTORS:
            with self.subTest(executor=executor_class.__name__):
                def examine_outbound(outbound, timeout):
                    self.assertEqual(outbound.get_header('Authorization'), 'Bearer secret')
                    # The real urllib default redirect handler must not copy
                    # our credential onto an off-origin redirected request.
                    redirect = urllib.request.HTTPRedirectHandler().redirect_request(
                        outbound, None, 302, 'Found', {}, 'https://untrusted.example/collect')
                    self.assertIsNotNone(redirect)
                    self.assertFalse(redirect.has_header('Authorization'))
                    raise RuntimeError('INTERCEPTED_NO_NETWORK')

                with patch('urllib.request.urlopen', side_effect=examine_outbound) as send:
                    with self.assertRaisesRegex(RuntimeError, 'INTERCEPTED_NO_NETWORK'):
                        executor_class('https://axiom.example/test', 'secret')(self.REQUEST)
                    send.assert_called_once()


if __name__ == '__main__':
    unittest.main()
