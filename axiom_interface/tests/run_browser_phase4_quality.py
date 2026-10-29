from __future__ import annotations

from datetime import datetime, timedelta, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import threading

from playwright.sync_api import expect, sync_playwright

ROOT=Path(__file__).resolve().parents[1]
ARTIFACT_DIR=Path(os.environ.get('AXIOM_PHASE4_QUALITY_ARTIFACT_DIR','/tmp/axiom-interface-phase4-quality'))
ARTIFACT_DIR.mkdir(parents=True,exist_ok=True)
QUALITY_BOUNDARY='INTERNAL_HEURISTIC_NOT_EXTERNALLY_CALIBRATED'
SEARCH_MODE='EXPLICIT_GRAPH_STANCE_SEARCH_NOT_SEMANTIC_NLI'

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self,*_args): pass


def local_value(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M')


def fill_source(page,*,title,url,text,as_of,retrieved,primary,verifiable,authority,transparency,conflict):
    page.locator('#research-source-title').fill(title)
    page.locator('#research-source-url').fill(url)
    page.locator('#research-source-type').select_option('web')
    page.locator('#research-source-class').select_option('web')
    page.locator('#research-source-asof').fill(local_value(as_of))
    page.locator('#research-source-retrieved').fill(local_value(retrieved))
    page.locator('#research-source-text').fill(text)
    if primary: page.locator('#research-quality-primary').check()
    else: page.locator('#research-quality-primary').uncheck()
    if verifiable: page.locator('#research-quality-verifiable').check()
    else: page.locator('#research-quality-verifiable').uncheck()
    page.locator('#research-quality-authority').fill(str(authority))
    page.locator('#research-quality-transparency').fill(str(transparency))
    page.locator('#research-quality-conflict').fill(str(conflict))


def submit_source(page,**kwargs):
    fill_source(page,**kwargs)
    page.get_by_role('button',name='Add source').click()
    page.wait_for_timeout(120)


def bind(page,*,claim_id,source_id,stance,text,quote):
    start=text.index(quote)
    page.locator('#research-citation-claim').select_option(claim_id)
    page.locator('#research-citation-source').select_option(source_id)
    page.locator('#research-citation-stance').select_option(stance)
    page.locator('#research-citation-start').fill(str(start))
    page.locator('#research-citation-end').fill(str(start+len(quote)))
    page.locator('#research-citation-quote').fill(quote)
    page.get_by_role('button',name='Bind citation').click()
    page.wait_for_timeout(120)


def main():
    handler=lambda *args,**kwargs:QuietHandler(*args,directory=str(ROOT),**kwargs)
    server=ThreadingHTTPServer(('127.0.0.1',0),handler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    origin=f'http://127.0.0.1:{server.server_port}'
    try:
        with sync_playwright() as pw:
            browser=pw.chromium.launch(headless=True,executable_path=os.environ.get('AXIOM_CHROMIUM_EXECUTABLE') or shutil.which('chromium') or None)
            context=browser.new_context(viewport={'width':1280,'height':940},reduced_motion='reduce')
            page=context.new_page();requests=[];page.on('request',lambda r:requests.append(r.url))
            page.goto(origin+'/index.html#/projects',wait_until='networkidle')
            page.locator('#project-create-form').wait_for(state='visible')
            page.locator('#project-name').fill('Phase 4 Blueprint Completeness Proof')
            page.locator('#project-goal').fill('Prove bounded source quality and explicit contradiction search')
            page.locator('#project-memory').select_option('project-only')
            page.get_by_role('button',name='Create project').click()
            project_select=page.locator('#project-select');expect(project_select).not_to_have_value('')
            project_id=project_select.input_value();assert project_id.startswith('prj_')

            page.goto(origin+'/index.html#/research',wait_until='networkidle')
            page.locator('#research-space').wait_for(state='visible')
            page.locator('#research-quality-controls').wait_for(state='visible')
            page.locator('#research-project').select_option(project_id);page.wait_for_timeout(100)
            page.locator('#research-allow-domains').fill('example.com')
            now=datetime.now(timezone.utc).replace(second=0,microsecond=0)
            as_of=now-timedelta(minutes=2);retrieved=now-timedelta(minutes=1)

            # The HTML form blocks out-of-range quality metadata natively. Separately,
            # the store wrapper must fail closed for the same invalid metadata even
            # when called programmatically, before the underlying source store runs.
            authority_input=page.locator('#research-quality-authority')
            authority_input.fill('1.5')
            native=authority_input.evaluate("el => ({valid:el.checkValidity(), max:el.max})")
            assert native=={'valid':False,'max':'1'},native
            invalid=page.evaluate("""async () => {
              try {
                await window.AxiomResearch.store.addSource(null,null,{
                  qualityProfile:{
                    primary:false,
                    independently_verifiable:false,
                    recency:0.9,
                    domain_authority:1.5,
                    methodological_transparency:0.5,
                    conflict_of_interest_risk:0.5
                  }
                },null);
                return 'ALLOWED';
              } catch (error) {
                return error.name;
              }
            }""")
            assert invalid=='TypeError',invalid
            empty=page.evaluate('pid => window.AxiomResearch.store.snapshot(pid)',project_id)
            assert not empty['sources']

            support_text='Alpha revenue rose 10%. Risk remains high.'
            counter_text='Alpha revenue fell 2%. Accounting scope differs.'
            submit_source(page,title='Primary filing',url='https://example.com/primary',text=support_text,as_of=as_of,retrieved=retrieved,primary=True,verifiable=True,authority=.9,transparency=.8,conflict=.1)
            submit_source(page,title='Counter analysis',url='https://sub.example.com/counter',text=counter_text,as_of=as_of,retrieved=retrieved,primary=False,verifiable=True,authority=.6,transparency=.7,conflict=.2)
            snap=page.evaluate('pid => window.AxiomResearch.store.snapshot(pid)',project_id)
            assert len(snap['sources'])==2
            assert snap['source_quality_boundary']==QUALITY_BOUNDARY
            support=next(x for x in snap['sources'] if x['title']=='Primary filing')
            counter=next(x for x in snap['sources'] if x['title']=='Counter analysis')
            assert support['source_quality']['calibration_boundary']==QUALITY_BOUNDARY
            assert support['source_quality']['score']>counter['source_quality']['score']
            assert snap['integrity']['status']=='PASS',snap['integrity']

            page.locator('#research-claim-text').fill('Alpha revenue increased.')
            page.locator('#research-claim-uncertainty').fill('Counter-evidence uses a different accounting scope.')
            page.locator('#research-claim-confidence').fill('0.78')
            page.get_by_role('button',name='Add claim').click();page.wait_for_timeout(100)
            snap=page.evaluate('pid => window.AxiomResearch.store.snapshot(pid)',project_id)
            claim_id=snap['claims'][0]['claim_id']
            bind(page,claim_id=claim_id,source_id=support['source_id'],stance='supports',text=support_text,quote='Alpha revenue rose 10%.')
            bind(page,claim_id=claim_id,source_id=counter['source_id'],stance='contradicts',text=counter_text,quote='Alpha revenue fell 2%.')

            final=page.evaluate('pid => window.AxiomResearch.store.snapshot(pid)',project_id)
            claim=final['claims'][0]
            assert claim['verification_status']=='SUPPORTED'
            assert claim['source_quality']['calibration_boundary']==QUALITY_BOUNDARY
            assert claim['source_quality']['supporting'][0]['quality']['score']==support['source_quality']['score']
            assert claim['source_quality']['contradicting'][0]['quality']['score']==counter['source_quality']['score']
            assert final['integrity']['status']=='PASS',final['integrity']
            assert final['integrity']['source_quality_boundary']==QUALITY_BOUNDARY
            assert final['integrity']['contradiction_search_mode']==SEARCH_MODE

            search=page.evaluate('args => window.AxiomResearch.store.searchContradictions(args[0],args[1])',[project_id,claim_id])
            assert search['search_mode']==SEARCH_MODE
            assert search['result_count']==1
            assert search['results'][0]['quote']=='Alpha revenue fell 2%.'
            assert search['results'][0]['source_quality']['calibration_boundary']==QUALITY_BOUNDARY
            page.get_by_role('button',name='Search explicit contradictions').click();page.wait_for_timeout(100)
            expect(page.locator('#research-quality-boundary')).to_contain_text('not externally calibrated')
            expect(page.locator('#research-contradiction-results')).to_contain_text('Alpha revenue fell 2%.')
            expect(page.locator('#research-source-quality-list')).to_contain_text(claim_id)

            # A quality-score mutation must be caught by the extended verifier.
            tamper=page.evaluate("""async sid => {const s=window.AxiomResearch.store;const tx=s.db.transaction('sources','readwrite');const os=tx.objectStore('sources');const row=await new Promise((res,rej)=>{const r=os.get(sid);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});row.source_quality.score=0;os.put(row);await new Promise((res,rej)=>{tx.oncomplete=res;tx.onerror=()=>rej(tx.error);tx.onabort=()=>rej(tx.error)});return s.verify(row.project_id)}""",support['source_id'])
            assert tamper['status']=='FAIL'
            assert any(x.startswith('source_quality_score:') for x in tamper['errors'])

            foreign=[u for u in requests if not u.startswith(origin+'/')]
            assert not foreign,foreign
            page.screenshot(path=str(ARTIFACT_DIR/'research-quality-contradiction-search.png'),full_page=True)
            evidence={
                'schema':'musitu.axiom.interface.phase4-blueprint-completeness-evidence.v1','status':'PASS','project_id':project_id,'claim_id':claim_id,
                'source_quality_boundary':QUALITY_BOUNDARY,'source_quality_score_internal_only':True,'source_quality_external_calibration_claimed':False,
                'contradiction_search_mode':SEARCH_MODE,'semantic_nli_contradiction_detection_claimed':False,'explicit_contradiction_result_count':1,
                'quality_metadata_fail_closed_before_admission':True,'quality_tamper_detected':True,'claim_quality_projection_verified':True,
                'external_consequential_actions_executed':False,'foreign_requests':foreign
            }
            (ARTIFACT_DIR/'phase4-blueprint-completeness-evidence.json').write_text(json.dumps(evidence,indent=2,sort_keys=True)+'\n',encoding='utf-8')
            browser.close()
    finally:
        server.shutdown();server.server_close()
    print('MUSITU_AXIOM_INTERFACE_PHASE4_BLUEPRINT_COMPLETENESS_PASS')

if __name__=='__main__': main()
