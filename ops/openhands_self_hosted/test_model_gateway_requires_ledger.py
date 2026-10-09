"""Fail closed: production model spend must have explicit durable ledger."""
import unittest
from model_gateway_guard import ModelGatewayGuard

class MandatoryLedgerTests(unittest.TestCase):
    def test_gateway_rejects_unbudgeted_implicit_ephemeral_fallback(self):
        with self.assertRaises((TypeError,ValueError)):
            ModelGatewayGuard(
                signing_key=b's'*32,
                provider_credential='fake-not-real',
                transport=lambda *args: {'choices':[]},
                clock=lambda:1020,
            )

if __name__=='__main__':
    unittest.main()
