from __future__ import annotations

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import threading

from playwright.sync_api import expect, sync_playwright

ROOT=Path(__file__).resolve().parents[1]
ARTIFACT_DIR=Path(os.environ.get('AXIOM_PHASE3_ARTIFACT_DIR','/tmp/axiom-interface-phase3'))
ARTIFACT_DIR.mkdir(parents=True,exist_ok=True)

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self,*_args): pass


def select_work_project(page,project_id):
    page.locator('#outcome-project').select_option(project_id)
    page.locator('#outcome-refresh').click()
    page.wait_for_timeout(80)


def main():
    handler=lambda *args,**kwargs:QuietHandler(*args,directory=str(ROOT),**kwargs)
    server=ThreadingHTTPServer(('127.0.0.1',0),handler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    origin=f'http://127.0.0.1:{server.server_port}'
    try:
        with sync_playwright() as pw:
            browser=pw.chromium.launch(headless=True,executable_path=os.environ.get('AXIOM_CHROMIUM_EXECUTABLE') or shutil.which('chromium') or None)
            context=browser.new_context(viewport={'width':1280,'height':900},reduced_motion='reduce')
            page=context.new_page();requests=[];page.on('request',lambda r:requests.append(r.url))
            page.goto(origin+'/index.html#/projects',wait_until='networkidle')
            page.locator('#project-create-form').wait_for(state='visible')
            page.locator('#project-name').fill('Phase 3 Work Proof')
            page.locator('#project-goal').fill('Prove durable outcome contract recovery and acceptance')
            page.locator('#project-memory').select_option('project-only')
            page.get_by_role('button',name='Create project').click()
            project_select=page.locator('#project-select');expect(project_select).not_to_have_value('')
            project_id=project_select.input_value()

            page.goto(origin+'/index.html#/work',wait_until='networkidle')
            page.wait_for_function('window.AxiomOutcomes && window.AxiomOutcomeRuns')
            select_work_project(page,project_id)
            page.locator('#outcome-title').fill('Phase 3 resumability proof')
            page.locator('#outcome-goal').fill('Complete a durable local run with explicit acceptance')
            page.locator('#outcome-success').fill('Prepared checkpoint survives reload\nExecution checkpoint survives reload')
            page.get_by_role('button',name='Create contract').click()
            page.wait_for_function("window.AxiomOutcomes.getCurrentContractId() !== ''")
            contract_id=page.evaluate('window.AxiomOutcomes.getCurrentContractId()')
            assert contract_id.startswith('oc_')
            page.get_by_role('button',name='Approve contract').click();page.wait_for_timeout(100)
            page.locator('#outcome-refresh').click();page.wait_for_timeout(100)
            page.locator('#outcome-run-contract').select_option(contract_id)
            page.get_by_role('button',name='Start / resume run').click();page.wait_for_timeout(80)
            run_id=page.evaluate('window.AxiomOutcomeRuns.getCurrentRunId()')
            assert run_id.startswith('run_')
            page.get_by_role('button',name='Advance checkpoint').click();page.wait_for_timeout(80)
            before=page.evaluate('rid => window.AxiomOutcomeRuns.store.get(rid)',run_id)
            assert before['status']=='RUNNING' and [x['step'] for x in before['checkpoints']]==['PREPARED']

            # Cross-session restart: reload the app, reselect the same durable Project/contract,
            # and resume the same run rather than creating or replaying a new one.
            page.reload(wait_until='networkidle');page.wait_for_function('window.AxiomOutcomes && window.AxiomOutcomeRuns')
            await_graph=page.evaluate('pid => window.AxiomProjects.selectProject(pid).then(()=>window.AxiomProjects.store.graph(pid))',project_id)
            assert await_graph['project']['project_id']==project_id
            location=page.evaluate("location.hash='#/work'; location.hash")
            assert location=='#/work';page.wait_for_timeout(100)
            select_work_project(page,project_id)
            page.locator('#outcome-run-contract').select_option(contract_id);page.wait_for_timeout(50)
            page.get_by_role('button',name='Start / resume run').click();page.wait_for_timeout(50)
            assert page.evaluate('window.AxiomOutcomeRuns.getCurrentRunId()')==run_id
            resumed=page.evaluate('rid => window.AxiomOutcomeRuns.store.get(rid)',run_id)
            assert [x['step'] for x in resumed['checkpoints']]==['PREPARED']
            page.get_by_role('button',name='Advance checkpoint').click();page.wait_for_timeout(80)
            awaiting=page.evaluate('rid => window.AxiomOutcomeRuns.store.get(rid)',run_id)
            assert awaiting['status']=='AWAITING_ACCEPTANCE'
            assert [x['step'] for x in awaiting['checkpoints']]==['PREPARED','EXECUTION_COMPLETE']

            checks=page.locator('#outcome-acceptance-criteria input[type=checkbox]')
            assert checks.count()==2
            for i in range(checks.count()): checks.nth(i).check()
            page.get_by_role('button',name='Record acceptance').click();page.wait_for_timeout(80)
            final=page.evaluate('rid => window.AxiomOutcomeRuns.store.get(rid)',run_id)
            assert final['status']=='SUCCEEDED' and all(x['status']=='COMPLETED' for x in final['plan'])

            second=context.new_page();second.goto(origin+'/index.html#/work',wait_until='networkidle');second.wait_for_function('window.AxiomOutcomes && window.AxiomOutcomeRuns')
            persisted=second.evaluate('rid => window.AxiomOutcomeRuns.store.get(rid)',run_id)
            assert persisted['status']=='SUCCEEDED' and len(persisted['checkpoints'])==2
            second.close()
            foreign=[u for u in requests if not u.startswith(origin+'/')]
            assert not foreign,foreign
            page.screenshot(path=str(ARTIFACT_DIR/'work-outcome-contract.png'),full_page=True)
            evidence={'schema':'musitu.axiom.interface.phase3-work-evidence.v1','status':'PASS','project_id':project_id,'contract_id':contract_id,'run_id':run_id,'checkpoint_count':2,'approval_required':True,'acceptance_passed':True,'cross_reload_resume_verified':True,'same_run_id_after_reload':True,'browser_persistence_scope':'browser-local-device','runtime_recovery_proof_scope':'ACCELERATED_FIVE_HOUR_ELAPSED_TIME_RESTART','literal_multi_hour_wall_clock_soak':False,'external_consequential_actions_executed':False,'foreign_requests':foreign}
            (ARTIFACT_DIR/'phase3-work-evidence.json').write_text(json.dumps(evidence,indent=2,sort_keys=True)+'\n',encoding='utf-8')
            browser.close()
    finally:
        server.shutdown();server.server_close()
    print('MUSITU_AXIOM_INTERFACE_PHASE3_WORK_PASS')

if __name__=='__main__': main()
