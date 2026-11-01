import unittest

from benchmarks.mining_adapter.mine_reality import (
    MineRealitySpec,
    evaluate_reality_gate,
    negative_probe_cases,
    reality_fingerprint,
    realistic_row,
    scenario_profile,
)


class MineRealityTests(unittest.TestCase):
    def test_default_contract_is_million_scale_and_adversarial(self):
        spec=MineRealitySpec()
        self.assertGreaterEqual(spec.events,1_000_000)
        self.assertGreaterEqual(spec.fault_count,3)
        self.assertGreater(spec.duplicate_batch_every,0)
        self.assertGreater(spec.stale_every,0)
        self.assertGreater(spec.out_of_order_every,0)
        self.assertGreater(spec.clock_drift_every,0)
        self.assertEqual(spec.seed,20261006)

    def test_realistic_rows_are_deterministic_and_preserve_mining_contract(self):
        spec=MineRealitySpec()
        self.assertEqual(realistic_row(337,spec),realistic_row(337,spec))
        row=realistic_row(337,spec)
        self.assertEqual(set(row),{
            "record_id","asset_id","site","event_time","latitude","longitude",
            "hazard","exposure","severity","likelihood","cost","benefit",
        })
        self.assertEqual(reality_fingerprint(spec),reality_fingerprint(spec))

    def test_profile_counts_stale_out_of_order_and_clock_drift(self):
        spec=MineRealitySpec(events=10000)
        profile=scenario_profile(0,spec.events,spec)
        self.assertGreater(profile["stale"],0)
        self.assertGreater(profile["out_of_order"],0)
        self.assertGreater(profile["clock_drift"],0)
        self.assertEqual(
            profile["clean"]+profile["stale"]+profile["out_of_order"]+profile["clock_drift"],
            spec.events,
        )

    def test_negative_probes_cover_fail_closed_data_quality_cases(self):
        cases=negative_probe_cases(MineRealitySpec(events=1000))
        self.assertEqual(set(cases),{
            "missing_required","out_of_range","invalid_timestamp","unknown_field",
        })
        self.assertEqual(cases["missing_required"]["expected_error"],"missing_fields:severity")
        self.assertEqual(cases["out_of_range"]["expected_error"],"value_out_of_range")
        self.assertEqual(cases["invalid_timestamp"]["expected_error"],"event_time_invalid")
        self.assertEqual(cases["unknown_field"]["expected_error"],"unknown_fields:temperature")

    def test_gate_requires_lossless_recovery_replay_and_negative_probe_rejection(self):
        spec=MineRealitySpec(events=1000,fault_count=3)
        report={
            "schema":"musitu.connect.mining.mine_reality_execution.v1",
            "workload_fingerprint":reality_fingerprint(spec),
            "events":spec.events,
            "received":spec.events,
            "duplicate_batches_expected":4,
            "duplicate_batches_observed":4,
            "scenario_profile":scenario_profile(0,spec.events,spec),
            "fault_count":spec.fault_count,
            "recoveries_observed":spec.fault_count,
            "fault_recovery_seconds":[1.0,1.2,0.9],
            "throughput_events_per_second":12345.0,
            "latency_ms":{"p50":10.0,"p95":20.0,"p99":30.0},
            "replay_verified":True,
            "audit_chain_verified":True,
            "negative_probes":{
                name:{
                    "rejected":True,
                    "error":case["expected_error"],
                    "expected_error":case["expected_error"],
                }
                for name,case in negative_probe_cases(spec).items()
            },
            "errors":[],
            "credentials_used":False,
        }
        qualified=evaluate_reality_gate(spec,report)
        self.assertTrue(qualified["reality_qualified"])
        self.assertEqual(qualified["gate"],"MINE_REALITY_QUALIFIED")

        broken=dict(report)
        broken["received"]=spec.events-1
        failed=evaluate_reality_gate(spec,broken)
        self.assertFalse(failed["reality_qualified"])
        self.assertEqual(failed["gate"],"MINE_REALITY_FAILED")


if __name__=="__main__":
    unittest.main()
