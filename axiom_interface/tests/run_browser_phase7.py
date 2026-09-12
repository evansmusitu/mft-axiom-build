from __future__ import annotations

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import base64
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import threading

REPO_ROOT=Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0,str(REPO_ROOT))

import cv2
import numpy as np
from playwright.sync_api import expect, sync_playwright

from frontier_v5.runtime.fullstack import MultimodalWorkbench
from frontier_v5.runtime.live_semantics import (
    ContinuousVoiceDialogueSession,
    InterruptibleSemanticTask,
    LiveSemanticError,
    MCP2026SpecialistHook,
    VisualSemanticEngine,
    VoiceDialogueEngine,
)
from frontier_v5.runtime.mcp_2026 import MCP2026Server

ROOT=Path(__file__).resolve().parents[1]
ARTIFACT_DIR=Path(os.environ.get('AXIOM_PHASE7_ARTIFACT_DIR','/tmp/axiom-interface-phase7'))
ARTIFACT_DIR.mkdir(parents=True,exist_ok=True)
VOSK_MODEL_DIR=Path(os.environ.get('AXIOM_VOSK_MODEL_DIR','/tmp/axiom-vosk/vosk-model-small-en-us-0.15'))
VOSK_MODEL_SHA256=os.environ.get('AXIOM_VOSK_MODEL_SHA256','30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498')

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
    constructor(stream){ this.stream=stream; this.state='inactive'; const kind=stream.__axiomKind; this.mimeType=kind==='voice'?'audio/wav':'image/png'; this.ondataavailable=null; this.onstop=null; }
    start(){ this.state='recording'; }
    stop(){ this.state='inactive'; const kind=this.stream.__axiomKind||'media'; queueMicrotask(()=>{ const encoded=window.__AXIOM_MEDIA_FIXTURES[kind]; const binary=atob(encoded); const bytes=new Uint8Array(binary.length); for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i); const data=new Blob([bytes],{type:this.mimeType}); if(this.ondataavailable)this.ondataavailable({data}); if(this.onstop)this.onstop(); }); }
  }
  Object.defineProperty(window,'MediaRecorder',{configurable:true,value:FakeMediaRecorder});
})();
"""


def _write_text_image(path: Path, lines: list[tuple[str, tuple[int,int]]], *, width: int, height: int) -> None:
    image=np.full((height,width,3),255,dtype=np.uint8)
    for text,origin in lines:
        cv2.putText(image,text,origin,cv2.FONT_HERSHEY_SIMPLEX,1.35,(0,0,0),3,cv2.LINE_AA)
    assert cv2.imwrite(str(path),image)


def _build_specialist() -> tuple[MCP2026SpecialistHook,list[dict[str,object]]]:
    calls=[]
    def list_tools():
        return [{'name':'axiom_live_specialist','description':'Evidence-safe local Live specialist hook','inputSchema':{'type':'object','properties':{'utterance':{'type':'string'},'specialist_id':{'type':'string'}},'required':['utterance','specialist_id']}}]
    def call_tool(name,arguments):
        assert name=='axiom_live_specialist'
        utterance=str(arguments.get('utterance') or '').strip();specialist_id=str(arguments.get('specialist_id') or '').strip()
        assert utterance and specialist_id=='live-dialogue-specialist-v1'
        calls.append({'name':name,'utterance':utterance,'specialist_id':specialist_id})
        return {'spoken_response':f'Live specialist received {len(utterance.split())} spoken words.','specialist_id':specialist_id,'semantic_action':'ACKNOWLEDGE_TRANSCRIBED_LIVE_TURN'}
    server=MCP2026Server(server_name='musitu-axiom-live-browser-bridge',server_version='7.0',list_tools=list_tools,call_tool=call_tool,instructions='Local Phase 7 browser bridge evidence-only specialist execution.')
    return MCP2026SpecialistHook(server=server,tool_name='axiom_live_specialist',specialist_id='live-dialogue-specialist-v1'),calls


def _host_runtime():
    if not VOSK_MODEL_DIR.is_dir():
        raise RuntimeError(f'Vosk model unavailable: {VOSK_MODEL_DIR}')
    host_dir=ARTIFACT_DIR/'semantic-host';host_dir.mkdir(parents=True,exist_ok=True)
    visual=VisualSemanticEngine();voice=VoiceDialogueEngine(model_path=VOSK_MODEL_DIR,model_archive_sha256=VOSK_MODEL_SHA256)
    specialist,tool_calls=_build_specialist();dialogues={}

    def execute(payload):
        assert payload['schema']=='musitu.axiom.live-semantic-host-request.v1'
        raw=base64.b64decode(payload['bytes_base64'],validate=True)
        assert hashlib.sha256(raw).hexdigest()==payload['input_sha256']
        modality=payload['modality'];capture_id=payload['capture_id'];suffix='.wav' if modality=='voice' else '.png'
        path=host_dir/f'{capture_id}{suffix}';path.write_bytes(raw)
        if modality=='voice':
            session=dialogues.get(payload['session_id'])
            if session is None:
                session=ContinuousVoiceDialogueSession(engine=voice,specialist=specialist,session_id=payload['session_id'],project_id=payload['project_id'],actor_id=payload['actor_id'])
                dialogues[payload['session_id']]=session
            return session.process_turn(wav_path=path,response_directory=host_dir/'responses')
        return visual.interpret(image_path=path,modality=modality,session_id=payload['session_id'],project_id=payload['project_id'],actor_id=payload['actor_id'],execution_id=f"browser-bridge:{capture_id}",normalized_region=payload.get('screen_region')).evidence()

    def interrupt(payload):
        assert payload['schema']=='musitu.axiom.live-semantic-host-interrupt.v1' and payload['session_id']
        task=InterruptibleSemanticTask();reached=threading.Event();cancelled=[]
        fixture=host_dir/'interrupt-input.wav';MultimodalWorkbench.synthesize_speech('interrupt axiom live semantic work',fixture)
        def blocking_specialist(_transcript,tool_call_id):
            reached.set();task.event.wait(2.0)
            return {'spoken_response':'cancelled semantic response','tool_call_id':tool_call_id,'specialist_id':'interrupt-test-specialist','tool_receipt_sha256':'c'*64}
        def worker_fn():
            try:
                voice.turn(wav_path=fixture,response_wav_path=host_dir/'interrupted-response.wav',session_id=payload['session_id'],project_id='prj_interrupt_bridge',actor_id='local-user',execution_id='browser-semantic-interrupt',tool_call_id='browser-semantic-interrupt-tool',specialist=blocking_specialist,interrupt=task.event)
            except LiveSemanticError as exc:
                cancelled.append(str(exc))
        worker=threading.Thread(target=worker_fn,daemon=True);worker.start();assert reached.wait(20.0)
        result=task.interrupt_and_wait(worker,timeout_seconds=0.25);assert cancelled and 'interrupted' in cancelled[0]
        return result
    return execute,interrupt,tool_calls


def _fixtures():
    fixture_dir=ARTIFACT_DIR/'semantic-fixtures';fixture_dir.mkdir(parents=True,exist_ok=True)
    voice=fixture_dir/'voice.wav';camera=fixture_dir/'camera.png';screen=fixture_dir/'screen.png'
    MultimodalWorkbench.synthesize_speech('hello axiom live bridge',voice)
    _write_text_image(camera,[('CAMERA LIVE SEVEN',(90,190))],width=1200,height=360)
    _write_text_image(screen,[('SCREEN REGION SEVEN',(150,250)),('OUTSIDE',(850,520))],width=1200,height=600)
    return {k:base64.b64encode(p.read_bytes()).decode('ascii') for k,p in {'voice':voice,'camera':camera,'screen':screen}.items()}


def main():
    semantic_execute,semantic_interrupt,tool_calls=_host_runtime();fixtures=_fixtures()
    handler=lambda *args,**kwargs:QuietHandler(*args,directory=str(ROOT),**kwargs)
    server=ThreadingHTTPServer(('127.0.0.1',0),handler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    origin=f'http://127.0.0.1:{server.server_port}'
    try:
        with sync_playwright() as pw:
            browser=pw.chromium.launch(headless=True,executable_path=os.environ.get('AXIOM_CHROMIUM_EXECUTABLE') or shutil.which('chromium') or None)
            context=browser.new_context(viewport={'width':1360,'height':1000},reduced_motion='reduce')
            context.expose_function('__axiomSemanticExecute',semantic_execute)
            context.expose_function('__axiomSemanticInterrupt',semantic_interrupt)
            context.add_init_script(f"window.__AXIOM_MEDIA_FIXTURES={json.dumps(fixtures)};")
            context.add_init_script("window.AxiomLiveSemanticHost=Object.freeze({execute:payload=>window.__axiomSemanticExecute(payload),interrupt:payload=>window.__axiomSemanticInterrupt(payload)});")
            context.add_init_script(MEDIA_MOCK)
            page=context.new_page();requests=[];page.on('request',lambda r:requests.append(r.url))

            page.goto(origin+'/index.html#/projects',wait_until='networkidle')
            page.locator('#project-create-form').wait_for(state='visible')
            page.locator('#project-name').fill('Phase 7 Live Multimodality Proof')
            page.locator('#project-goal').fill('Prove permissioned media, semantic host receipts, interruption, annotation and project-linked evidence')
            page.locator('#project-memory').select_option('project-only')
            page.get_by_role('button',name='Create project').click()
            project_select=page.locator('#project-select');expect(project_select).not_to_have_value('')
            project_id=project_select.input_value();assert project_id.startswith('prj_')

            page.goto(origin+'/index.html#/live',wait_until='networkidle')
            page.locator('#live-space').wait_for(state='visible')
            page.wait_for_function('()=>Boolean(window.AxiomLiveSemantic)')
            assert page.evaluate('window.AxiomLiveSemantic.host_connected') is True
            page.locator('#live-project').select_option(project_id)
            page.get_by_role('button',name='Start Live session').click();page.wait_for_timeout(120)
            session_id=page.evaluate('window.AxiomLive.getCurrentSessionId()');assert session_id.startswith('live_')
            row=page.evaluate('id=>window.AxiomLive.store.get(id)',session_id)
            assert row['project_id']==project_id and row['actor_id']=='local-user' and row['status']=='ACTIVE'
            assert row['permissions']=={'voice':'prompt','camera':'prompt','screen':'prompt'}
            assert row['privacy_indicator_active'] is False

            for modality in ['voice','camera','screen']:
                page.locator(f'[data-permission="{modality}"]').click();page.wait_for_timeout(80)
            row=page.evaluate('id=>window.AxiomLive.store.get(id)',session_id)
            assert row['permissions']=={'voice':'granted','camera':'granted','screen':'granted'}

            page.locator('#live-region-x').fill('0.10');page.locator('#live-region-y').fill('0.20')
            page.locator('#live-region-width').fill('0.50');page.locator('#live-region-height').fill('0.40')
            page.get_by_role('button',name='Save screen region').click();page.wait_for_timeout(80)
            row=page.evaluate('id=>window.AxiomLive.store.get(id)',session_id)
            assert row['selected_screen_region']=={'x':0.1,'y':0.2,'width':0.5,'height':0.4}

            for modality,label in [('voice','Microphone'),('camera','Camera'),('screen','Screen')]:
                button=page.locator(f'[data-record="{modality}"]');button.click();page.wait_for_timeout(60)
                expect(page.locator(f'[data-privacy="{modality}"]')).to_contain_text('RECORDING')
                assert page.evaluate('args=>window.AxiomLive.store.get(args[0]).then(r=>r.recording[args[1]])',[session_id,modality]) is True
                button.click();expected_count={'voice':1,'camera':2,'screen':3}[modality]
                expect(page.locator('#live-capture-list article')).to_have_count(expected_count,timeout=10000)
                row=page.evaluate('id=>window.AxiomLive.store.get(id)',session_id);assert len(row['captures'])==expected_count
                expect(page.locator(f'[data-privacy="{modality}"]')).to_contain_text('off')
            row=page.evaluate('id=>window.AxiomLive.store.get(id)',session_id)
            assert len(row['captures'])==3 and {c['modality'] for c in row['captures']}=={'voice','camera','screen'}
            assert all(len(c['content_sha256'])==64 and c['project_object_id'].startswith('obj_') for c in row['captures'])
            screen_capture=next(c for c in row['captures'] if c['modality']=='screen')
            assert screen_capture['screen_region']=={'x':0.1,'y':0.2,'width':0.5,'height':0.4} and screen_capture['model_understanding_claimed'] is False

            # Real browser -> local host -> semantic engine receipts over the exact durable captures.
            semantic_receipts=[]
            for capture in row['captures']:
                page.locator('#live-capture-select').select_option(capture['capture_id'])
                semantic_receipts.append(page.evaluate('id=>window.AxiomLiveSemantic.executeCapture(id)',capture['capture_id']))
            semantic_interruption=page.evaluate('()=>window.AxiomLiveSemantic.interrupt()')
            bridge_evidence=page.evaluate('id=>window.AxiomLiveSemantic.evidence(id)',session_id)
            assert bridge_evidence['status']=='PASS' and bridge_evidence['host_connected'] is True
            assert bridge_evidence['receipt_count']==3 and bridge_evidence['modalities']==['camera','screen','voice']
            assert bridge_evidence['voice_turn_count']==1 and bridge_evidence['mcp_tool_receipts_verified'] is True
            assert bridge_evidence['semantic_interruption_verified'] is True
            assert semantic_interruption['value']['scope']=='SEMANTIC_EXECUTION_END_TO_END_STOP'
            assert semantic_interruption['value']['within_target'] is True and semantic_interruption['value']['stop_latency_ms']<=250
            assert len(tool_calls)>=1
            expect(page.locator('#live-semantic-status')).to_contain_text('verified semantic receipts')

            page.locator('#live-capture-select').select_option(screen_capture['capture_id'])
            page.locator('#live-ann-x').fill('0.25');page.locator('#live-ann-y').fill('0.75')
            page.locator('#live-ann-text').fill('Inspect this selected screen region')
            page.get_by_role('button',name='Add annotation').click();page.wait_for_timeout(80)
            page.locator('#live-note').fill('Project-linked note from the Live session')
            page.get_by_role('button',name='Save project note').click();page.wait_for_timeout(80)
            for role,text in [('user','What is in the selected region?'),('assistant','Manual evidence turn; base capture layer still makes no model-understanding claim.')]:
                page.locator('#live-transcript-role').select_option(role);page.locator('#live-transcript-text').fill(text)
                page.get_by_role('button',name='Add transcript turn').click();page.wait_for_timeout(60)
            row=page.evaluate('id=>window.AxiomLive.store.get(id)',session_id)
            assert len(row['annotations'])==1 and len(row['notes'])==1 and len(row['transcript'])==4
            assert sum(t['source']=='offline-vosk-asr' for t in row['transcript'])==1
            assert sum(t['source']=='offline-mcp-2026-specialist' for t in row['transcript'])==1
            assert all(t['hidden_reasoning'] is False for t in row['transcript'])
            expect(page.locator('#live-transcript')).to_contain_text('Manual evidence turn')

            page.get_by_role('button',name='Interrupt now').click();page.wait_for_timeout(80)
            row=page.evaluate('id=>window.AxiomLive.store.get(id)',session_id)
            assert len(row['interruption_measurements'])==1
            interruption=row['interruption_measurements'][0]
            assert interruption['scope']=='LOCAL_UI_ACKNOWLEDGEMENT_ONLY' and interruption['engineering_target_ms']==250 and interruption['latency_ms']>=0 and interruption['within_target'] is True
            expect(page.locator('#live-interruption')).to_contain_text('within target')

            graph=page.evaluate('pid=>window.AxiomProjects.store.graph(pid)',project_id)
            live_objects=[o for o in graph['objects'] if o['provenance']['source'].startswith('axiom-live:')]
            assert len(live_objects)==5 and sum(o['type']=='conversation' for o in live_objects)==1 and sum(o['type']=='artifact' for o in live_objects)==3 and sum(o['type']=='memory' for o in live_objects)==1
            assert page.evaluate('pid=>window.AxiomProjects.store.verifyEventChain(pid)',project_id) is True

            integrity=page.evaluate('id=>window.AxiomLive.store.verify(id)',session_id);assert integrity['status']=='PASS',integrity
            evidence=page.evaluate('id=>window.AxiomLive.store.evidence(id)',session_id)
            assert evidence['understanding_boundary']=='CAPTURE_AND_CONTEXT_SUBSTRATE_ONLY_NO_MODEL_UNDERSTANDING_CLAIM' and evidence['interruption_scope']=='LOCAL_UI_ACKNOWLEDGEMENT_ONLY'

            tamper=page.evaluate("""async id=>{const s=window.AxiomLive.store,row=await s.get(id),original=structuredClone(row),bad=structuredClone(row);bad.captures[0].content_sha256='b'.repeat(64);let tx=s.db.transaction('sessions','readwrite');tx.objectStore('sessions').put(bad);await new Promise((r,j)=>{tx.oncomplete=r;tx.onerror=()=>j(tx.error)});const failed=await s.verify(id);tx=s.db.transaction('sessions','readwrite');tx.objectStore('sessions').put(original);await new Promise((r,j)=>{tx.oncomplete=r;tx.onerror=()=>j(tx.error)});const restored=await s.verify(id);return {failed,restored};}""",session_id)
            assert tamper['failed']['status']=='FAIL' and any(x.startswith('capture_hash:') for x in tamper['failed']['errors']) and tamper['restored']['status']=='PASS'

            page.get_by_role('button',name='End session').click();page.wait_for_timeout(120)
            ended=page.evaluate('id=>window.AxiomLive.store.get(id)',session_id)
            assert ended['status']=='ENDED' and ended['privacy_indicator_active'] is False and not any(ended['recording'].values())
            assert ended['model_understanding_claimed'] is False and ended['real_device_certification_claimed'] is False and ended['automated_transcription_claimed'] is False and ended['cloud_media_upload_claimed'] is False

            page.reload(wait_until='networkidle');page.locator('#live-space').wait_for(state='visible')
            page.wait_for_function('()=>Boolean(window.AxiomLive&&window.AxiomLiveSemantic)')
            page.evaluate('id=>window.AxiomLive.selectSession(id)',session_id);page.wait_for_timeout(100)
            persisted=page.evaluate('id=>window.AxiomLive.store.get(id)',session_id)
            assert persisted['session_id']==session_id and persisted['status']=='ENDED'
            assert len(persisted['captures'])==3 and len(persisted['annotations'])==1 and len(persisted['notes'])==1 and len(persisted['transcript'])==4
            final_integrity=page.evaluate('id=>window.AxiomLive.store.verify(id)',session_id);assert final_integrity['status']=='PASS'
            persisted_bridge=page.evaluate('id=>window.AxiomLiveSemantic.evidence(id)',session_id)
            assert persisted_bridge['status']=='PASS' and persisted_bridge['receipt_count']==3 and persisted_bridge['semantic_interruption_verified'] is True

            foreign=[u for u in requests if not u.startswith(origin+'/')];assert not foreign,foreign
            page.screenshot(path=str(ARTIFACT_DIR/'phase7-live-multimodality.png'),full_page=True)
            proof={
                'schema':'musitu.axiom.interface.phase7-live-evidence.v2','status':'PASS','project_id':project_id,'session_id':session_id,
                'modalities':['voice','camera','screen'],'explicit_permissions_verified':True,'visible_privacy_indicators_verified':True,'recording_controls_verified':True,
                'screen_region_keyboard_control_verified':True,'annotation_verified':True,'project_linked_capture_count':3,'project_linked_note_verified':True,
                'manual_transcript_turn_count':2,'automated_semantic_transcript_turn_count':2,
                'interruption_measurement_scope':'LOCAL_UI_ACKNOWLEDGEMENT_ONLY','interruption_target_ms':250,'interruption_within_target':interruption['within_target'],'interruption_latency_ms':interruption['latency_ms'],
                'semantic_bridge':{'host_transport':'IN_PROCESS_HOST_ADAPTER','real_local_engine_execution_verified':True,'receipt_count':persisted_bridge['receipt_count'],'modalities':persisted_bridge['modalities'],'voice_turn_count':persisted_bridge['voice_turn_count'],'mcp_tool_receipts_verified':persisted_bridge['mcp_tool_receipts_verified'],'semantic_interruption_verified':persisted_bridge['semantic_interruption_verified'],'integrity_sha256':persisted_bridge['integrity']['integrity_sha256']},
                'capture_tamper_detected':True,'cross_reload_persistence_verified':True,'project_event_chain_verified':True,
                'base_capture_layer_model_understanding_claimed':False,'base_capture_layer_automated_transcription_claimed':False,'cloud_media_upload_claimed':False,'real_device_certification_claimed':False,
                'semantic_scope':'OFFLINE_SCOPED_ASR_OCR_QR_MCP_SPECIALIST_NOT_GENERAL_VLM','device_api_test_mode':'DETERMINISTIC_MOCKED_MEDIA_APIS_WITH_REAL_CAPTURE_BYTES_AND_REAL_LOCAL_SEMANTIC_HOST_RUNTIME',
                'foreign_requests':foreign,'live_integrity_sha256':final_integrity['integrity_sha256'],
            }
            (ARTIFACT_DIR/'phase7-live-evidence.json').write_text(json.dumps(proof,indent=2,sort_keys=True)+'\n',encoding='utf-8')
            browser.close()
    finally:
        server.shutdown();server.server_close()
    print('MUSITU_AXIOM_INTERFACE_PHASE7_LIVE_BROWSER_PASS')

if __name__=='__main__': main()