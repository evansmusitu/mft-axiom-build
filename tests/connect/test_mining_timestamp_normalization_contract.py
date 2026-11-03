"""Timezone-aware Mining MQTT events retain their exact canonical text/seal.

This suite is a behavior-preserving regression, NOT a performance gate or
independent mine holdout. No timestamp repair, resampling, or new tolerance.
"""
import hashlib
import unittest

from benchmarks.mining_adapter.industrial_field import mining_row
from connect.mining import normalize_mining_rows
from connect.security import canonical_bytes


class MiningTimestampNormalizationTests(unittest.TestCase):
    def test_supported_timezone_formats_remain_unmodified(self):
        for event_time in (
            '2026-11-03T21:45:12.123Z',
            '2026-11-03T21:45:12+00:00',
            '2026-11-03T19:45:12-02:00',
            '2026-11-03 21:45:12.000+00:00',
        ):
            with self.subTest(timestamp=event_time):
                row = {**mining_row(0), 'event_time': event_time}
                before = dict(row)
                result = normalize_mining_rows([row]).records[0]
                self.assertEqual(result['event_time'], event_time)
                self.assertEqual(row, before)

    def test_missing_or_ambiguous_timezone_is_rejected(self):
        for event_time in (
            '2026-11-03T21:45:12',
            '2026-11-03Z21:45:12Z',
            '2026-11-03T21:45:12ZZ',
            '2026-11-03T21:45:12Z+00:00',
            'bad-timestamp',
        ):
            with self.subTest(timestamp=event_time):
                row = {**mining_row(0), 'event_time': event_time}
                with self.assertRaisesRegex(ValueError, 'event_time_'):
                    normalize_mining_rows([row])

    def test_full_synthetic_canonical_sha_does_not_change(self):
        rows = [mining_row(0), mining_row(1)]
        normalized = normalize_mining_rows(rows)
        signed = canonical_bytes({
            'contract': normalized.contract,
            'domain': normalized.domain,
            'records': [dict(x) for x in normalized.records],
            'run_id': 'test-seal',
        })
        self.assertEqual(hashlib.sha256(signed).hexdigest(),
                         '09542e80fa9021209fc06d3da9e99b7eb106e2d021b62d9a6b5af6a93f3a2adc')


if __name__ == '__main__':
    unittest.main()
