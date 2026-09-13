from __future__ import annotations

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import threading

from playwright.sync_api import expect, sync_playwright

ROOT=Path(__file__).resolve().parents[1]
ARTIFACT_DIR=Path(os.environ.get('AXIOM_PHASE8_ARTIFACT_DIR','/tmp/axiom-interface-phase8'))
ARTIFACT_DIR.mkdir(parents=True,exist_ok=True)

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self,*_args): pass


def main():
    handler=lambda *args,**kwargs:QuietHandler(*args,directory=str(ROOT),**kwargs)
    server=ThreadingHTTPServer(('127.0.0.1',0),handler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    origin=f'http://127.0.0.1:{server.server_port}'
    try:
        with sync_playwright() as pw:
            browser=pw.chromium.launch(headless=True,executable_path=os.environ.get('AXIOM_CHROMIUM_EXECUTABLE') or shutil.which('chromium') or None)
            context=browser.new_context(viewport={'width':1440,'height':1000},reduced_motion='reduce')
            page=context.new_page();requests=[];page.on('request',lambda r:requests.append(r.url))
            page.goto(origin+'/index.html#/projects',wait_until='networkidle')
            page.wait_for_function('()=>Boolean(window.AxiomComputerBootstrap)')
            page.evaluate('()=>window.AxiomComputerBootstrap')
            page.locator('#project-create-form').wait_for(state='visible')
            page.locator('#project-name').fill('Phase 8 Computer Security Proof')
            page.locator('#project-goal').fill('Prove visible sandbox, approval, takeover, receipts, rollback and prompt-injection defenses')
            page.get_by_role('button',name='Create project').click();page.wait_for_timeout(120)
            project_id=page.locator('#project-select').input_value();assert project_id.startswith('prj_')

            # Computer is a first-class visible route and remains keyboard reachable through the global nav.
            page.goto(origin+'/index.html#/computer',wait_until='networkidle')
            page.locator('#computer-space').wait_for(state='visible')
            expect(page.get_by_role('link',name='Computer')).to_be_visible()
            page.locator('#computer-project').select_option(project_id)
            page.locator('#computer-fixture').select_option('safe')
            page.get_by_role('button',name='Start sandbox session').click();page.wait_for_timeout(180)
            session_id=page.evaluate('window.AxiomComputer.getCurrentSessionId()');assert session_id.startswith('computer_')
            row=page.evaluate('id=>window.AxiomComputer.store.get(id)',session_id)
            assert row['project_id']==project_id and row['status']=='ACTIVE'
            assert row['sandbox_mode']=='VISIBLE_LOCAL_SRCDOC_SANDBOX_NO_EXTERNAL_NETWORK'
            assert row['network_policy']=='DENY_BY_DEFAULT_NO_RUNTIME_FETCH'
            assert row['hidden_privileged_browser_session'] is False
            frame=page.locator('#computer-frame');assert frame.get_attribute('src') is None
            assert frame.get_attribute('sandbox')=='allow-same-origin'
            expect(page.locator('#computer-site')).to_contain_text('https://example.test/task')
            expect(page.locator('#computer-step')).to_contain_text('PAGE_OBSERVED')

            # Preview -> exact approval -> action -> receipt. Execute stays disabled before approval.
            page.locator('#computer-action-type').select_option('type')
            page.locator('#computer-action-target').fill('#name')
            page.locator('#computer-action-value').fill('Ada')
            page.get_by_role('button',name='Preview action').click();page.wait_for_timeout(100)
            action=page.evaluate('id=>(window.AxiomComputer.store.get(id)).then(r=>r.actions.at(-1))',session_id)
            assert action['status']=='PROPOSED' and len(action['action_sha256'])==64
            assert page.get_by_role('button',name='Execute approved action').is_disabled()
            stale=page.evaluate("""async ({sid,aid})=>{try{await window.AxiomComputer.store.approve(sid,aid,'0'.repeat(64),'local-user');return 'ALLOWED'}catch(e){return e.name}}""",{'sid':session_id,'aid':action['action_id']})
            assert stale=='SecurityError'
            page.get_by_role('button',name='Approve exact preview').click();page.wait_for_timeout(100)
            assert page.get_by_role('button',name='Execute approved action').is_enabled()
            page.get_by_role('button',name='Execute approved action').click();page.wait_for_timeout(150)
            expect(page.locator('#computer-receipts')).to_contain_text('approval:')
            expect(page.locator('#computer-receipts')).to_contain_text('action:')
            frame_input=page.frame_locator('#computer-frame').locator('#name');expect(frame_input).to_have_value('Ada')

            # Rollback restores the visible field and records rollback evidence.
            page.get_by_role('button',name='Rollback last action').click();page.wait_for_timeout(120)
            expect(frame_input).to_have_value('')
            expect(page.locator('#computer-receipts')).to_contain_text('rollback:')

            # Pause/resume and takeover both stop agent execution until the user explicitly releases control.
            page.get_by_role('button',name='Pause').click();page.wait_for_timeout(60)
            paused=page.evaluate('id=>window.AxiomComputer.store.get(id)',session_id);assert paused['status']=='PAUSED'
            page.get_by_role('button',name='Resume').click();page.wait_for_timeout(60)
            page.get_by_role('button',name='Take over').click();page.wait_for_timeout(60)
            takeover=page.evaluate('id=>window.AxiomComputer.store.get(id)',session_id);assert takeover['takeover'] is True and takeover['status']=='PAUSED'
            blocked=page.evaluate("""async id=>{try{await window.AxiomComputer.store.propose(id,{actionType:'click',target:'#commit'});return 'ALLOWED'}catch(e){return e.name}}""",session_id)
            assert blocked=='InvalidStateError'
            page.get_by_role('button',name='Release takeover').click();page.wait_for_timeout(60)

            # Domain policy, restricted clipboard, and symbolic credential scope fail closed.
            domain_block=page.evaluate("""async id=>{try{await window.AxiomComputer.store.propose(id,{actionType:'navigate',target:'https://evil.test/'});return 'ALLOWED'}catch(e){return e.name}}""",session_id)
            secret_block=page.evaluate("""async id=>{try{await window.AxiomComputer.store.propose(id,{actionType:'type',target:'#name',value:'password=hunter2'});return 'ALLOWED'}catch(e){return e.name}}""",session_id)
            clipboard_block=page.evaluate("""async id=>{try{await window.AxiomComputer.store.copyRestricted(id,'api_key=secret');return 'ALLOWED'}catch(e){return e.name}}""",session_id)
            credential_block=page.evaluate("""async id=>{try{await window.AxiomComputer.store.authorizeCredential(id,'demo-login','https://example.test/');return 'ALLOWED'}catch(e){return e.name}}""",session_id)
            assert [domain_block,secret_block,clipboard_block,credential_block]==['SecurityError']*4
            safe_clip=page.evaluate("""async id=>{await window.AxiomComputer.store.copyRestricted(id,'safe local note');return await window.AxiomComputer.store.pasteRestricted(id)}""",session_id)
            assert safe_clip=='safe local note'

            # Canonical hostile page is quarantined; content remains DATA_ONLY and cannot authorize an action.
            await_hostile=page.evaluate("""async id=>{await window.AxiomComputer.store.loadFixture(id,'hostile');return await window.AxiomComputer.refresh()}""",session_id)
            assert await_hostile is None;page.wait_for_timeout(100)
            hostile=page.evaluate('id=>window.AxiomComputer.store.get(id)',session_id)
            assert hostile['prompt_injection_quarantined'] is True
            assert set(['system-override','ignore-prior','policy-bypass','credential-request','tool-authority','role-escalation','data-exfiltration']).issubset(set(hostile['prompt_injection_flags']))
            expect(page.locator('#computer-policy')).to_contain_text('DATA_ONLY')
            quarantine_block=page.evaluate("""async id=>{try{await window.AxiomComputer.store.propose(id,{actionType:'click',target:'#go'});return 'ALLOWED'}catch(e){return e.name}}""",session_id)
            assert quarantine_block=='SecurityError'
            page.get_by_role('button',name='Acknowledge quarantine').click();page.wait_for_timeout(80)
            acknowledged=page.evaluate('id=>window.AxiomComputer.store.get(id)',session_id)
            assert acknowledged['prompt_injection_quarantined'] is False and acknowledged['prompt_injection_flags']

            # Observability linkage is one-to-one and contains policy/approval/tool events without secrets or hidden reasoning.
            trace=page.evaluate('id=>window.AxiomObservability.store.replay(id)',session_id)
            assert trace['integrity']['status']=='PASS'
            kinds=[e['kind'] for e in trace['events']]
            assert 'policy.decided' in kinds and 'approval.updated' in kinds and 'tool.called' in kinds
            trace_json=json.dumps(trace,sort_keys=True)
            assert 'hunter2' not in trace_json and 'chain_of_thought' not in trace_json

            # Receipt tampering is detected, then exact restoration recovers PASS.
            tamper=page.evaluate("""async id=>{const s=window.AxiomComputer.store,row=await s.get(id),idx=row.receipts.findIndex(r=>r.receipt_id.startsWith('action:')),original=structuredClone(row.receipts[idx]);row.receipts[idx].after_state_sha256='0'.repeat(64);await s.put(row);const bad=await s.verify(id);row.receipts[idx]=original;await s.put(row);const good=await s.verify(id);return {bad,good}}""",session_id)
            assert tamper['bad']['status']=='FAIL' and any(x.startswith('receipt_hash:action:') for x in tamper['bad']['errors'])
            assert tamper['good']['status']=='PASS'

            # Hard reload preserves the project-bound sandbox session and integrity.
            page.reload(wait_until='networkidle');page.wait_for_function('()=>Boolean(window.AxiomComputerBootstrap)');page.evaluate('()=>window.AxiomComputerBootstrap');page.wait_for_timeout(120)
            persisted=page.evaluate('id=>window.AxiomComputer.store.get(id)',session_id);assert persisted['project_id']==project_id
            integrity=page.evaluate('id=>window.AxiomComputer.store.verify(id)',session_id);assert integrity['status']=='PASS',integrity
            page.evaluate('id=>window.AxiomComputer.selectSession(id)',session_id);page.wait_for_timeout(80)
            page.screenshot(path=str(ARTIFACT_DIR/'phase8-computer-security.png'),full_page=True)

            page.get_by_role('button',name='Stop').click();page.wait_for_timeout(100)
            stopped=page.evaluate('id=>window.AxiomComputer.store.get(id)',session_id);assert stopped['status']=='STOPPED' and stopped['restricted_clipboard'] is None
            final_trace=page.evaluate('id=>window.AxiomObservability.store.getRun(id)',session_id);assert final_trace['final_status']=='CANCELLED'

            foreign=[u for u in requests if not u.startswith(origin+'/')]
            assert foreign==[],foreign
            evidence={
              'schema':'musitu.axiom.interface.phase8-computer-browser-evidence.v1','status':'PASS','session_id':session_id,'project_id':project_id,
              'visible_sandbox_verified':True,'sandbox_attribute':'allow-same-origin','scripts_enabled_in_sandbox':False,
              'current_site_and_step_visible':True,'exact_preview_approval_verified':True,'stale_approval_rejected':True,
              'action_receipt_verified':True,'rollback_verified':True,'pause_resume_verified':True,'takeover_verified':True,'stop_verified':True,
              'domain_deny_verified':True,'restricted_clipboard_verified':True,'credential_scope_verified':True,
              'prompt_injection_quarantine_verified':True,'retrieved_instruction_authority':'DATA_ONLY','prompt_injection_flags':hostile['prompt_injection_flags'],
              'observability_linkage_verified':True,'tamper_detection_verified':True,'cross_reload_persistence_verified':True,
              'network_policy':'DENY_BY_DEFAULT_NO_RUNTIME_FETCH','foreign_requests':foreign,'hidden_privileged_browser_session':False,
              'arbitrary_external_site_execution_claimed':False,'os_level_computer_control_claimed':False,'production_isolation_certified':False,
              'integrity_sha256':integrity['integrity_sha256'],
            }
            (ARTIFACT_DIR/'phase8-computer-browser-evidence.json').write_text(json.dumps(evidence,indent=2,sort_keys=True)+'\n',encoding='utf-8')
            browser.close()
    finally:
        server.shutdown();server.server_close()
    print('MUSITU_AXIOM_INTERFACE_PHASE8_COMPUTER_BROWSER_PASS')

if __name__=='__main__':main()
