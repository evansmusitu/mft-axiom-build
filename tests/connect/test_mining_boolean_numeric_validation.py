"""Reject MQTT/OPC-UA boolean coercion in canonical mining risk inputs."""
import unittest

from connect.mining import normalize_mining_rows


class MiningNumericTypeTests(unittest.TestCase):
    BASE = {"hazard":"synthetic exposure", "exposure":0.5,
            "severity":10, "likelihood":0.3, "cost":1000,
            "benefit":0.2}

    def test_boolean_required_risk_values_cannot_be_cast_to_numbers(self):
        for field in ("exposure", "severity", "likelihood", "cost", "benefit"):
            for value in (True, False):
                with self.subTest(field=field, value=value):
                    with self.assertRaisesRegex(ValueError, "numeric_boolean_forbidden"):
                        normalize_mining_rows([{**self.BASE, field:value}])

    def test_boolean_coordinates_cannot_be_cast_to_numeric_locations(self):
        for field in ("latitude", "longitude"):
            row = {**self.BASE, "latitude":-17.8, "longitude":31.0, field:True}
            with self.subTest(field=field):
                with self.assertRaisesRegex(ValueError, "numeric_boolean_forbidden"):
                    normalize_mining_rows([row])

    def test_numeric_input_still_canonicalizes_without_precision_loss(self):
        rows = normalize_mining_rows([{**self.BASE, "latitude":-17.8,
                                       "longitude":31.0}]).records
        self.assertEqual(rows[0]["exposure"], 0.5)
        self.assertEqual(rows[0]["latitude"], -17.8)


if __name__ == "__main__":
    unittest.main()
