from __future__ import annotations

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import threading

from playwright.sync_api import expect, sync_playwright

ROOT=Path(__file__).resolve().parents[1]
ARTIFACT_DIR=Path(os.environ.get('AXIOM_PHASE6_ARTIFACT_DIR','/tmp/axiom-interface-phase6'))
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
            context=browser.new_context(viewport={'width':1360,'height':960},reduced_motion='reduce')
            page=context.new_page();requests=[];page.on('request',lambda r:requests.append(r.url))

            page.goto(origin+'/index.html#/projects',wait_until='networkidle')
            page.locator('#project-create-form').wait_for(state='visible')
            page.locator('#project-name').fill('Phase 6 Trace Identity Proof')
            page.locator('#project-goal').fill('Prove every durable Outcome run binds to trace and actor identity')
            page.locator('#project-memory').select_option('project-only')
            page.get_by_role('button',name='Create project').click()
            project_select=page.locator('#project-select');expect(project_select).not_to_have_value('')
            project_id=project_select.input_value();assert project_id.startswith('prj_')

            page.goto(origin+'/index.html#/work',wait_until='networkidle')
            page.locator('#outcome-contract-space').wait_for(state='visible')
            page.locator('#outcome-project').select_option(project_id)
            page.locator('#outcome-title').fill('Observed durable outcome')
            page.locator('#outcome-goal').fill('Complete a browser-local evidence-bound run')
            page.locator('#outcome-success').fill('Trace exists with actor identity\nAcceptance evidence is recorded')
            page.locator('#outcome-evidence').select_option('Strict')
            page.get_by_role('button',name='Create contract').click();page.wait_for_timeout(160)
            contract_id=page.evaluate('window.AxiomOutcomes.getCurrentContractId()');assert contract_id.startswith('oc_')
            page.get_by_role('button',name='Approve contract').click();page.wait_for_timeout(160)
            approval=page.evaluate('id=>window.AxiomOutcomes.store.approval(window.AxiomProjects,id)',contract_id)
            assert approval and approval['receipt_id'].startswith('obj_')

            await_refresh=page.evaluate('()=>window.AxiomOutcomeRuns.refresh()');assert await_refresh is None
            page.wait_for_timeout(120)
            page.locator('#outcome-run-contract').select_option(contract_id)
            page.get_by_role('button',name='Start / resume run').click();page.wait_for_timeout(180)
            run_id=page.evaluate('window.AxiomOutcomeRuns.getCurrentRunId()');assert run_id.startswith('run_')
            trace=page.evaluate('id=>window.AxiomObservability.store.getRun(id)',run_id)
            assert trace['run_id']==run_id
            assert trace['trace_id'].startswith('trace_')
            assert trace['actor_id']=='local-user'
            assert trace['user_intent_id']==contract_id
            assert trace['project_id']==project_id
            assert trace['production'] is False
            assert trace['hidden_reasoning_recorded'] is False and trace['secrets_recorded'] is False

            # Approval linkage plus start event must already be present.
            events=page.evaluate('id=>window.AxiomObservability.store.events(id)',run_id)
            assert [e['kind'] for e in events[:2]]==['run.started','approval.updated']
            assert all(e['trace_id']==trace['trace_id'] and e['linkage']['run_id']==run_id and e['actor_id'] for e in events)

            # Forbidden prompt/secret/reasoning metadata must fail closed before persistence.
            forbidden=page.evaluate("""async id=>{try{await window.AxiomObservability.store.recordEvent(id,{kind:'run.progress',actorId:'local-user',operational:{prompt:'do not store me'}});return 'ALLOWED';}catch(e){return e.name;}}""",run_id)
            assert forbidden=='SecurityError',forbidden
            assert len(page.evaluate('id=>window.AxiomObservability.store.events(id)',run_id))==2

            page.get_by_role('button',name='Advance checkpoint').click();page.wait_for_timeout(100)
            page.get_by_role('button',name='Advance checkpoint').click();page.wait_for_timeout(120)
            expect(page.locator('#outcome-acceptance-form')).to_be_visible()
            checks=page.locator('#outcome-acceptance-criteria input');assert checks.count()==2
            for i in range(checks.count()): checks.nth(i).check()
            page.locator('#outcome-acceptance-evidence').fill('browser-local Phase 6 acceptance evidence')
            page.get_by_role('button',name='Record acceptance').click();page.wait_for_timeout(180)

            completed=page.evaluate('id=>window.AxiomObservability.store.getRun(id)',run_id)
            assert completed['final_status']=='COMPLETED' and completed['ended_at']
            integrity=page.evaluate('id=>window.AxiomObservability.store.verify(id)',run_id)
            assert integrity['status']=='PASS',integrity
            replay=page.evaluate('id=>window.AxiomObservability.store.replay(id)',run_id)
            kinds=[e['kind'] for e in replay['events']]
            assert kinds[0]=='run.started' and kinds[-1]=='run.finished'
            assert kinds.count('run.progress')==2
            assert replay['scope']=='OPERATIONAL_METADATA_ONLY_NO_SECRETS_NO_HIDDEN_REASONING'
            assert all('prompt' not in e['operational'] and 'chain_of_thought' not in e['operational'] for e in replay['events'])

            # Direct event tampering must fail integrity, and exact restoration must recover PASS.
            tamper=page.evaluate("""async id=>{const s=window.AxiomObservability.store,events=await s.events(id),target=structuredClone(events[1]),bad=structuredClone(target);bad.operational.status='TAMPERED';let tx=s.db.transaction('events','readwrite');tx.objectStore('events').put(bad);await new Promise((r,j)=>{tx.oncomplete=r;tx.onerror=()=>j(tx.error)});const failed=await s.verify(id);tx=s.db.transaction('events','readwrite');tx.objectStore('events').put(target);await new Promise((r,j)=>{tx.oncomplete=r;tx.onerror=()=>j(tx.error)});const restored=await s.verify(id);return {failed,restored};}""",run_id)
            assert tamper['failed']['status']=='FAIL'
            assert any(x.startswith(f'event_hash:{run_id}:1') for x in tamper['failed']['errors'])
            assert tamper['restored']['status']=='PASS'

            # All three required interfaces must expose the same bounded trace substrate.
            page.goto(origin+'/index.html#/observability',wait_until='networkidle')
            page.locator('#observability-space').wait_for(state='visible')
            page.evaluate('()=>window.AxiomObservability.refresh()');page.wait_for_timeout(100)
            page.locator('#obs-run-select').select_option(run_id);page.wait_for_timeout(100)
            expect(page.locator('#obs-summary')).to_contain_text(trace['trace_id'])
            expect(page.locator('#obs-summary')).to_contain_text('local-user')
            expect(page.locator('#obs-user-panel')).to_contain_text('run.finished')
            page.get_by_role('tab',name='Developer Trace Explorer').click();page.wait_for_timeout(80)
            dev=page.locator('#obs-developer-panel').inner_text()
            assert run_id in dev and trace['trace_id'] in dev
            assert 'chain_of_thought' not in dev and 'do not store me' not in dev
            page.get_by_role('tab',name='Operator Control Plane').click();page.wait_for_timeout(80)
            expect(page.locator('#obs-operator-panel')).to_contain_text('Runs')
            expect(page.locator('#obs-error-taxonomy')).to_contain_text('INTEGRITY')

            # Hard reload preserves exact trace and actor linkage.
            page.reload(wait_until='networkidle');page.locator('#observability-space').wait_for(state='visible')
            page.evaluate('()=>window.AxiomObservability.refresh()');page.wait_for_timeout(100)
            persisted=page.evaluate('id=>window.AxiomObservability.store.replay(id)',run_id)
            assert persisted['run']['trace_id']==trace['trace_id']
            assert persisted['run']['actor_id']=='local-user'
            assert persisted['integrity']['status']=='PASS'
            health=page.evaluate('()=>window.AxiomObservability.store.operatorHealth()')
            assert health['run_count']>=1 and health['finished_count']>=1
            assert 'INTEGRITY' in health['error_taxonomy']

            # Outcome run IDs and observability run IDs must be one-to-one for this durable run path.
            outcome=page.evaluate('id=>window.AxiomOutcomeRuns.store.get(id)',run_id)
            assert outcome['run_id']==persisted['run']['run_id']

            foreign=[u for u in requests if not u.startswith(origin+'/')]
            assert not foreign,foreign
            page.screenshot(path=str(ARTIFACT_DIR/'phase6-run-inspector.png'),full_page=True)
            evidence={
                'schema':'musitu.axiom.interface.phase6-observability-evidence.v1','status':'PASS',
                'project_id':project_id,'contract_id':contract_id,'run_id':run_id,'trace_id':trace['trace_id'],'actor_id':'local-user',
                'outcome_run_trace_one_to_one_verified':True,'trace_actor_required_verified':True,'approval_trace_event_verified':True,
                'checkpoint_trace_events_verified':True,'terminal_trace_verified':True,'operational_replay_verified':True,
                'run_inspector_verified':True,'developer_trace_explorer_verified':True,'operator_control_plane_verified':True,
                'forbidden_prompt_field_rejected':True,'event_tamper_detected':True,'cross_reload_trace_persistence_verified':True,
                'production_claimed_for_browser_run':False,'cloud_telemetry_backend_claimed':False,'private_chain_of_thought_exposed':False,
                'foreign_requests':foreign,'trace_integrity_sha256':persisted['integrity']['integrity_sha256'],
            }
            (ARTIFACT_DIR/'phase6-observability-evidence.json').write_text(json.dumps(evidence,indent=2,sort_keys=True)+'\n',encoding='utf-8')
            browser.close()
    finally:
        server.shutdown();server.server_close()
    print('MUSITU_AXIOM_INTERFACE_PHASE6_OBSERVABILITY_BROWSER_PASS')

if __name__=='__main__': main()
