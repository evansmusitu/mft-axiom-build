import io
import json
import tempfile
import unittest
from pathlib import Path

from benchmarks.mining_adapter.polish_longwall_telemetry import (
    LongwallTelemetrySpec,
    canonical_telemetry_row,
    evaluate_longwall_gate,
    scan_csv_stream,
)
from connect.mining_telemetry import MINING_TELEMETRY_SENSORS


def fixture_text():
    header=["year","month","day","hour","minute","second",*MINING_TELEMETRY_SENSORS]
    rows=[]
    for second,mm263 in [(0,0.2),(1,1.1),(2,0.4)]:
        values={
            "year":"2014","month":"3","day":"2","hour":"0","minute":"0","second":str(second),
            **{name:str(index/10) for index,name in enumerate(MINING_TELEMETRY_SENSORS)},
        }
        values["MM263"]=str(mm263)
        values["MM264"]="0.3"
        values["MM256"]="0.4"
        values["F_SIDE"]="0.5"
        rows.append(",".join(values[name] for name in header))
    return ",".join(header)+"\n"+"\n".join(rows)+"\n"


class PolishLongwallTelemetryTests(unittest.TestCase):
    def test_canonical_row_maps_six_part_timestamp_and_all_28_sensors(self):
        header=fixture_text().splitlines()[0].split(",")
        raw=dict(zip(header,fixture_text().splitlines()[1].split(","),strict=True))
        row=canonical_telemetry_row(raw)
        self.assertEqual(row["event_time"],"2014-03-02T00:00:00Z")
        self.assertEqual(len(MINING_TELEMETRY_SENSORS),28)
        self.assertEqual(set(row),{"event_time",*MINING_TELEMETRY_SENSORS})

    def test_scan_stream_counts_rows_sensor_schema_and_threshold_samples(self):
        spec=LongwallTelemetrySpec(min_source_rows=3,durable_sample_rows=2)
        report,selected=scan_csv_stream(io.StringIO(fixture_text()),spec)
        self.assertEqual(report["source_rows"],3)
        self.assertEqual(report["sensor_count"],28)
        self.assertEqual(report["parse_failures"],0)
        self.assertEqual(report["first_timestamp"],"2014-03-02T00:00:00Z")
        self.assertEqual(report["last_timestamp"],"2014-03-02T00:00:02Z")
        self.assertEqual(report["target_warning_samples"],1)
        self.assertEqual(len(selected),2)

    def test_gate_requires_cc_by_source_scale_28_sensors_and_durable_integrity(self):
        spec=LongwallTelemetrySpec(min_source_rows=3,durable_sample_rows=2)
        report={
            "dataset_id":spec.dataset_id,
            "dataset_version":1,
            "doi":spec.doi,
            "license":"CC BY 4.0",
            "source_archive_sha256":"a"*64,
            "source_member_sha256":"b"*64,
            "source_rows":3,
            "sensor_count":28,
            "parse_failures":0,
            "first_timestamp":"2014-03-02T00:00:00Z",
            "last_timestamp":"2014-03-02T00:00:02Z",
            "target_warning_samples":1,
            "durable_records":2,
            "durable_batches":1,
            "replay_verified":True,
            "audit_chain_verified":True,
            "signatures_verified":True,
            "credentials_used":False,
            "errors":[],
        }
        qualified=evaluate_longwall_gate(spec,report)
        self.assertTrue(qualified["real_telemetry_qualified"])
        self.assertEqual(qualified["gate"],"REAL_MINE_TELEMETRY_QUALIFIED")

        broken=dict(report)
        broken["license"]="unknown"
        self.assertFalse(evaluate_longwall_gate(spec,broken)["real_telemetry_qualified"])

    def test_spec_is_bound_to_public_mendeley_dataset_and_million_row_durable_sample(self):
        spec=LongwallTelemetrySpec()
        self.assertEqual(spec.dataset_id,"yd7vw4c5mk")
        self.assertEqual(spec.doi,"10.17632/yd7vw4c5mk.1")
        self.assertEqual(spec.license,"CC BY 4.0")
        self.assertGreaterEqual(spec.min_source_rows,9_000_000)
        self.assertGreaterEqual(spec.durable_sample_rows,1_000_000)


if __name__=="__main__":
    unittest.main()
