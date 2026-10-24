"""Additional independent-site public leads remain metadata-only research."""
import json
from pathlib import Path
import unittest
from benchmarks.mining_adapter.independent_mine_readiness import screen_independent_mine_candidate

CATALOG = Path(__file__).resolve().parents[2] / 'qualification' / 'independent_mine_source_catalog_20261025.json'

class OctoberResearchLeadsTests(unittest.TestCase):
    def test_new_site_leads_cannot_claim_frozen_model_qualification(self):
        report = json.loads(CATALOG.read_text(encoding='utf-8'))
        self.assertEqual(report['schema'], 'musitu.axiom.independent_mine_source_discovery.v1')
        self.assertEqual(report['assessed_on'], '2026-10-25')
        self.assertEqual(report['record_count'], 2)
        self.assertEqual(len(report['sources']), 2)
        self.assertEqual(report['source_access_qualification'], 'PUBLIC_ARTICLE_METADATA_ONLY_NO_RAW_SOURCE')
        self.assertFalse(report['operator_permission_authenticated'])
        self.assertFalse(report['independent_mine_validation'])
        self.assertFalse(report['production_methane_prediction_qualification'])
        seen = set()
        for candidate in report['sources']:
            with self.subTest(candidate=candidate['candidate_id']):
                self.assertNotIn(candidate['candidate_id'], seen)
                seen.add(candidate['candidate_id'])
                self.assertFalse(candidate['original_source_bytes_obtained'])
                self.assertFalse(candidate['site_identity_independently_authenticated'])
                self.assertFalse(candidate['real_mine_independent_validation'])
                self.assertEqual(candidate['source_sha256_status'], 'NOT_ACQUIRED_NOT_BYTE_VERIFIED')
                self.assertEqual(candidate['source_permission_status'], 'NOT_AUTHENTICATED')
                self.assertEqual(candidate['independently_measured_canonical_sensors'], [])
                self.assertIn(candidate['sampling_seconds'], (15, 60))
                self.assertNotIn('prospective_fold_positive_label_windows', candidate)
                self.assertNotIn('external_model_evaluation_artifact_verified', candidate)
                check = screen_independent_mine_candidate(candidate)
                self.assertFalse(check['independent_validation'])
                self.assertFalse(check['production_admission'])
                self.assertFalse(check['production_methane_prediction_qualification'])
                self.assertFalse(check['compatible_with_frozen_model_proven'])
                self.assertIn('ONE_SECOND_SOURCE_CADENCE_NOT_VERIFIED', check['outstanding_requirements'])
                self.assertIn('FULL_28_MEASURED_SENSOR_CHANNELS_NOT_VERIFIED', check['outstanding_requirements'])
                self.assertIn('SOURCE_BYTE_PROVENANCE_NOT_AVAILABLE', check['outstanding_requirements'])
        self.assertEqual(seen, {'qianyingzi-w3211-author-request', 'xinyuan-31002-confidential-15s'})

if __name__ == '__main__':
    unittest.main()
