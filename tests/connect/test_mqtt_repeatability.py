import unittest

from benchmarks.mining_adapter.mqtt_repeatability import (
    MqttRepeatabilitySpec,
    aggregate_repeatability,
    comparison_fingerprint,
    counterbalanced_order,
    evaluate_performance_frontier,
)


class MqttRepeatabilityTests(unittest.TestCase):
    def test_order_is_counterbalanced(self):
        self.assertEqual(
            counterbalanced_order(4),
            [
                ("reference","emqx"),
                ("emqx","reference"),
                ("reference","emqx"),
                ("emqx","reference"),
            ],
        )

    def test_contract_requires_at_least_four_million_event_trials(self):
        spec=MqttRepeatabilitySpec()
        self.assertGreaterEqual(spec.events,1_000_000)
        self.assertGreaterEqual(spec.trials,4)
        self.assertEqual(spec.batch_size,3000)
        self.assertEqual(spec.seed,20261006)
        self.assertEqual(comparison_fingerprint(spec),comparison_fingerprint(spec))

    def test_aggregate_reports_repeatable_loss_without_hiding_raw_trials(self):
        spec=MqttRepeatabilitySpec()
        reference=[
            {"round":0,"throughput_events_per_second":100.0,"p99_ms":20.0},
            {"round":1,"throughput_events_per_second":101.0,"p99_ms":21.0},
            {"round":2,"throughput_events_per_second":99.0,"p99_ms":19.5},
            {"round":3,"throughput_events_per_second":100.5,"p99_ms":20.5},
        ]
        emqx=[
            {"round":0,"throughput_events_per_second":120.0,"p99_ms":15.0},
            {"round":1,"throughput_events_per_second":119.0,"p99_ms":15.5},
            {"round":2,"throughput_events_per_second":121.0,"p99_ms":14.5},
            {"round":3,"throughput_events_per_second":120.5,"p99_ms":15.0},
        ]
        report=aggregate_repeatability(spec,reference,emqx)
        self.assertEqual(report["throughput"]["reference_outcome"],"LOSS")
        self.assertEqual(report["p99_latency"]["reference_outcome"],"LOSS")
        self.assertEqual(report["throughput"]["consistent_rounds"],4)
        self.assertEqual(report["p99_latency"]["consistent_rounds"],4)
        self.assertEqual(len(report["raw_trials"]["reference"]),4)
        self.assertEqual(len(report["raw_trials"]["emqx"]),4)


    def test_performance_frontier_requires_two_x_gain_and_integrity(self):
        aggregate={
            "throughput":{"reference_median":31_000.0},
            "p99_latency":{"reference_median":18_000.0},
            "raw_trials":{
                "reference":[
                    {
                        "events":1_000_000,"received":1_000_000,"duplicates":0,
                        "audit_chain_verified":True,"errors":[],
                        "credentials_used":False,
                    }
                    for _ in range(4)
                ],
                "emqx":[],
            },
        }
        frontier=evaluate_performance_frontier(aggregate)
        self.assertTrue(frontier["throughput_target_met"])
        self.assertTrue(frontier["integrity_preserved"])
        self.assertGreaterEqual(frontier["throughput_gain_x"],2.0)
        self.assertEqual(
            frontier["baseline"]["artifact_sha256"],
            "2c461d93e22a52ce121fa19ce8c6303785dcca39290c9c7eddf0c46ed0d89a7f",
        )

        aggregate["raw_trials"]["reference"][0]["received"]=999_999
        broken=evaluate_performance_frontier(aggregate)
        self.assertFalse(broken["throughput_target_met"])
        self.assertFalse(broken["integrity_preserved"])

    def test_aggregate_fails_closed_on_insufficient_or_misaligned_trials(self):
        spec=MqttRepeatabilitySpec()
        good=[
            {"round":i,"throughput_events_per_second":100.0+i,"p99_ms":20.0+i}
            for i in range(4)
        ]
        with self.assertRaisesRegex(ValueError,"repeatability_trials_required"):
            aggregate_repeatability(spec,good[:3],good[:3])
        bad=[dict(item) for item in good]
        bad[-1]["round"]=99
        with self.assertRaisesRegex(ValueError,"repeatability_round_mismatch"):
            aggregate_repeatability(spec,good,bad)


if __name__=="__main__":
    unittest.main()
