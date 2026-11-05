"""MQTT per-lane runtime evidence without modifying the locked acceptance gate.

A three-record synthetic seam uses the real run_stress_lane function. Only the
broker/service boundary and OS process counters are deterministic substitutes;
production MQTT benchmarks still use 1M events per lane and sealed thresholds.
"""
from __future__ import annotations

import sys
import types
import unittest
from unittest.mock import patch

from benchmarks.mining_adapter.mqtt_repeatability import run_stress_lane


class _SyntheticStore:
    def verify_audit_chain(self, _run_id):
        return True

    def close(self):
        pass


class _SyntheticService:
    store = _SyntheticStore()

    def replay(self, _run_id):
        return types.SimpleNamespace(envelope=types.SimpleNamespace(records=[{}, {}, {}]))


class _SyntheticSession:
    def __init__(self, **_kwargs):
        self.phase_rows = {"stress": 0}
        self.latency_ms = {"stress": [10.0, 12.0]}
        self.duplicates = 0
        self.errors = []

    def start(self):
        pass

    def publish_rows(self, phase, _batch_index, rows):
        self.phase_rows[phase] += len(rows)

    def wait_rows(self, phase, expected, _timeout):
        assert self.phase_rows[phase] == expected

    def close(self):
        pass


def _usage(user, system, voluntary, involuntary, inblock, outblock, faults):
    return types.SimpleNamespace(ru_utime=user, ru_stime=system,
        ru_nvcsw=voluntary, ru_nivcsw=involuntary, ru_inblock=inblock,
        ru_oublock=outblock, ru_majflt=faults, ru_maxrss=12345)


class MqttResourceDiagnosticsTests(unittest.TestCase):
    def test_lane_reports_only_process_counter_deltas_and_preserves_metrics(self):
        fake_module = types.ModuleType('benchmarks.mining_adapter.mqtt_field_runner')
        fake_module.FieldSession = _SyntheticSession
        fake_module.build_service = lambda _path: _SyntheticService()
        fake_module.latency_summary = lambda values: {'p99': max(values), 'p50': min(values)}
        spec = types.SimpleNamespace(events=3, batch_size=2, seed=123, qos=1)
        before = _usage(2.0, 1.0, 10, 4, 3, 5, 1)
        after = _usage(2.25, 1.10, 13, 9, 5, 6, 2)
        with patch.dict(sys.modules, {'benchmarks.mining_adapter.mqtt_field_runner': fake_module}):
            with patch('benchmarks.mining_adapter.mqtt_repeatability.resource.getrusage',
                       side_effect=[before, after, after]):
                report = run_stress_lane(host='127.0.0.1', port=1, label='reference',
                    broker_version='synthetic', spec=spec, round_index=0,
                    position=0, drain_timeout=1)
        self.assertEqual(report['events'], 3)
        self.assertEqual(report['received'], 3)
        self.assertEqual(report['throughput_events_per_second'], 3/report['stress_seconds'])
        self.assertEqual(report['p99_ms'], 12.0)
        self.assertTrue(report['audit_chain_verified'])
        obs = report['runtime_diagnostics']
        self.assertEqual(obs['schema'], 'musitu.connect.mqtt.process_diagnostics.v1')
        self.assertAlmostEqual(obs['process_user_cpu_seconds'], 0.25)
        self.assertAlmostEqual(obs['process_system_cpu_seconds'], 0.10)
        self.assertEqual(obs['voluntary_context_switches'], 3)
        self.assertEqual(obs['involuntary_context_switches'], 5)
        self.assertEqual(obs['block_input_operations'], 2)
        self.assertEqual(obs['block_output_operations'], 1)
        self.assertEqual(obs['major_page_faults'], 1)
        self.assertGreater(obs['process_cpu_to_wall_ratio'], 0)
        self.assertEqual(report['peak_rss_kib'], 12345)

    def test_ci_captures_diagnostics_without_disabling_strict_acceptance(self):
        from pathlib import Path
        workflow=(Path(__file__).resolve().parents[2] /
                  '.github/workflows/musitu-connect-mqtt-repeatability.yml').read_text()
        self.assertIn('tests/connect/test_mqtt_resource_diagnostics.py', workflow)
        self.assertIn('tests.connect.test_mqtt_resource_diagnostics', workflow)
        self.assertIn('assert aggregate["repeatability_passed"] is True', workflow)
        self.assertIn('assert frontier["throughput_target_met"] is True', workflow)
        self.assertLess(workflow.index('Summarize runtime diagnostics (non-enabling)'),
                        workflow.index('Validate repeatability evidence'))

    def test_diagnostics_do_not_change_sealed_comparison_fingerprint(self):
        from benchmarks.mining_adapter.mqtt_repeatability import (
            MqttRepeatabilitySpec, comparison_fingerprint)
        spec = MqttRepeatabilitySpec(trials=8)
        self.assertEqual(comparison_fingerprint(spec),
                         '50d5c517aa2171f773f30bca2b57bd7b6e5d2c35437a998e6b7e2da48dec5244')


if __name__ == '__main__':
    unittest.main()
