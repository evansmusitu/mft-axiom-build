from __future__ import annotations

import json
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
APP=(ROOT/'app.js').read_text(encoding='utf-8')
LIVE=(ROOT/'live.js').read_text(encoding='utf-8')
CSS=(ROOT/'styles'/'live.css').read_text(encoding='utf-8')
SW=(ROOT/'sw.js').read_text(encoding='utf-8')
SURFACE=json.loads((ROOT/'surface-map.json').read_text(encoding='utf-8'))


class Phase7LiveContractTests(unittest.TestCase):
    def test_live_is_wired_into_phase7_shell_and_offline_cache(self):
        self.assertIn("from './live.js'",APP)
        self.assertIn('initLiveWorkspace',APP)
        self.assertIn("state:'phase7'",APP)
        self.assertIn("'./live.js'",SW)
        self.assertIn("'./styles/live.css'",SW)
        self.assertIn("axiom-interface-phase7-v1",SW)

    def test_required_modalities_and_browser_media_controls_exist(self):
        self.assertEqual(SURFACE['live_substrate']['modalities'],['voice','camera','screen'])
        for token in ['getUserMedia','getDisplayMedia','MediaRecorder','data-permission','data-record']:
            self.assertIn(token,LIVE)
        self.assertIn('privacy_indicator_active',LIVE)
        self.assertIn('Privacy indicators',LIVE)

    def test_screen_region_annotation_project_context_and_evidence_exist(self):
        for token in ['selected_screen_region','screen.region.selected','live-region-x','live-region-y','live-region-width','live-region-height','annotation','projects.store.addObject','project_object_id','capture_sha256','content_sha256','transcript']:
            self.assertIn(token,LIVE)
        self.assertEqual(SURFACE['live_substrate']['selectable_screen_region'],'KEYBOARD_ACCESSIBLE_NORMALIZED_COORDINATES')
        self.assertTrue(SURFACE['live_substrate']['project_linked_notes'])
        self.assertTrue(SURFACE['live_substrate']['annotation'])

    def test_interruption_gate_is_explicitly_local_ui_measurement(self):
        self.assertIn('INTERRUPTION_TARGET_MS=250',LIVE)
        self.assertIn('LOCAL_UI_ACKNOWLEDGEMENT_ONLY',LIVE)
        self.assertEqual(SURFACE['live_substrate']['interruption_target_ms'],250)
        self.assertEqual(SURFACE['live_substrate']['interruption_measurement_scope'],'LOCAL_UI_ACKNOWLEDGEMENT_ONLY')

    def test_accessibility_has_non_drag_controls_live_regions_and_responsive_layout(self):
        for token in ['type="number"','aria-live="polite"','aria-label="Live camera or screen preview"','Keyboard-accessible normalized coordinates']:
            self.assertIn(token,LIVE)
        self.assertIn('@media(max-width:52rem)',CSS)
        self.assertIn('@media(forced-colors:active)',CSS)
        self.assertIn('.live-privacy .recording',CSS)

    def test_truth_boundaries_remain_fail_closed(self):
        live=SURFACE['live_substrate']
        self.assertFalse(live['model_understanding_claimed'])
        self.assertFalse(live['automated_transcription_claimed'])
        self.assertFalse(live['cloud_media_upload_claimed'])
        self.assertFalse(live['real_device_certification_claimed'])
        for token in ['model_understanding_claimed:false','automated_transcription_claimed:false','cloud_media_upload_claimed:false','real_device_certification_claimed:false','CAPTURE_AND_CONTEXT_SUBSTRATE_ONLY_NO_MODEL_UNDERSTANDING_CLAIM']:
            self.assertIn(token,LIVE)
        self.assertNotIn('fetch(',LIVE)
        self.assertNotIn('WebSocket(',LIVE)
        self.assertNotIn('EventSource(',LIVE)

    def test_phase7_authority_is_exact_earned_phase6_descendant(self):
        self.assertEqual(SURFACE['authority']['qualified_phase6_sha'],'db5eefa2982457c4045717a0b175bb5d0d9fc556')
        self.assertEqual(SURFACE['phase'],'PHASE_7_LIVE_MULTIMODALITY')


if __name__=='__main__':
    unittest.main(verbosity=2)
