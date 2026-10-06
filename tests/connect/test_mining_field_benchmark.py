import json
import unittest
from pathlib import Path

from benchmarks.mining_adapter.industrial_field import (
    IndustrialWorkloadSpec,
    MqttSubscriptionBarrier,
    comparator_matrix,
    encode_mqtt_batch,
    evaluate_field_gate,
    mining_row,
    workload_fingerprint,
)


class IndustrialFieldBenchmarkTests(unittest.TestCase):
    def _mqtt(self, spec, throughput=5000.0):
        return {
            "workload_fingerprint":workload_fingerprint(spec),
            "events":spec.mqtt_events,"received":spec.mqtt_events,"duplicates":0,
            "fault_injected":True,"recovered":True,"soak_seconds":spec.soak_seconds,
            "latency_ms":{"p50":1.0,"p95":2.0,"p99":3.0},
            "throughput_events_per_second":throughput,
        }

    def _opcua(self, spec, throughput=5000.0):
        return {
            "workload_fingerprint":workload_fingerprint(spec),
            "data_points":spec.opcua_data_points,"received":spec.opcua_data_points,
            "fault_injected":True,"recovered":True,
            "latency_ms":{"p50":1.0,"p95":2.0,"p99":3.0},
            "throughput_data_points_per_second":throughput,
        }

    def test_baseline_catalog_is_valid_json(self):
        path=Path(__file__).resolve().parents[2]/"benchmarks"/"mining_adapter"/"baselines.json"
        catalog=json.loads(path.read_text())
        by_name={item["name"]:item for item in catalog["baselines"]}
        self.assertEqual(by_name["EMQX Enterprise"]["version"],"6.3.1")
        self.assertEqual(by_name["HighByte Intelligence Hub"]["version"],"4.5.2")
        self.assertEqual(by_name["Azure IoT Operations"]["version"],"1.4.73 (2608)")

    def test_default_workload_is_million_scale_and_prolonged(self):
        spec=IndustrialWorkloadSpec()
        self.assertGreaterEqual(spec.mqtt_events,1_000_000)
        self.assertGreaterEqual(spec.opcua_data_points,1_000_000)
        self.assertGreaterEqual(spec.soak_seconds,600)
        self.assertEqual(spec.mqtt_qos,1)
        self.assertEqual(spec.seed,20261006)

    def test_workload_rows_and_fingerprint_are_deterministic(self):
        spec=IndustrialWorkloadSpec()
        self.assertEqual(mining_row(42,spec.seed),mining_row(42,spec.seed))
        self.assertNotEqual(mining_row(42,spec.seed),mining_row(43,spec.seed))
        self.assertEqual(workload_fingerprint(spec),workload_fingerprint(spec))
        row=mining_row(42,spec.seed)
        self.assertEqual(set(row),{
            "record_id","asset_id","site","event_time","latitude","longitude",
            "hazard","exposure","severity","likelihood","cost","benefit",
        })

    def test_three_thousand_record_mqtt_batch_stays_inside_adapter_boundary(self):
        payload=encode_mqtt_batch(start_index=0,count=3000,seed=20261006)
        self.assertLessEqual(len(payload),1024*1024)
        decoded=json.loads(payload.decode("utf-8"))
        self.assertEqual(len(decoded["rows"]),3000)
        self.assertEqual(decoded["rows"][0]["record_id"],"field-0000000000")
        self.assertEqual(decoded["rows"][-1]["record_id"],"field-0000002999")


    def test_mqtt_subscription_readiness_requires_suback_after_reconnect(self):
        barrier=MqttSubscriptionBarrier()
        self.assertFalse(barrier.ready)
        barrier.mark_connected()
        self.assertFalse(barrier.ready)
        barrier.mark_subscribed()
        self.assertTrue(barrier.ready)
        barrier.mark_disconnected()
        self.assertFalse(barrier.ready)
        barrier.mark_connected()
        self.assertFalse(barrier.ready)
        barrier.mark_subscribed()
        self.assertTrue(barrier.ready)

    def test_current_comparator_matrix_is_fail_closed(self):
        matrix=comparator_matrix()
        by_name={item["name"]:item for item in matrix}
        self.assertEqual(by_name["EMQX Enterprise"]["version"],"6.3.1")
        self.assertEqual(by_name["HighByte Intelligence Hub"]["version"],"4.5.2")
        self.assertEqual(by_name["Azure IoT Operations"]["version"],"1.4.73 (2608)")
        self.assertEqual(by_name["HighByte Intelligence Hub"]["status"],"BLOCKED_EULA_NOT_ACCEPTED")
        self.assertEqual(by_name["Azure IoT Operations"]["status"],"BLOCKED_EXTERNAL_DEPLOYMENT")

    def test_field_gate_requires_million_scale_soak_and_fault_recovery(self):
        spec=IndustrialWorkloadSpec()
        mqtt=self._mqtt(spec)
        opcua=self._opcua(spec)
        emqx=self._mqtt(spec)
        report=evaluate_field_gate(spec=spec,musitu_mqtt=mqtt,opcua=opcua,emqx_mqtt=emqx)
        self.assertTrue(report["field_load_qualified"])
        self.assertEqual(report["gate"],"INDUSTRIAL_FIELD_BENCHMARK_PARTIAL")
        outcomes={x["baseline"]:x["outcome"] for x in report["comparisons"]}
        self.assertIn(outcomes["EMQX Enterprise"],{"WIN","TIE","LOSS"})
        self.assertEqual(outcomes["HighByte Intelligence Hub"],"BLOCKED")
        self.assertEqual(outcomes["Azure IoT Operations"],"BLOCKED")

        broken=dict(mqtt); broken["received"]=spec.mqtt_events-1
        failed=evaluate_field_gate(spec=spec,musitu_mqtt=broken,opcua=opcua,emqx_mqtt=emqx)
        self.assertFalse(failed["field_load_qualified"])

    def test_identical_workload_fingerprint_is_required_for_every_measured_lane(self):
        spec=IndustrialWorkloadSpec()
        mqtt=self._mqtt(spec); opcua=self._opcua(spec)
        emqx=self._mqtt(spec); emqx["workload_fingerprint"]="wrong"
        fake_external={
            "same_workload_measured":True,
            "workload_fingerprint":"wrong",
            "mqtt":self._mqtt(spec),
            "opcua":self._opcua(spec),
        }
        report=evaluate_field_gate(
            spec=spec,musitu_mqtt=mqtt,opcua=opcua,emqx_mqtt=emqx,
            highbyte=fake_external,azure=fake_external,
        )
        outcomes={x["baseline"]:x["outcome"] for x in report["comparisons"]}
        self.assertEqual(outcomes["EMQX Enterprise"],"NOT_RUN")
        self.assertEqual(outcomes["HighByte Intelligence Hub"],"INVALID_EVIDENCE")
        self.assertEqual(outcomes["Azure IoT Operations"],"INVALID_EVIDENCE")
        self.assertEqual(report["gate"],"INDUSTRIAL_FIELD_BENCHMARK_PARTIAL")

    def test_complete_gate_accepts_only_verified_external_protocol_evidence(self):
        spec=IndustrialWorkloadSpec()
        mqtt=self._mqtt(spec,throughput=5000.0)
        opcua=self._opcua(spec,throughput=4000.0)
        emqx=self._mqtt(spec,throughput=4500.0)
        external={
            "same_workload_measured":True,
            "workload_fingerprint":workload_fingerprint(spec),
            "mqtt":self._mqtt(spec,throughput=4800.0),
            "opcua":self._opcua(spec,throughput=3900.0),
        }
        report=evaluate_field_gate(
            spec=spec,musitu_mqtt=mqtt,opcua=opcua,emqx_mqtt=emqx,
            highbyte=external,azure=external,
        )
        by_name={x["baseline"]:x for x in report["comparisons"]}
        self.assertEqual(by_name["HighByte Intelligence Hub"]["outcome"],"MEASURED")
        self.assertEqual(by_name["Azure IoT Operations"]["outcome"],"MEASURED")
        self.assertIn(by_name["HighByte Intelligence Hub"]["dimensions"]["mqtt_throughput"],{"WIN","TIE","LOSS"})
        self.assertIn(by_name["HighByte Intelligence Hub"]["dimensions"]["opcua_throughput"],{"WIN","TIE","LOSS"})
        self.assertEqual(report["gate"],"INDUSTRIAL_FIELD_BENCHMARK_COMPLETE")


if __name__=="__main__":
    unittest.main()
