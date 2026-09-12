from __future__ import annotations

import unittest

from frontier_v5.runtime.live_session import INTERRUPTION_TARGET_MS, LiveSessionError, LiveSessionLedger

T0='2026-09-12T21:40:00+00:00'
T1='2026-09-12T21:40:00.100+00:00'
T2='2026-09-12T21:40:00.220+00:00'
T3='2026-09-12T21:40:01+00:00'
DIGEST='a'*64


def session():
    return LiveSessionLedger(session_id='live-1',project_id='project-1',actor_id='user-1',started_at=T0)


class LiveSessionContractTests(unittest.TestCase):
    def test_explicit_permission_privacy_indicator_and_recording_controls(self):
        s=session()
        with self.assertRaises(LiveSessionError):
            s.start_recording('voice',at=T1)
        s.set_permission('voice','granted',at=T1)
        s.start_recording('voice',at=T1)
        self.assertTrue(s.session['recording']['voice'])
        self.assertTrue(s.session['privacy_indicator_active'])
        with self.assertRaises(LiveSessionError):
            s.set_permission('voice','denied',at=T2)
        s.stop_recording('voice',at=T2)
        self.assertFalse(s.session['privacy_indicator_active'])
        self.assertEqual(s.verify_integrity()['status'],'PASS')

    def test_screen_region_capture_annotation_note_and_transcript_are_project_linked(self):
        s=session();s.set_permission('screen','granted',at=T1)
        region=s.select_screen_region(x=.1,y=.2,width=.5,height=.4,at=T1)
        self.assertEqual(region['region']['width'],.5)
        capture=s.capture(capture_id='cap-1',modality='screen',content_sha256=DIGEST,at=T2)
        self.assertEqual(capture['project_id'],'project-1')
        self.assertFalse(capture['model_understanding_claimed'])
        annotation=s.annotate(capture_id='cap-1',annotation_id='ann-1',x=.25,y=.75,text='inspect this region',at=T2)
        self.assertEqual(annotation['capture_id'],'cap-1')
        note=s.add_note(note_id='note-1',text='Project-linked live note',at=T2)
        self.assertEqual(note['project_id'],'project-1')
        turn=s.add_transcript_turn(turn_id='turn-1',role='user',text='What is shown here?',at=T2,source='manual-transcript')
        self.assertFalse(turn['hidden_reasoning'])
        bundle=s.evidence_bundle()
        self.assertEqual(bundle['integrity']['status'],'PASS')
        self.assertEqual(bundle['understanding_boundary'],'CAPTURE_AND_CONTEXT_SUBSTRATE_ONLY_NO_MODEL_UNDERSTANDING_CLAIM')

    def test_interruption_latency_is_measured_against_engineering_target(self):
        s=session()
        result=s.interrupt(requested_at=T1,acknowledged_at=T2)
        self.assertAlmostEqual(result['latency_ms'],120.0)
        self.assertTrue(result['within_target'])
        self.assertEqual(INTERRUPTION_TARGET_MS,250.0)
        slow=s.interrupt(requested_at=T1,acknowledged_at=T3)
        self.assertFalse(slow['within_target'])

    def test_invalid_regions_and_ungranted_capture_fail_closed(self):
        s=session()
        with self.assertRaises(LiveSessionError):
            s.capture(capture_id='cap-x',modality='camera',content_sha256=DIGEST,at=T1)
        s.set_permission('screen','granted',at=T1)
        with self.assertRaises(LiveSessionError):
            s.select_screen_region(x=.8,y=.8,width=.3,height=.3,at=T2)
        self.assertEqual(s.verify_integrity()['status'],'PASS')

    def test_live_evidence_tampering_is_detected(self):
        s=session();s.set_permission('camera','granted',at=T1);s.capture(capture_id='cap-1',modality='camera',content_sha256=DIGEST,at=T2)
        self.assertEqual(s.verify_integrity()['status'],'PASS')
        s.captures['cap-1']['content_sha256']='b'*64
        result=s.verify_integrity()
        self.assertEqual(result['status'],'FAIL')
        self.assertIn('capture_hash:cap-1',result['errors'])

    def test_end_requires_recordings_stopped_and_preserves_claim_boundaries(self):
        s=session();s.set_permission('voice','granted',at=T1);s.start_recording('voice',at=T1)
        with self.assertRaises(LiveSessionError):
            s.end(at=T2)
        s.stop_recording('voice',at=T2);ended=s.end(at=T3)
        self.assertEqual(ended['status'],'ENDED')
        self.assertFalse(ended['model_understanding_claimed'])
        self.assertFalse(ended['real_device_certification_claimed'])
        self.assertEqual(s.verify_integrity()['status'],'PASS')


if __name__=='__main__':
    unittest.main(verbosity=2,exit=False)
    print('MUSITU_AXIOM_INTERFACE_PHASE7_LIVE_RUNTIME_PASS')
