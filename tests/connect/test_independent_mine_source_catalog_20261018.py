"""Published-lead negative controls; no original mine telemetry or admission."""
from __future__ import annotations
import json
from pathlib import Path
import unittest
from benchmarks.mining_adapter.independent_mine_readiness import screen_independent_mine_candidate

CATALOG = Path(__file__).resolve().parents[2] / 'qualification' / 'independent_mine_source_catalog_20261018.json'


class PublicSourceRefreshTests(unittest.TestCase):
    def test_all_public_leads_remain_blocked(self):
        report = json.loads(CATALOG.read_text(encoding='utf-8'))
        self.assertEqual(report['schema'], 'musitu.axiom.independent_mine_source_discovery.v1')
        self.assertEqual(report['assessed_on'], '2026-10-18')
        self.assertEqual(report['record_count'], 5)
        self.assertEqual(len(report['sources']), 5)
        self.assertFalse(report['operator_permission_authenticated'])
        self.assertFalse(report['independent_mine_validation'])
        self.assertFalse(report['production_methane_prediction_qualification'])
        for source in report['sources']:
            with self.subTest(candidate=source['candidate_id']):
                self.assertFalse(source['original_source_bytes_obtained'])
                self.assertFalse(source['site_identity_independently_authenticated'])
                self.assertEqual(source['source_sha256_status'], 'NOT_ACQUIRED_NOT_BYTE_VERIFIED')
                self.assertEqual(source['source_permission_status'], 'NOT_AUTHENTICATED')
                gate = screen_independent_mine_candidate(source)
                self.assertEqual(gate['status'], 'INDEPENDENT_MINE_QUALIFICATION_BLOCKED')
                self.assertFalse(gate['independent_validation'])
                self.assertFalse(gate['production_methane_prediction_qualification'])
                self.assertFalse(gate['production_admission'])
                self.assertTrue(gate['outstanding_requirements'])

    def test_new_candidate_source_specific_exclusions(self):
        catalog = json.loads(CATALOG.read_text(encoding='utf-8'))
        results = {c['candidate_id']:screen_independent_mine_candidate(c)['outstanding_requirements']
                   for c in catalog['sources']}
        self.assertIn('REUSED_OR_ALIASED_DEVELOPMENT_SOURCE',results['polish-mendeley-reuse-in-2026-study'])
        self.assertIn('ONE_SECOND_SOURCE_CADENCE_NOT_VERIFIED',results['china-working-face-seven-2022-2023'])
        for key in ('shanxi-surface-methane-2022-field','bowen-airborne-methane-2026','china-monthly-mine-emissions-2018-2024'):
            self.assertIn('NO_ELIGIBLE_UNDERGROUND_SENSOR_STREAM',results[key])
        self.assertNotIn('ONE_SECOND_SOURCE_CADENCE_NOT_VERIFIED',results['shanxi-surface-methane-2022-field'])
        self.assertIn('FULL_28_MEASURED_SENSOR_CHANNELS_NOT_VERIFIED',results['shanxi-surface-methane-2022-field'])


if __name__ == '__main__':
    unittest.main()
