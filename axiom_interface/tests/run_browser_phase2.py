from __future__ import annotations

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import threading

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ARTIFACT_DIR = Path(os.environ.get("AXIOM_PHASE2_ARTIFACT_DIR", "/tmp/axiom-interface-phase2"))
ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args) -> None: pass


def main() -> None:
    handler=lambda *args,**kwargs:QuietHandler(*args,directory=str(ROOT),**kwargs)
    server=ThreadingHTTPServer(("127.0.0.1",0),handler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    origin=f"http://127.0.0.1:{server.server_port}"
    try:
        with sync_playwright() as pw:
            browser=pw.chromium.launch(headless=True,executable_path=os.environ.get('AXIOM_CHROMIUM_EXECUTABLE') or shutil.which('chromium') or None)
            context=browser.new_context(viewport={"width":1280,"height":900},reduced_motion="reduce")
            page=context.new_page(); requests=[]; page.on('request',lambda r:requests.append(r.url))
            page.goto(origin+'/index.html#/projects',wait_until='networkidle')
            page.wait_for_function("window.AxiomProjects && window.AxiomProjects.store")
            assert page.get_by_role('heading',name='Projects',exact=True).is_visible()
            assert 'does not claim cloud or multi-device sync' in page.locator('.boundary-note').inner_text()

            page.locator('#project-name').fill('Phase 2 Persistence Proof')
            page.locator('#project-goal').fill('Prove stable graph identity, provenance and cross-session recovery')
            page.locator('#project-memory').select_option('project-only')
            page.get_by_role('button',name='Create project').click()
            page.wait_for_function("window.AxiomProjects.getCurrentProjectId() !== ''")
            project_id=page.evaluate("window.AxiomProjects.getCurrentProjectId()")
            assert project_id.startswith('prj_')

            for kind,title,source in [('source','Blueprint authority','authoritative-blueprint'),('artifact','Phase 2 evidence package','generated-interface')]:
                page.locator('#object-type').select_option(kind)
                page.locator('#object-name').fill(title)
                page.locator('#object-source').fill(source)
                page.get_by_role('button',name='Add object').click()
                page.wait_for_timeout(60)
            graph=page.evaluate("pid => window.AxiomProjects.store.graph(pid)",project_id)
            assert len(graph['objects'])==2
            source_id=next(x['object_id'] for x in graph['objects'] if x['type']=='source')
            artifact_id=next(x['object_id'] for x in graph['objects'] if x['type']=='artifact')
            page.locator('#edge-from').select_option(source_id); page.locator('#edge-to').select_option(artifact_id); page.locator('#edge-relation').fill('supports')
            page.get_by_role('button',name='Create link').click(); page.wait_for_timeout(80)
            before=page.evaluate("pid => window.AxiomProjects.store.graph(pid)",project_id)
            assert len(before['edges'])==1 and before['edges'][0]['relation']=='supports'
            assert before['project']['owner_id']=='local-user'
            assert before['project']['memory_scope']=='project-only'
            assert before['project']['permissions']==[{'principal_id':'local-user','role':'owner'}]
            assert page.evaluate("pid => window.AxiomProjects.store.verifyEventChain(pid)",project_id) is True

            denied=page.evaluate("""async pid => { try { await window.AxiomProjects.store.addObject(pid,'intruder',{type:'task',title:'forbidden',provenanceSource:'test'}); return 'ALLOWED'; } catch(e) { return e.name; } }""",project_id)
            assert denied=='NotAllowedError', denied

            # Cross-session proof 1: hard reload retains stable graph IDs and provenance.
            page.reload(wait_until='networkidle'); page.wait_for_function("window.AxiomProjects && window.AxiomProjects.store")
            await_result=page.evaluate("pid => window.AxiomProjects.selectProject(pid).then(()=>window.AxiomProjects.store.graph(pid))",project_id)
            assert await_result['project']['project_id']==project_id
            assert {x['object_id'] for x in await_result['objects']}=={source_id,artifact_id}
            assert await_result['objects'][0]['provenance']['source']
            assert len(await_result['edges'])==1
            assert page.evaluate("pid => window.AxiomProjects.store.verifyEventChain(pid)",project_id) is True

            # Cross-session proof 2: a fresh page in the same browser profile/origin sees the same graph.
            second=context.new_page(); second.goto(origin+'/index.html#/projects',wait_until='networkidle'); second.wait_for_function("window.AxiomProjects && window.AxiomProjects.store")
            persisted=second.evaluate("pid => window.AxiomProjects.store.graph(pid)",project_id)
            assert persisted['project']['project_id']==project_id
            assert {x['object_id'] for x in persisted['objects']}=={source_id,artifact_id}
            assert persisted['edges'][0]['from_id']==source_id and persisted['edges'][0]['to_id']==artifact_id
            assert second.evaluate("pid => window.AxiomProjects.store.verifyEventChain(pid)",project_id) is True
            second.close()

            foreign=[r for r in requests if not r.startswith(origin+'/')]
            assert not foreign,foreign
            page.screenshot(path=str(ARTIFACT_DIR/'project-home.png'),full_page=True)
            evidence={
                'schema':'musitu.axiom.interface.phase2-project-evidence.v1','status':'PASS','project_id':project_id,
                'stable_object_ids':[source_id,artifact_id],'object_count':2,'edge_count':1,'event_count':len(before['events']),
                'memory_scope':'project-only','permissions_fail_closed':True,'provenance_chain_verified':True,
                'cross_session_reload_verified':True,'cross_page_same_profile_verified':True,
                'persistence_scope':'browser-local-device','cloud_sync_claimed':False,'multi_device_sync_claimed':False,
                'foreign_requests':foreign
            }
            (ARTIFACT_DIR/'project-evidence.json').write_text(json.dumps(evidence,indent=2,sort_keys=True)+'\n',encoding='utf-8')
            browser.close()
    finally:
        server.shutdown();server.server_close()
    print('MUSITU_AXIOM_INTERFACE_PHASE2_PROJECT_GRAPH_PASS')

if __name__=='__main__': main()
