"""The MQTT normalization hot path must not weaken numeric safety or seals.

The named output digest is a fixed synthetic fixture. This does not assert
MQTT performance qualification or independent mine evidence.
"""
import hashlib
import unittest

from benchmarks.mining_adapter.industrial_field import mining_row
from connect.mining import normalize_mining_rows
from connect.security import canonical_bytes


class NormalizationFrontierIntegrityTests(unittest.TestCase):
    def test_every_numeric_and_spatial_boolean_is_rejected_without_mutation(self):
        row = mining_row(12)
        for field in ('exposure', 'severity', 'likelihood', 'cost', 'benefit',
                      'latitude', 'longitude'):
            for value in (False, True):
                with self.subTest(field=field, value=value):
                    corrupted = {**row, field: value}
                    preserved = dict(corrupted)
                    with self.assertRaisesRegex(ValueError, '^numeric_boolean_forbidden$'):
                        normalize_mining_rows([corrupted])
                    self.assertEqual(corrupted, preserved)

    def test_known_synthetic_canonical_bytes_remain_byte_identical(self):
        raw_rows = [mining_row(0), mining_row(1)]
        originals = [dict(row) for row in raw_rows]
        normalized = normalize_mining_rows(raw_rows)
        payload = canonical_bytes({
            'contract': normalized.contract,
            'domain': normalized.domain,
            'records': [dict(item) for item in normalized.records],
            'run_id': 'test-seal',
        })
        self.assertEqual(
            hashlib.sha256(payload).hexdigest(),
            '09542e80fa9021209fc06d3da9e99b7eb106e2d021b62d9a6b5af6a93f3a2adc',
        )
        self.assertEqual(raw_rows, originals)

    def test_invalid_optional_coordinate_pair_remains_fail_closed(self):
        row = mining_row(0)
        del row['longitude']
        with self.assertRaisesRegex(ValueError, '^coordinate_pair_required$'):
            normalize_mining_rows([row])


if __name__ == '__main__':
    unittest.main()
