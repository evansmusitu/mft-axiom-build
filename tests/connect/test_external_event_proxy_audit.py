"""Evaluate research-only temporal proxy evidence (not distinct mine incidents)."""
from datetime import datetime, timedelta, timezone
import unittest

from benchmarks.mining_adapter.external_event_proxy_audit import EventProxyAudit

EPOCH = datetime(2025, 2, 1, tzinfo=timezone.utc)


def stamp(index):
    return EPOCH + timedelta(seconds=30 * index)


def add(audit, index, label=False, hard=False, alert=False):
    t = stamp(index)
    audit.observe(feature_time=t, label_window_end=t + timedelta(seconds=360),
                  label=label, hard_observed=hard, predicted_alert=alert)


class ExternalEventProxyAuditTests(unittest.TestCase):
    def test_merged_positive_forecast_intervals_not_called_independent_incidents(self):
        a = EventProxyAudit()
        for i in range(30):
            positive = i in (2, 3, 4, 17, 18)
            add(a, i, label=positive, hard=i == 3,
                alert=i in (3, 17, 18, 25, 26))
        r = a.finalize()
        self.assertEqual(r['positive_label_windows'], 5)
        self.assertEqual(r['positive_window_overlap_groups'], 2)
        self.assertEqual(r['proxy_groups_detected'], 2)
        self.assertEqual(r['proxy_groups_missed'], 0)
        self.assertEqual(r['hard_warning_proxy_groups_detected'], 1)
        self.assertEqual(r['false_alert_windows'], 2)
        self.assertEqual(r['false_alert_prediction_streaks'], 1)
        self.assertEqual(r['hard_observed_warning_windows'], 1)
        self.assertFalse(r['overlap_groups_are_unique_incidents'])
        self.assertFalse(r['independent_validation'])
        self.assertFalse(r['production_admission'])
        self.assertEqual(r['window_count'], 30)
        self.assertEqual(len(r['audit_trace_sha256']), 64)

    def test_unobserved_positive_proxy_group_is_missed_and_gap_breaks_false_alert_streak(self):
        a = EventProxyAudit()
        for i in (0, 1, 2, 3, 22, 23, 30):
            add(a, i, label=i in (1, 22), alert=i in (0, 2, 30))
        r = a.finalize()
        self.assertEqual(r['positive_window_overlap_groups'], 2)
        self.assertEqual(r['proxy_groups_missed'], 2)
        self.assertEqual(r['false_alert_windows'], 3)
        self.assertEqual(r['false_alert_prediction_streaks'], 3)
        self.assertEqual(r['hard_observed_warning_windows'], 0)

    def test_hard_observed_warning_can_never_be_suppressed(self):
        a = EventProxyAudit()
        with self.assertRaisesRegex(ValueError, 'hard_warning_suppressed'):
            add(a, 0, hard=True, alert=False)

    def test_forged_types_time_and_horizon_fail_closed(self):
        with self.assertRaisesRegex(ValueError, 'no_windows'):
            EventProxyAudit().finalize()
        a = EventProxyAudit()
        add(a, 0)
        with self.assertRaisesRegex(ValueError, 'time_order_invalid'):
            add(a, 0)
        with self.assertRaisesRegex(ValueError, 'horizon_contract_invalid'):
            a.observe(feature_time=stamp(1), label_window_end=stamp(1)+timedelta(seconds=359),
                      label=False, hard_observed=False, predicted_alert=False)
        with self.assertRaisesRegex(ValueError, 'boolean_contract_invalid'):
            a.observe(feature_time=stamp(1), label_window_end=stamp(1)+timedelta(seconds=360),
                      label=1, hard_observed=False, predicted_alert=False)
        with self.assertRaisesRegex(ValueError, 'timezone_required'):
            a.observe(feature_time=datetime(2025, 1, 1), label_window_end=datetime(2025, 1, 1, 0, 6),
                      label=False, hard_observed=False, predicted_alert=False)

    def test_digest_is_repeatable_and_bit_change_changes_commitment(self):
        def make(flip):
            a = EventProxyAudit()
            for i in range(4): add(a, i, label=(i == 2), alert=(i == 3 if flip else i == 2))
            return a.finalize()
        one, repeat, different = make(False), make(False), make(True)
        self.assertEqual(one['audit_trace_sha256'], repeat['audit_trace_sha256'])
        self.assertNotEqual(one['audit_trace_sha256'], different['audit_trace_sha256'])
        self.assertEqual(one['positive_window_overlap_groups'], 1)

    def test_finalized_cannot_be_mutated(self):
        a=EventProxyAudit()
        add(a, 0)
        a.finalize()
        with self.assertRaisesRegex(ValueError, 'already_finalized'):
            add(a, 1)
        with self.assertRaisesRegex(ValueError, 'already_finalized'):
            a.finalize()


if __name__ == '__main__': unittest.main()
