"""Sealed mining records must be selected by explicit nonnegative integer indices.

Only the downstream Axiom executor is a synthetic boundary; the adapter,
canonical normalization, signature verification and runtime are real.
"""
import unittest

from connect.adapters import AdapterCatalog, AdapterContract
from connect.axiom_gateway import AxiomGateway
from connect.core import IntegrationGate
from connect.fabric import ConnectFabric
from connect.mining import normalize_mining_rows
from connect.runtime import ConnectRuntime


class MiningRecordSelectionTests(unittest.TestCase):
    def setUp(self):
        self.sent = []
        catalog = AdapterCatalog()
        catalog.register(AdapterContract(name="Mining Adapter", domain="mining",
                                         version="1.0.0", normalize=normalize_mining_rows))
        self.runtime = ConnectRuntime(
            catalog=catalog,
            fabric=ConnectFabric(signing_secret=b"isolated-test-only"),
            axiom=AxiomGateway(IntegrationGate(allowed=True, reason="test-only"),
                               executor=self.sent.append),
        )
        self.run = self.runtime.ingest(
            run_id="selection-test", connector_name="synthetic-source",
            domain="mining", adapter_name="Mining Adapter",
            records=[
                {"hazard":"A", "exposure":0.2, "severity":5, "likelihood":0.3,
                 "cost":10, "benefit":0.1},
                {"hazard":"B", "exposure":0.8, "severity":4, "likelihood":0.7,
                 "cost":20, "benefit":0.2},
            ],
        )

    def test_invalid_record_indices_fail_closed_before_axiom(self):
        for selected in (-1, -2, True, False, 1.0, "1", None, 2):
            with self.subTest(index=repr(selected)):
                self.sent.clear()
                with self.assertRaisesRegex(ValueError, "record_index_invalid"):
                    self.runtime.execute_mining_risk(self.run, record_index=selected)
                self.assertEqual(self.sent, [])

    def test_valid_second_record_still_preserves_seal_and_arithmetic(self):
        self.runtime.execute_mining_risk(self.run, record_index=1)
        self.assertEqual(len(self.sent), 1)
        self.assertEqual(self.sent[0]["args"], {"expression": "0.8*4.0*0.7"})
        self.assertEqual(len(self.sent[0]["canonical_sha256"]), 64)


if __name__ == "__main__":
    unittest.main()
