from __future__ import annotations

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import threading

from playwright.sync_api import expect, sync_playwright

ROOT=Path(__file__).resolve().parents[1]
ARTIFACT_DIR=Path(os.environ.get('AXIOM_PHASE5_ARTIFACT_DIR','/tmp/axiom-interface-phase5'))
ARTIFACT_DIR.mkdir(parents=True,exist_ok=True)

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self,*_args): pass


def payload(project_id,kind,title,content,*,sources=None,deps=None):
    return {
        'projectId':project_id,'artifactType':kind,'title':title,'content':content,
        'metadata':{'format_version':1,'test_kind':kind},
        'sourceRefs':sources or [f'research:{kind}:claim'],
        'dependencyArtifactIds':deps or [],'provenanceSource':f'phase5-browser:{kind}',
    }


def main():
    handler=lambda *args,**kwargs:QuietHandler(*args,directory=str(ROOT),**kwargs)
    server=ThreadingHTTPServer(('127.0.0.1',0),handler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    origin=f'http://127.0.0.1:{server.server_port}'
    try:
        with sync_playwright() as pw:
            browser=pw.chromium.launch(headless=True,executable_path=os.environ.get('AXIOM_CHROMIUM_EXECUTABLE') or shutil.which('chromium') or None)
            context=browser.new_context(viewport={'width':1360,'height':960},reduced_motion='reduce',accept_downloads=True)
            page=context.new_page();requests=[];page.on('request',lambda r:requests.append(r.url))
            page.goto(origin+'/index.html#/projects',wait_until='networkidle')
            page.locator('#project-create-form').wait_for(state='visible')
            page.locator('#project-name').fill('Phase 5 Artifact Integrity Proof')
            page.locator('#project-goal').fill('Prove stable artifacts, versions, diff, rollback and provenance')
            page.locator('#project-memory').select_option('project-only')
            page.get_by_role('button',name='Create project').click()
            selector=page.locator('#project-select');expect(selector).not_to_have_value('')
            project_id=selector.input_value();assert project_id.startswith('prj_')

            updated=page.evaluate("""async pid=>{const s=window.AxiomProjects.store,p=await s.getProject(pid);return s.updateProject(pid,'local-user',{permissions:[{principal_id:'local-user',role:'owner'},{principal_id:'editor-user',role:'editor'},{principal_id:'viewer-user',role:'viewer'}]},p.revision)}""",project_id)
            assert len(updated['permissions'])==3

            page.goto(origin+'/index.html#/create',wait_until='networkidle')
            page.locator('#artifact-space').wait_for(state='visible')
            page.locator('#artifact-project').select_option(project_id);page.wait_for_timeout(100)

            document_content={'blocks':[{'type':'heading','text':'Phase 5 proof'},{'type':'paragraph','text':'Version zero evidence.'}]}
            page.locator('#artifact-type').select_option('document')
            page.locator('#artifact-name').fill('Evidence Document')
            page.locator('#artifact-sources').fill('research:c1, source:s1')
            page.locator('#artifact-metadata').fill(json.dumps({'format_version':1,'kind':'document'}))
            page.locator('#artifact-content').fill(json.dumps(document_content))
            page.get_by_role('button',name='Create artifact').click();page.wait_for_timeout(160)
            expect(page.locator('#artifact-editor')).to_be_visible()
            doc_id=page.evaluate('window.AxiomArtifacts.getCurrentArtifactId()');assert doc_id.startswith('art_')
            doc0=page.evaluate('id=>window.AxiomArtifacts.store.get("artifacts",id)',doc_id)
            assert doc0['artifact_id']==doc_id and doc0['current_version_number']==0
            assert doc0['project_object_id'].startswith('obj_')
            assert doc0['source_refs']==['research:c1','source:s1']

            sheet=page.evaluate("p=>window.AxiomArtifacts.store.create(window.AxiomProjects,'local-user',p)",payload(project_id,'sheet','Evidence Sheet',{'columns':['name','value'],'rows':[['alpha',1]]}))
            presentation=page.evaluate("p=>window.AxiomArtifacts.store.create(window.AxiomProjects,'local-user',p)",payload(project_id,'presentation','Evidence Presentation',{'slides':[{'title':'Opening','body':'Bound evidence'}]}))
            website=page.evaluate("p=>window.AxiomArtifacts.store.create(window.AxiomProjects,'local-user',p)",payload(project_id,'website','Static Website Preview',{'html':'<main><h1>Safe preview</h1></main>','css':'main{display:block}','js':'window.__MUST_NOT_RUN__=true'}))
            dashboard=page.evaluate("p=>window.AxiomArtifacts.store.create(window.AxiomProjects,'local-user',p)",payload(project_id,'dashboard','Evidence Dashboard',{'metrics':[{'label':'Score','value':7}],'panels':[]},deps=[doc_id]))
            website_id=website['artifact']['artifact_id']
            dashboard_id=dashboard['artifact']['artifact_id']
            ids=[doc_id,sheet['artifact']['artifact_id'],presentation['artifact']['artifact_id'],website_id,dashboard_id]
            assert len(set(ids))==5 and all(x.startswith('art_') for x in ids)
            rows=page.evaluate('pid=>window.AxiomArtifacts.store.list(pid)',project_id)
            assert {x['artifact_type'] for x in rows}=={'document','sheet','presentation','website','dashboard'}
            integrity=page.evaluate('pid=>window.AxiomArtifacts.store.verify(pid)',project_id)
            assert integrity['status']=='PASS',integrity

            graph=page.evaluate('pid=>window.AxiomProjects.store.graph(pid)',project_id)
            artifact_objects=[x for x in graph['objects'] if x['type']=='artifact']
            assert len(artifact_objects)==5
            assert all(any(a['project_object_id']==o['object_id'] for a in rows) for o in artifact_objects)
            dep_edges=[e for e in graph['edges'] if e['relation']=='depends_on']
            assert len(dep_edges)==1
            assert page.evaluate('pid=>window.AxiomProjects.store.verifyEventChain(pid)',project_id) is True

            denied=page.evaluate("""async args=>{try{const s=window.AxiomArtifacts.store,row=await s.get('artifacts',args[0]);await s.edit(window.AxiomProjects,'viewer-user',args[0],{expectedVersion:row.current_version_number,content:{bad:true},provenanceSource:'viewer-write'});return 'ALLOWED';}catch(e){return e.name;}}""",[doc_id])
            assert denied=='NotAllowedError',denied
            comment=page.evaluate("args=>window.AxiomArtifacts.store.addComment(window.AxiomProjects,'viewer-user',args[0],args[1])",[doc_id,'Viewer evidence comment'])
            assert comment['actor_id']=='viewer-user'

            await_refresh=page.evaluate('()=>window.AxiomArtifacts.refresh()');assert await_refresh is None
            page.locator(f'[data-artifact-id="{doc_id}"]').click();page.wait_for_timeout(100)
            document_v1={'blocks':[{'type':'heading','text':'Phase 5 proof'},{'type':'paragraph','text':'Version one evidence with a verified edit.'}]}
            page.locator('#artifact-edit-content').fill(json.dumps(document_v1))
            page.locator('#artifact-edit-metadata').fill(json.dumps({'format_version':2,'kind':'document'}))
            page.get_by_role('button',name='Save new version').click();page.wait_for_timeout(150)
            versions_after_edit=page.evaluate('id=>window.AxiomArtifacts.store.versions(id)',doc_id)
            assert [v['version_number'] for v in versions_after_edit]==[0,1]
            immutable_prefix=[v['version_sha256'] for v in versions_after_edit]
            diff=page.evaluate('id=>window.AxiomArtifacts.store.diff(id,0,1)',doc_id)
            assert diff['change_count']>=2
            assert any(x['path'].startswith('/content') for x in diff['changes'])
            assert len(diff['diff_sha256'])==64
            page.get_by_role('button',name='Compute diff').click();page.wait_for_timeout(80)
            expect(page.locator('#artifact-diff-output')).to_contain_text('diff_sha256')

            cycle=page.evaluate("""async args=>{try{const s=window.AxiomArtifacts.store,row=await s.get('artifacts',args[0]);await s.edit(window.AxiomProjects,'local-user',args[0],{expectedVersion:row.current_version_number,dependencyArtifactIds:[args[1]],provenanceSource:'cycle-attempt'});return 'ALLOWED';}catch(e){return e.name;}}""",[doc_id,dashboard_id])
            assert cycle=='InvalidStateError',cycle
            assert len(page.evaluate('id=>window.AxiomArtifacts.store.versions(id)',doc_id))==2

            page.locator('#artifact-rollback-target').select_option('0')
            page.get_by_role('button',name='Rollback as new version').click();page.wait_for_timeout(160)
            rolled=page.evaluate('id=>window.AxiomArtifacts.store.get("artifacts",id)',doc_id)
            versions=page.evaluate('id=>window.AxiomArtifacts.store.versions(id)',doc_id)
            assert rolled['artifact_id']==doc_id and rolled['content']==document_content
            assert [v['version_number'] for v in versions]==[0,1,2]
            assert [v['version_sha256'] for v in versions[:2]]==immutable_prefix
            assert versions[2]['change_type']=='rollback' and versions[2]['rollback_of_version_id']==f'{doc_id}:v0'
            assert page.evaluate('args=>window.AxiomArtifacts.store.diff(args[0],args[1],args[2])',[doc_id,0,2])['change_count']==0

            bundle=page.evaluate('id=>window.AxiomArtifacts.store.exportBundle(id)',doc_id)
            assert bundle['integrity']['status']=='PASS'
            assert bundle['export_scope']=='MACHINE_READABLE_BROWSER_LOCAL_BUNDLE'
            assert len(bundle['versions'])==3 and len(bundle['comments'])==1 and len(bundle['bundle_sha256'])==64
            assert bundle['artifact']['cloud_collaboration_claimed'] is False
            assert bundle['artifact']['external_publication_claimed'] is False

            page.evaluate('()=>window.AxiomArtifacts.refresh()')
            page.locator(f'[data-artifact-id="{website_id}"]').click();page.wait_for_timeout(80)
            expect(page.locator('#artifact-preview')).to_contain_text('Static preview only')
            executed=page.evaluate('Boolean(window.__MUST_NOT_RUN__)');assert executed is False

            tamper=page.evaluate("""async args=>{const s=window.AxiomArtifacts.store,id=args[0],pid=args[1],original=await s.get('artifacts',id);const bad=structuredClone(original);bad.content={tampered:true};let tx=s.db.transaction('artifacts','readwrite');tx.objectStore('artifacts').put(bad);await new Promise((r,j)=>{tx.oncomplete=r;tx.onerror=()=>j(tx.error)});const failed=await s.verify(pid,id);tx=s.db.transaction('artifacts','readwrite');tx.objectStore('artifacts').put(original);await new Promise((r,j)=>{tx.oncomplete=r;tx.onerror=()=>j(tx.error)});const restored=await s.verify(pid,id);return {failed,restored};}""",[doc_id,project_id])
            assert tamper['failed']['status']=='FAIL' and f'current_snapshot:{doc_id}' in tamper['failed']['errors']
            assert tamper['restored']['status']=='PASS'

            page.reload(wait_until='networkidle');page.locator('#artifact-space').wait_for(state='visible')
            page.locator('#artifact-project').select_option(project_id);page.wait_for_timeout(130)
            persisted=page.evaluate('pid=>window.AxiomArtifacts.store.list(pid)',project_id)
            assert {x['artifact_id'] for x in persisted}==set(ids)
            persisted_doc=next(x for x in persisted if x['artifact_id']==doc_id)
            assert persisted_doc['current_version_number']==2 and persisted_doc['content']==document_content
            assert len(page.evaluate('id=>window.AxiomArtifacts.store.versions(id)',doc_id))==3
            final_integrity=page.evaluate('pid=>window.AxiomArtifacts.store.verify(pid)',project_id)
            assert final_integrity['status']=='PASS'
            assert page.evaluate('pid=>window.AxiomProjects.store.verifyEventChain(pid)',project_id) is True

            foreign=[u for u in requests if not u.startswith(origin+'/')]
            assert not foreign,foreign
            page.locator(f'[data-artifact-id="{doc_id}"]').click();page.wait_for_timeout(80)
            page.screenshot(path=str(ARTIFACT_DIR/'phase5-artifact-engine.png'),full_page=True)
            evidence={
                'schema':'musitu.axiom.interface.phase5-artifact-evidence.v1','status':'PASS','project_id':project_id,
                'artifact_ids':ids,'artifact_types':['document','sheet','presentation','website','dashboard'],
                'stable_identity_verified':True,'project_object_linkage_verified':True,'dependency_edge_verified':True,
                'version_numbers':[0,1,2],'immutable_history_preserved_across_rollback':True,
                'diff_verified':True,'rollback_mode':'NON_DESTRUCTIVE_NEW_VERSION_FROM_PRIOR_SNAPSHOT',
                'provenance_chain_verified':True,'permission_rejection_verified':True,'viewer_comment_verified':True,
                'current_state_tamper_detected':True,'cross_reload_persistence_verified':True,
                'export_scope':'MACHINE_READABLE_BROWSER_LOCAL_BUNDLE','website_preview_execution':'STATIC_DISPLAY_ONLY',
                'cloud_collaboration_claimed':False,'external_publication_claimed':False,'deployment_claimed':False,
                'foreign_requests':foreign,'artifact_integrity_sha256':final_integrity['integrity_sha256'],
            }
            (ARTIFACT_DIR/'phase5-artifact-evidence.json').write_text(json.dumps(evidence,indent=2,sort_keys=True)+'\n',encoding='utf-8')
            browser.close()
    finally:
        server.shutdown();server.server_close()
    print('MUSITU_AXIOM_INTERFACE_PHASE5_ARTIFACT_BROWSER_PASS')

if __name__=='__main__': main()
