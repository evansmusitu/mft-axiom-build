"""AWS CLI v2 serializes timestamp fields as ISO 8601 strings."""
import unittest
from datetime import datetime, timezone

from ops.g1_aws.readonly import credit_summary


class CreditTimestampTests(unittest.TestCase):
    def summary(self, start, end):
        return credit_summary({'credits': [{
            'accountId': '123456789012', 'creditStatus': 'ENABLED',
            'remainingAmount': {'currencyCode': 'USD', 'currencyAmount': '10.00'},
            'applicableProductNames': ['Amazon EC2'], 'startDate': start, 'endDate': end,
        }]}, '123456789012', datetime(2026, 11, 28, tzinfo=timezone.utc))[0]

    def test_actual_cli_v2_strings_preserve_active_balance_and_expiry(self):
        result = self.summary('2026-11-01T00:00:00+00:00', '2026-12-01T00:00:00+00:00')
        self.assertTrue(result['active'])
        self.assertEqual(result['expires_at'], '2026-12-01T00:00:00+00:00')

    def test_z_offsets_and_fractional_seconds_are_equivalent_to_wire_epochs(self):
        wire = self.summary(1793491200, 1796083200)
        for start, end in [('2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z'),
                           ('2026-11-01T02:00:00.000+02:00', '2026-12-01T02:00:00.000+02:00')]:
            self.assertEqual(self.summary(start, end), wire)

    def test_ambiguous_malformed_or_nonfinite_dates_never_establish_active_credit(self):
        for bad in (None, True, float('inf'), float('nan'), 'not-a-date', '2026-12-01',
                    '2026-12-01T00:00:00', 'x' * 100):
            with self.subTest(value=bad):
                result = self.summary('2026-11-01T00:00:00Z', bad)
                self.assertFalse(result['active'])
                self.assertIsNone(result['expires_at'])

    def test_expired_future_and_reversed_intervals_remain_inactive(self):
        for start, end in [('2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z'),
                           ('2026-12-01T00:00:00Z', '2026-12-02T00:00:00Z'),
                           ('2026-12-01T00:00:00Z', '2026-11-01T00:00:00Z')]:
            self.assertFalse(self.summary(start, end)['active'])
