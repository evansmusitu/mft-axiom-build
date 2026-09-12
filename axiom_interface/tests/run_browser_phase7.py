from __future__ import annotations

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import threading

from playwright.sync_api import expect, sync_playwright

ROOT=Path(__file__).resolve().parents[1]
ARTIFACT_DIR=Path(os.environ.get('AXIOM_PHASE7_ARTIFACT_DIR','/tmp/axiom-interface-phase7'))
ARTIFACT_DIR.mkdir(parents=True,exist_ok=True)

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self,*_args): pass

MEDIA_MOCK=r"""
(() => {
  const makeStream = kind => {
    const stream = new MediaStream();
    Object.defineProperty(stream,'__axiomKind',{value:kind});
    return stream;
  };
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{
    getUserMedia: async constraints => makeStream(constraints && constraints.audio ? 'voice' : 'camera'),
    getDisplayMedia: async () => makeStream('screen')
  }});
  class FakeMediaRecorder {
    constructor(stream){ this.stream=stream; this.state='inactive'; this.mimeType=stream.__axiomKind==='voice'?'audio/webm':'video/webm'; this.ondataavailable=null; this.onstop=null; }
    start(){ this.state='recording'; }
    stop(){ this.state='inactive'; const kind=this.stream.__axiomKind||'media'; queueMicrotask(()=>{ const data=new Blob([`axiom-${kind}-capture`],{type:this.mimeType}); if(this.ondataavailable)this.ondataavailable({data}); if(this.onstop)this.onstop(); }); }
  }
  Object.defineProperty(window,'MediaRecorder',{configurable:true,value:FakeMediaRecorder});
})();
"""


def main():
    handler=lambda *args,**kwargs:QuietHandler(*args,directory=str(ROOT),**kwargs)
    server=ThreadingHTTPServer(('127.0.0.1',0),handler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    origin=f'http://127.0.0.1:{server.server_port}'
    try:
        with sync_playwright() as pw:
            browser=pw.chromium.launch(headless=True,executable_path=os.environ.get('AXIOM_CHROMIUM_EXECUTABLE') or shutil.which('chromium') or None)
            context=browser.new_context(viewport={'width':1360,'height':1000},reduced_motion='reduce')
            context.add_init_script(MEDIA_MOCK)
            page=context.new_page();requests=[];page.on('request',lambda r:requests.append(r.url))

            page.goto(origin+'/index.html#/projects',wait_until='networkidle')
            page.locator('#project-create-form').wait_for(state='visible')
            page.locator('#project-name').fill('Phase 7 Live Multimodality Proof')
            page.locator('#project-goal').fill('Prove permissioned media, interruption, annotation and project-linked evidence')
            page.locator('#project-memory').select_option('project-only')
            page.get_by_role('button',name='Create project').click()
            project_select=page.locator('#project-select');expect(project_select).not_to_have_value('')
            project_id=project_select.input_value();assert project_id.startswith('prj_')

            page.goto(origin+'/index.html#/live',wait_until='networkidle')
            page.locator('#live-space').wait_for(state='visible')
            page.locator('#live-project').select_option(project_id)
            page.get_by_role('button',name='Start Live session').click();page.wait_for_timeout(120)
            session_id=page.evaluate('window.AxiomLive.getCurrentSessionId()');assert session_id.startswith('live_')
            row=page.evaluate('id=>window.AxiomLive.store.get(id)',session_id)
            assert row['project_id']==project_id and row['actor_id']=='local-user' and row['status']=='ACTIVE'
            assert row['permissions']=={'voice':'prompt','camera':'prompt','screen':'prompt'}
            assert row['privacy_indicator_active'] is False

            # Explicit permissions gate every modality.
            for modality in ['voice','camera','screen']:
                page.locator(f'[data-permission="{modality}"]').click();page.wait_for_timeout(80)
            row=page.evaluate('id=>window.AxiomLive.store.get(id)',session_id)
            assert row['permissions']=={'voice':'granted','camera':'granted','screen':'granted'}

            # Keyboard-accessible screen region, no drag gesture required.
            page.locator('#live-region-x').fill('0.10')
            page.locator('#live-region-y').fill('0.20')
            page.locator('#live-region-width').fill('0.50')
            page.locator('#live-region-height').fill('0.40')
            page.get_by_role('button',name='Save screen region').click();page.wait_for_timeout(80)
            row=page.evaluate('id=>window.AxiomLive.store.get(id)',session_id)
            assert row['selected_screen_region']=={'x':0.1,'y':0.2,'width':0.5,'height':0.4}

            # Record each modality; visible privacy state must reflect active recording.
            for modality,label in [('voice','Microphone'),('camera','Camera'),('screen','Screen')]:
                button=page.locator(f'[data-record="{modality}"]')
                button.click();page.wait_for_timeout(60)
                expect(page.locator(f'[data-privacy="{modality}"]')).to_contain_text('RECORDING')
                active=page.evaluate('args=>window.AxiomLive.store.get(args[0]).then(r=>r.recording[args[1]])',[session_id,modality])
                assert active is True
                button.click()
                expected_count={'voice':1,'camera':2,'screen':3}[modality]
                page.wait_for_function('(args)=>window.AxiomLive.store.get(args[0]).then(r=>r.captures.length===args[1])',[session_id,expected_count])
                expect(page.locator(f'[data-privacy="{modality}"]')).to_contain_text('off')
            row=page.evaluate('id=>window.AxiomLive.store.get(id)',session_id)
            assert len(row['captures'])==3
            assert {c['modality'] for c in row['captures']}=={'voice','camera','screen'}
            assert all(len(c['content_sha256'])==64 and c['project_object_id'].startswith('obj_') for c in row['captures'])
            screen_capture=next(c for c in row['captures'] if c['modality']=='screen')
            assert screen_capture['screen_region']=={'x':0.1,'y':0.2,'width':0.5,'height':0.4}
            assert screen_capture['model_understanding_claimed'] is False

            # Annotation, project-linked note, and transcript/evidence log.
            page.locator('#live-capture-select').select_option(screen_capture['capture_id'])
            page.locator('#live-ann-x').fill('0.25');page.locator('#live-ann-y').fill('0.75')
            page.locator('#live-ann-text').fill('Inspect this selected screen region')
            page.get_by_role('button',name='Add annotation').click();page.wait_for_timeout(80)
            page.locator('#live-note').fill('Project-linked note from the Live session')
            page.get_by_role('button',name='Save project note').click();page.wait_for_timeout(80)
            for role,text in [('user','What is in the selected region?'),('assistant','Manual evidence turn; no model understanding is claimed.')]:
                page.locator('#live-transcript-role').select_option(role)
                page.locator('#live-transcript-text').fill(text)
                page.get_by_role('button',name='Add transcript turn').click();page.wait_for_timeout(60)
            row=page.evaluate('id=>window.AxiomLive.store.get(id)',session_id)
            assert len(row['annotations'])==1 and len(row['notes'])==1 and len(row['transcript'])==2
            assert all(t['hidden_reasoning'] is False for t in row['transcript'])
            expect(page.locator('#live-transcript')).to_contain_text('Manual evidence turn')

            # Local interruption acknowledgement is measured separately from model latency.
            page.get_by_role('button',name='Interrupt now').click();page.wait_for_timeout(80)
            row=page.evaluate('id=>window.AxiomLive.store.get(id)',session_id)
            assert len(row['interruption_measurements'])==1
            interruption=row['interruption_measurements'][0]
            assert interruption['scope']=='LOCAL_UI_ACKNOWLEDGEMENT_ONLY'
            assert interruption['engineering_target_ms']==250
            assert interruption['latency_ms']>=0
            assert interruption['within_target'] is True
            expect(page.locator('#live-interruption')).to_contain_text('within target')

            # Project graph receives one Live conversation, three capture artifacts and one note memory.
            graph=page.evaluate('pid=>window.AxiomProjects.store.graph(pid)',project_id)
            live_objects=[o for o in graph['objects'] if o['provenance']['source'].startswith('axiom-live:')]
            assert len(live_objects)==5
            assert sum(o['type']=='conversation' for o in live_objects)==1
            assert sum(o['type']=='artifact' for o in live_objects)==3
            assert sum(o['type']=='memory' for o in live_objects)==1
            assert page.evaluate('pid=>window.AxiomProjects.store.verifyEventChain(pid)',project_id) is True

            integrity=page.evaluate('id=>window.AxiomLive.store.verify(id)',session_id)
            assert integrity['status']=='PASS',integrity
            evidence=page.evaluate('id=>window.AxiomLive.store.evidence(id)',session_id)
            assert evidence['understanding_boundary']=='CAPTURE_AND_CONTEXT_SUBSTRATE_ONLY_NO_MODEL_UNDERSTANDING_CLAIM'
            assert evidence['interruption_scope']=='LOCAL_UI_ACKNOWLEDGEMENT_ONLY'

            # Tamper detection must fail closed and recover after exact restoration.
            tamper=page.evaluate("""async id=>{const s=window.AxiomLive.store,row=await s.get(id),original=structuredClone(row),bad=structuredClone(row);bad.captures[0].content_sha256='b'.repeat(64);let tx=s.db.transaction('sessions','readwrite');tx.objectStore('sessions').put(bad);await new Promise((r,j)=>{tx.oncomplete=r;tx.onerror=()=>j(tx.error)});const failed=await s.verify(id);tx=s.db.transaction('sessions','readwrite');tx.objectStore('sessions').put(original);await new Promise((r,j)=>{tx.oncomplete=r;tx.onerror=()=>j(tx.error)});const restored=await s.verify(id);return {failed,restored};}""",session_id)
            assert tamper['failed']['status']=='FAIL'
            assert any(x.startswith('capture_hash:') for x in tamper['failed']['errors'])
            assert tamper['restored']['status']=='PASS'

            # End only after all recording indicators are off.
            page.get_by_role('button',name='End session').click();page.wait_for_timeout(120)
            ended=page.evaluate('id=>window.AxiomLive.store.get(id)',session_id)
            assert ended['status']=='ENDED' and ended['privacy_indicator_active'] is False
            assert not any(ended['recording'].values())
            assert ended['model_understanding_claimed'] is False
            assert ended['real_device_certification_claimed'] is False
            assert ended['automated_transcription_claimed'] is False
            assert ended['cloud_media_upload_claimed'] is False

            # Cross-reload local persistence preserves evidence and integrity.
            page.reload(wait_until='networkidle');page.locator('#live-space').wait_for(state='visible')
            page.wait_for_function('()=>Boolean(window.AxiomLive)')
            page.evaluate('id=>window.AxiomLive.selectSession(id)',session_id);page.wait_for_timeout(100)
            persisted=page.evaluate('id=>window.AxiomLive.store.get(id)',session_id)
            assert persisted['session_id']==session_id and persisted['status']=='ENDED'
            assert len(persisted['captures'])==3 and len(persisted['annotations'])==1 and len(persisted['notes'])==1 and len(persisted['transcript'])==2
            final_integrity=page.evaluate('id=>window.AxiomLive.store.verify(id)',session_id)
            assert final_integrity['status']=='PASS'

            foreign=[u for u in requests if not u.startswith(origin+'/')]
            assert not foreign,foreign
            page.screenshot(path=str(ARTIFACT_DIR/'phase7-live-multimodality.png'),full_page=True)
            proof={
                'schema':'musitu.axiom.interface.phase7-live-evidence.v1','status':'PASS','project_id':project_id,'session_id':session_id,
                'modalities':['voice','camera','screen'],'explicit_permissions_verified':True,'visible_privacy_indicators_verified':True,
                'recording_controls_verified':True,'screen_region_keyboard_control_verified':True,'annotation_verified':True,
                'project_linked_capture_count':3,'project_linked_note_verified':True,'manual_transcript_turn_count':2,
                'interruption_measurement_scope':'LOCAL_UI_ACKNOWLEDGEMENT_ONLY','interruption_target_ms':250,
                'interruption_within_target':interruption['within_target'],'interruption_latency_ms':interruption['latency_ms'],
                'capture_tamper_detected':True,'cross_reload_persistence_verified':True,'project_event_chain_verified':True,
                'model_understanding_claimed':False,'automated_transcription_claimed':False,'cloud_media_upload_claimed':False,
                'real_device_certification_claimed':False,'device_api_test_mode':'DETERMINISTIC_MOCKED_MEDIA_APIS_NOT_REAL_HARDWARE_CERTIFICATION',
                'foreign_requests':foreign,'live_integrity_sha256':final_integrity['integrity_sha256'],
            }
            (ARTIFACT_DIR/'phase7-live-evidence.json').write_text(json.dumps(proof,indent=2,sort_keys=True)+'\n',encoding='utf-8')
            browser.close()
    finally:
        server.shutdown();server.server_close()
    print('MUSITU_AXIOM_INTERFACE_PHASE7_LIVE_BROWSER_PASS')

if __name__=='__main__': main()
