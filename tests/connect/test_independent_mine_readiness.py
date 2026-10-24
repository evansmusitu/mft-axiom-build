"""Negative-first regression tests for independent mine evidence procurement gate."""
from __future__ import annotations

import copy
import json
import subprocess
import sys
import tempfile
from pathlib import Path
import unittest

from benchmarks.mining_adapter.independent_mine_readiness import (
    SCHEMA, SOURCE_HASH, FROZEN_MANIFEST_HASH, REQUIRED_EXTERNAL_REVIEWS,
    screen_independent_mine_candidate,
)
from connect.mining_telemetry import MINING_TELEMETRY_SENSORS


def complete_but_self_attested():
    return {
        "schema": SCHEMA,
        "candidate_id": "separate_site_pseudonymous_001",
        "source_lineage_identifiers": ["private:new-independent-site-001"],
        "data_kind": "underground_operational_sensor_stream",
        "sampling_seconds": 1,
        "independently_measured_canonical_sensors": list(MINING_TELEMETRY_SENSORS),
        "identity_mapping_only": True,
        "raw_sensor_readings_unmodified": True,
        "canonical_source_sha256": "a" * 64,
        "original_source_sha256": "b" * 64,
        "frozen_model_manifest_sha256": FROZEN_MANIFEST_HASH,
        "external_review_references": {
            key: "self_supplied_unverified_reference_001" for key in REQUIRED_EXTERNAL_REVIEWS
        },
        "prospective_fold_positive_label_windows": [500, 501, 700, 499],
        "independent_physical_events_reviewed": True,
        "prospective_holdout_sealed_before_test_access": True,
        "external_model_evaluation_artifact_verified": True,
        "mining_operational_alarms_and_response_verified": True,
    }


class IndependentMineReadinessTests(unittest.TestCase):
    def test_even_all_green_self_attestations_cannot_authorize_production(self):
        report = screen_independent_mine_candidate(complete_but_self_attested())
        self.assertEqual(report["claimed_positive_support_folds"], 3)
        self.assertEqual(report["status"], "INDEPENDENT_MINE_QUALIFICATION_BLOCKED")
        self.assertFalse(report["independent_validation"])
        self.assertFalse(report["production_admission"])
        self.assertFalse(report["production_methane_prediction_qualification"])
        self.assertFalse(report["compatible_with_frozen_model_proven"])
        self.assertFalse(report["pr_9_merge_authorized"])
        self.assertTrue(report["existing_production_axiom_compute_must_remain_unchanged"])
        self.assertIn("OUT_OF_BAND_REVIEW_AUTHENTICITY_NOT_ESTABLISHED",
                      report["outstanding_requirements"])
        self.assertNotIn("self_supplied_unverified_reference_001", json.dumps(report))

    def test_explicit_development_dataset_alias_is_ineligible_even_with_self_attestations(self):
        for identifier in (
            "doi:10.17632/yd7vw4c5mk.1", "openml:42701",
            "https://www.openml.org/d/42701",
            "https://data.mendeley.com/datasets/yd7vw4c5mk/1"
        ):
            case = complete_but_self_attested()
            case["source_lineage_identifiers"] = [identifier]
            with self.subTest(identifier=identifier):
                result = screen_independent_mine_candidate(case)
                self.assertTrue(result["known_development_source"])
                self.assertIn("REUSED_OR_ALIASED_DEVELOPMENT_SOURCE",
                              result["outstanding_requirements"])

    def test_original_or_canonical_hash_reuse_is_rejected(self):
        for field in ("canonical_source_sha256", "original_source_sha256"):
            case = complete_but_self_attested()
            case[field] = SOURCE_HASH
            result = screen_independent_mine_candidate(case)
            self.assertTrue(result["known_development_source"])
            self.assertFalse(result["production_admission"])

    def test_partial_channel_coverage_cannot_be_interpolated_to_28(self):
        case = complete_but_self_attested()
        case["independently_measured_canonical_sensors"] = list(MINING_TELEMETRY_SENSORS[:-1])
        result = screen_independent_mine_candidate(case)
        self.assertIn("FULL_28_MEASURED_SENSOR_CHANNELS_NOT_VERIFIED",
                      result["outstanding_requirements"])
        self.assertFalse(result["declared_full_canonical_sensor_coverage"])

    def test_duplicate_or_unhashable_fields_are_not_accepted(self):
        case = complete_but_self_attested()
        case["independently_measured_canonical_sensors"][-1] = "MM263"
        result = screen_independent_mine_candidate(case)
        self.assertIn("FULL_28_MEASURED_SENSOR_CHANNELS_NOT_VERIFIED",
                      result["outstanding_requirements"])
        case["source_lineage_identifiers"] = [[]]
        with self.assertRaisesRegex(ValueError, "lineage_invalid"):
            screen_independent_mine_candidate(case)

    def test_one_minute_and_unknown_source_frequency_not_eligible(self):
        for cadence in (60, 15, None, True):
            case = complete_but_self_attested()
            case["sampling_seconds"] = cadence
            with self.subTest(cadence=cadence):
                report = screen_independent_mine_candidate(case)
                self.assertIn("ONE_SECOND_SOURCE_CADENCE_NOT_VERIFIED",
                              report["outstanding_requirements"])

    def test_eligibility_rejects_wrong_source_type_and_resampled_or_imputed_claims(self):
        case = complete_but_self_attested()
        case["data_kind"] = "regulatory_mine_records"
        case["identity_mapping_only"] = False
        case["raw_sensor_readings_unmodified"] = False
        result = screen_independent_mine_candidate(case)
        self.assertIn("NO_ELIGIBLE_UNDERGROUND_SENSOR_STREAM", result["outstanding_requirements"])
        self.assertIn("NO_LOSSLESS_IDENTITY_MAPPING_PROOF", result["outstanding_requirements"])
        self.assertIn("NO_UNMODIFIED_SENSOR_READINGS_PROOF", result["outstanding_requirements"])

    def test_unreviewed_holdout_and_insufficient_positive_folds(self):
        case = complete_but_self_attested()
        case["prospective_fold_positive_label_windows"] = [120, 500, 308, 498]
        case["prospective_holdout_sealed_before_test_access"] = False
        case["independent_physical_events_reviewed"] = False
        report = screen_independent_mine_candidate(case)
        self.assertEqual(report["claimed_positive_support_folds"], 1)
        self.assertIn("INDEPENDENT_HOLDOUT_POSITIVE_SUPPORT_NOT_PROVEN",
                      report["outstanding_requirements"])
        self.assertIn("DISTINCT_PHYSICAL_METHANE_EVENTS_UNVERIFIED",
                      report["outstanding_requirements"])
        self.assertIn("PROSPECTIVE_HOLDOUT_SEPARATION_NOT_PROVEN",
                      report["outstanding_requirements"])
        case["prospective_fold_positive_label_windows"] = [True, 600, 600, 600]
        self.assertIsNone(screen_independent_mine_candidate(case)["claimed_positive_support_folds"])

    def test_missing_third_party_permissions_and_sensor_reviews_fail(self):
        case = complete_but_self_attested()
        case["external_review_references"] = {}
        r = screen_independent_mine_candidate(case)
        self.assertCountEqual(r["outstanding_external_review_categories"], REQUIRED_EXTERNAL_REVIEWS)
        self.assertIn("THIRD_PARTY_INDEPENDENCE_AND_SAFETY_REVIEW_INCOMPLETE",
                      r["outstanding_requirements"])

    def test_corrupted_hashes_or_wrong_model_pin_fail_closed(self):
        for field in ("canonical_source_sha256", "original_source_sha256",
                      "frozen_model_manifest_sha256"):
            case=complete_but_self_attested()
            case[field]="baddigest"
            with self.subTest(field=field):
                with self.assertRaisesRegex(ValueError, "sha256_invalid|pin_invalid"):
                    screen_independent_mine_candidate(case)
        case=complete_but_self_attested()
        case["frozen_model_manifest_sha256"]="c" * 64
        self.assertIn("FROZEN_MODEL_PIN_NOT_VERIFIED",
                      screen_independent_mine_candidate(case)["outstanding_requirements"])

    def test_catalog_sources_all_blocked_and_no_fake_independent_data(self):
        path=Path(__file__).parents[2] / "qualification" / "independent_mine_source_catalog_20261009.json"
        catalog=json.loads(path.read_text())
        self.assertEqual(catalog["schema"], "musitu.axiom.independent_mine_source_discovery.v1")
        self.assertEqual(len(catalog["sources"]), 4)
        self.assertFalse(catalog["global_constraints"]["current_independent_prediction_evidence_admitted"])
        for candidate in catalog["sources"]:
            with self.subTest(candidate=candidate["candidate_id"]):
                r = screen_independent_mine_candidate(candidate)
                self.assertFalse(r["production_admission"])
                self.assertFalse(r["independent_validation"])
                self.assertGreaterEqual(len(r["outstanding_requirements"]), 2)
        self.assertTrue(screen_independent_mine_candidate(catalog["sources"][0])["known_development_source"])

    def test_cli_writes_only_new_research_report_not_private_records(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);source=root/"candidate.json";report=root/"report.json"
            candidate=complete_but_self_attested()
            candidate["external_review_references"]["source_owner_data_use_authorization"]="private-contract-784325"
            source.write_text(json.dumps(candidate))
            command=[sys.executable,"-m","benchmarks.mining_adapter.independent_mine_readiness",
                     "--candidate",str(source),"--output",str(report)]
            first=subprocess.run(command,capture_output=True,text=True)
            self.assertEqual(first.returncode,0,first.stderr)
            output=report.read_text()
            self.assertNotIn("private-contract-784325",output)
            self.assertIn("INDEPENDENT_MINE_QUALIFICATION_BLOCKED",output)
            self.assertFalse(json.loads(output)["production_admission"])
            second=subprocess.run(command,capture_output=True,text=True)
            self.assertNotEqual(second.returncode,0)
            self.assertIn("independent_mine_report_must_be_new",second.stderr)


if __name__ == "__main__":
    unittest.main()
