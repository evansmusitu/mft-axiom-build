"""Development corpus ingestion must never be mistaken for independent methane validation.

The OpenML mirrored bytes are pinned to the previously observed authentic
source digest. This contract uses only synthetic metadata; no mine data or
customer credentials are read by these tests.
"""
from __future__ import annotations

import unittest

from benchmarks.mining_adapter.polish_longwall_telemetry import (
    LongwallTelemetrySpec, evaluate_longwall_gate,
)

PINNED_DEVELOPMENT_ARFF_SHA256 = (
    "28e2eed4c4a314daa4319f656a09bb43d8acea603dcb906e31c98049c91a8fdc"
)


def development_report():
    spec = LongwallTelemetrySpec(min_source_rows=3, durable_sample_rows=2)
    return spec, {
        "dataset_id": spec.dataset_id, "dataset_version": spec.dataset_version,
        "doi": spec.doi, "license": spec.license,
        "transport_source": "openml:42701",
        "source_archive_sha256": PINNED_DEVELOPMENT_ARFF_SHA256,
        "source_member_sha256": PINNED_DEVELOPMENT_ARFF_SHA256,
        "source_rows": 3, "sensor_count": 28, "parse_failures": 0,
        "first_timestamp": "2014-03-02T00:00:00Z",
        "last_timestamp": "2014-03-02T00:00:02Z",
        "target_warning_samples": 1, "durable_records": 2,
        "durable_batches": 1, "replay_verified": True,
        "audit_chain_verified": True, "signatures_verified": True,
        "credentials_used": False, "errors": [],
    }


class PolishDevelopmentSourceBoundaryTests(unittest.TestCase):
    def test_openml_mirror_sha_must_match_verified_development_bytes(self):
        spec, report = development_report()
        self.assertTrue(evaluate_longwall_gate(spec, report)["real_telemetry_qualified"])
        for field in ("source_archive_sha256", "source_member_sha256"):
            with self.subTest(field=field):
                corrupted = {**report, field: "a" * 64}
                verdict = evaluate_longwall_gate(spec, corrupted)
                self.assertFalse(verdict["real_telemetry_qualified"])
                self.assertEqual(verdict["checks"]["verified_transport_and_cc_by_source_binding"], "FAIL")

    def test_green_ingestion_remains_known_development_data_not_independent(self):
        spec, report = development_report()
        report.update({
            "independent_mine_validation": True,
            "customer_admission_authorized": True,
            "production_methane_prediction_authorized": True,
        })
        verdict = evaluate_longwall_gate(spec, report)
        self.assertTrue(verdict["real_telemetry_qualified"])
        self.assertEqual(verdict["source_role"], "POLISH_DEVELOPMENT_CORPUS_ONLY")
        for field in ("independent_source_eligible", "independent_mine_validation",
                      "frozen_model_forecast_skill_evaluated", "customer_admission_authorized",
                      "production_methane_prediction_authorized"):
            with self.subTest(field=field):
                self.assertIs(verdict[field], False)

    def test_failed_ingestion_never_elevates_any_evidence_scope(self):
        spec, report = development_report()
        report["audit_chain_verified"] = False
        verdict = evaluate_longwall_gate(spec, report)
        self.assertFalse(verdict["real_telemetry_qualified"])
        self.assertEqual(verdict["source_role"], "POLISH_DEVELOPMENT_CORPUS_ONLY")
        self.assertIs(verdict["independent_mine_validation"], False)
        self.assertIs(verdict["production_methane_prediction_authorized"], False)


if __name__ == "__main__":
    unittest.main()
