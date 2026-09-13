from __future__ import annotations

import json
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
APP=(ROOT/'app.js').read_text(encoding='utf-8')
LIVE=(ROOT/'live.js').read_text(encoding='utf-8')
DURABILITY=(ROOT/'live_durability.js').read_text(encoding='utf-8')
BRIDGE=(ROOT/'live_semantic_bridge.js').read_text(encoding='utf-8')
CSS=(ROOT/'styles'/'live.css').read_text(encoding='utf-8')
SW=(ROOT/'sw.js').read_text(encoding='utf-8')
SURFACE=json.loads((ROOT/'surface-map.json').read_text(encoding='utf-8'))


class Phase7LiveContractTests(unittest.TestCase):
    def test_live_is_wired_into_phase7_shell_and_offline_cache(self):
        self.assertIn("from './live.js'",APP)
        self.assertIn('initLiveWorkspace',APP)
        self.assertIn("state:'phase7'",APP)
        self.assertIn("from './live_semantic_bridge.js'",DURABILITY)
        self.assertIn('attachLiveSemanticBridge',DURABILITY)
        for asset in ["'./live.js'","'./live_durability.js'","'./live_semantic_bridge.js'","'./styles/live.css'"]:
            self.assertIn(asset,SW)
        self.assertIn("axiom-interface-phase7-v2",SW)

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
        self.assertIn('SEMANTIC_EXECUTION_END_TO_END_STOP',BRIDGE)
        self.assertIn('max_semantic_stop_ms:250',BRIDGE)

    def test_accessibility_has_non_drag_controls_live_regions_and_responsive_layout(self):
        for token in ['type="number"','aria-live="polite"','aria-label="Live camera or screen preview"','Keyboard-accessible normalized coordinates']:
            self.assertIn(token,LIVE)
        for token in ['aria-live="polite"','Analyze selected capture','Interrupt semantic work','aria-label="Semantic receipts"']:
            self.assertIn(token,BRIDGE)
        self.assertIn('@media(max-width:52rem)',CSS)
        self.assertIn('@media(forced-colors:active)',CSS)
        self.assertIn('.live-privacy .recording',CSS)

    def test_semantic_host_bridge_is_receipt_bound_and_fail_closed(self):
        for token in ['local semantic host unavailable','receipt_sha256','output_sha256','engine_asset_sha256','input_sha256','tool_receipt_sha256','OFFLINE_ASR_VERIFIED_MCP_SPECIALIST_TTS_DIALOGUE','OCR_TEXT_','offline-vosk-asr','offline-mcp-2026-specialist','LOCAL_HOST_ONLY_NO_CLOUD_NO_HIDDEN_REASONING_NO_GENERAL_VLM_CLAIM']:
            self.assertIn(token,BRIDGE)
        self.assertIn('host_transport:\'IN_PROCESS_HOST_ADAPTER\'',BRIDGE)
        self.assertIn('fail_closed_without_host:true',BRIDGE)
        self.assertIn('cloud_provider_used!==false',BRIDGE)
        self.assertIn('hidden_reasoning_recorded!==false',BRIDGE)
        self.assertNotIn('fetch(',BRIDGE)
        self.assertNotIn('WebSocket(',BRIDGE)
        self.assertNotIn('EventSource(',BRIDGE)

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

    def test_phase7_authority_is_exact_earned_descendant(self):
        authority=SURFACE['authority']
        self.assertEqual(authority['qualified_phase6_sha'],'db5eefa2982457c4045717a0b175bb5d0d9fc556')
        self.assertEqual(authority['qualified_phase7_sha'],'d8b3c233947a204e81b0753fd94afe777e8d1cf9')
        self.assertEqual(authority['qualified_phase7_run_id'],34724477902)
        self.assertEqual(authority['qualified_phase7_evidence_artifact_id'],10307990299)
        self.assertEqual(authority['qualified_phase7_evidence_digest'],'sha256:f4fa1fdca09634a9cfebf23cc3a8975a328c4064d41ef04440ef0bb80e4f93ac')
        self.assertEqual(SURFACE['live_substrate']['semantic_runtime_qualification']['qualified_sha'],authority['qualified_phase7_sha'])
        phase8_sha=authority.get('qualified_phase8_sha')
        if phase8_sha is None:
            self.assertEqual(SURFACE['phase'],'PHASE_7_LIVE_MULTIMODALITY')
        else:
            self.assertEqual(phase8_sha,'dd7a2a2f8a1c024d92df635ebaba430a74981813')
            self.assertEqual(SURFACE['computer_substrate']['qualified_sha'],phase8_sha)
            self.assertEqual(SURFACE['computer_substrate']['status'],'EARNED')
            phase9_sha=authority.get('qualified_phase9_sha')
            if phase9_sha is None:
                self.assertEqual(SURFACE['phase'],'PHASE_8_COMPUTER_BROWSER_EXECUTION')
            else:
                self.assertEqual(phase9_sha,'277478e12529f755fc4269b648e8fbe08caafb92')
                self.assertEqual(SURFACE['phase'],'PHASE_9_AGENTS_AUTOMATIONS')
                self.assertEqual(SURFACE['agent_automation_substrate']['qualified_sha'],phase9_sha)
                self.assertEqual(SURFACE['agent_automation_substrate']['status'],'EARNED')


if __name__=='__main__':
    unittest.main(verbosity=2)
