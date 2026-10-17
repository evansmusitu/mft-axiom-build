"""Optional local-only Playwright Chromium smoke test. Does not access Meta or live customer data."""
import os,re,subprocess,signal,time,sys
from urllib import request,error
from urllib.parse import urlparse
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
root=Path(__file__).resolve().parent.parent
proc=subprocess.Popen(['node','scripts/launch-private-console.mjs'],cwd=root,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
try:
    lines=[]
    while True:
        line=proc.stdout.readline()
        if not line: raise RuntimeError('private stage exited unexpectedly')
        lines.append(line.strip())
        if line.startswith('eyJ'): token=line.strip();break
    url=next(x.split('Local-only dashboard: ')[1] for x in lines if x.startswith('Local-only dashboard: '))
    agent_token=next(x.split('ISOLATED_AGENT_B_TOKEN: ')[1] for x in lines if x.startswith('ISOLATED_AGENT_B_TOKEN: '))
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
        context=browser.new_context(viewport={'width':1280,'height':900})
        page=context.new_page()
        # Managed Chromium blocks all navigations. Use a real Chromium DOM with
        # locally injected source and a Python-backed loopback request bridge.
        opener=request.build_opener(request.ProxyHandler({}))
        def forward(source, path, options):
            if not path.startswith('/v1/tenants/'):
                raise ValueError('UNAUTHORIZED_BRIDGE_PATH')
            req=request.Request(url.split('/app')[0]+path,
                headers={k:v for k,v in options.get('headers',{}).items() if k.lower() in ['authorization','content-type']},
                data=(options.get('body') or '').encode('utf-8') if options.get('body') is not None else None,
                method=options.get('method','GET'))
            try:
                with opener.open(req,timeout=5) as reply:
                    return {'status':reply.status,'body':reply.read().decode('utf-8')}
            except error.HTTPError as e:
                return {'status':e.code,'body':e.read().decode('utf-8')}
        page.expose_binding('bridgeFetch',forward)
        errors=[]
        page.on('pageerror',lambda err:errors.append(str(err)))
        html=(root/'src/dashboard/index.html').read_text()
        html=re.sub(r'<link rel="stylesheet" href="/app.css">','',html)
        html=re.sub(r'<script type="module" src="/app.js"></script>','',html)
        page.set_content(html,wait_until='load')
        page.add_style_tag(content=(root/'src/dashboard/app.css').read_text())
        bridge="""window.fetch=async (path,options={})=>{
          const x=await window.bridgeFetch(path,{method:options.method||'GET',headers:options.headers||{},body:options.body});
          return new Response(x.body,{status:x.status,headers:{'content-type':'application/json'}})
        };"""
        page.add_script_tag(content=bridge)
        review=(root/'src/dashboard/review-actions.js').read_text().replace('export function createDraftReviewClient','function createDraftReviewClient')
        app=(root/'src/dashboard/app.js').read_text().replace("import {createDraftReviewClient} from '/review-actions.js';",'')
        page.add_script_tag(content=review+'\n'+app)
        assert page.get_by_text('MUSITU',exact=False).count()>0
        page.locator('#tenant').fill('tenant-A')
        page.locator('#token').fill(token)
        page.get_by_role('button',name='Connect securely').click()
        page.get_by_text('Connected to tenant-A').wait_for(timeout=10000)
        assert page.locator('#booking-count').inner_text()=='1'
        assert 'BOOKING_CREATED' in page.locator('#audit-list').inner_text(), 'private audit event not rendered'
        assert 'demo-agent-A' in page.locator('#staff-list').inner_text(), 'staff roster missing'
        assert 'ACTIVE' in page.locator('#staff-list').inner_text()
        assert page.get_by_role('button',name='Revoke access').count()==1
        page.get_by_role('button',name='Revoke access').click()
        page.get_by_text('Membership revoked',exact=False).wait_for(timeout=10000)
        assert 'demo-agent-A' in page.locator('#staff-list').inner_text()
        assert 'REVOKED' in page.locator('#staff-list').inner_text()
        assert page.get_by_role('button',name='Revoke access').count()==0
        assert 'MEMBER_REVOKED' in page.locator('#audit-list').inner_text()
        assert 'SUPPRESSED' in page.locator('#draft-list').inner_text(), 'previous draft not marked suppressed after STOP'
        assert 'OPTED OUT' in page.locator('#conversation-list').inner_text(), 'customer suppression not visible to owner'
        assert page.get_by_role('button',name='Approve offline').count()==0, 'SQLite demo incorrectly offered PostgreSQL-only feature'
        assert page.get_by_role('button',name='Stage offline').count()==0
        assert page.locator('#draft-action-status').inner_text().startswith('This stage database has no approval operations')
        assert page.get_by_role('button',name='Record opt-out').count()==1, 'only unsuppressed contact permits owner opt-out'
        page.get_by_role('button',name='Record opt-out').click()
        page.locator('#conversation-list').get_by_text('OPTED OUT',exact=False).first.wait_for(timeout=10000)
        page.wait_for_timeout(300)
        assert page.get_by_role('button',name='Record opt-out').count()==0, 'manual suppression remains actionable'
        page.get_by_role('button',name='Hand over').first.click()
        page.get_by_text('Connected to tenant-A').wait_for(timeout=10000)
        expect(page.locator('#human-count')).to_have_text('1',timeout=10000)
        page.get_by_role('button',name='Disconnect & clear').click()
        assert page.locator('#inquiries').inner_text()=='—'
        assert 'Connect to view drafts' in page.locator('#draft-list').inner_text()
        assert 'Connect to view audit' in page.locator('#audit-list').inner_text(), 'audit data not erased on disconnect'
        assert 'Connect to view staff' in page.locator('#staff-list').inner_text(), 'staff data not erased on disconnect'
        assert page.locator('#token').input_value()==''
        page.locator('#tenant').fill('tenant-B')
        page.locator('#token').fill(token)
        page.get_by_role('button',name='Connect securely').click()
        page.get_by_text('Access ended',exact=False).wait_for(timeout=10000)
        assert page.locator('#booking-count').inner_text()=='—', 'cross-tenant data visible'
        # Reconnect as the owner, then emulate a server-side revoked membership.
        page.locator('#tenant').fill('tenant-A')
        page.locator('#token').fill(token)
        page.get_by_role('button',name='Connect securely').click()
        page.get_by_text('Connected to tenant-A').wait_for(timeout=10000)
        assert page.locator('#booking-count').inner_text()=='1'
        page.evaluate("""() => {const previous=window.fetch;window._v16OriginalFetch=previous;
          window.fetch=(path,options)=>String(path).endsWith('/metrics')?
            Promise.resolve(new Response(JSON.stringify({error:'FORBIDDEN'}),{status:403})):
            previous(path,options);
        }""")
        page.evaluate('refresh().catch(()=>{})')
        page.get_by_text('Access ended',exact=False).wait_for(timeout=10000)
        assert page.locator('#booking-count').inner_text()=='—', 'revoked session retains business metrics'
        assert 'Connect to view drafts' in page.locator('#draft-list').inner_text()
        assert 'Connect to view staff' in page.locator('#staff-list').inner_text()
        assert page.locator('#disconnect-btn').is_disabled()
        # An AGENT may use operational dashboards but not OWNER-only staff or audit.
        # Optional 403s must not be mistaken for a revoked membership.
        page.evaluate('() => { window.fetch=window._v16OriginalFetch; return true; }')
        page.locator('#tenant').fill('tenant-B')
        page.locator('#token').fill(agent_token)
        page.get_by_role('button',name='Connect securely').click()
        page.get_by_text('Connected to tenant-B').wait_for(timeout=10000)
        assert 'Team access restricted or unavailable' in page.locator('#staff-list').inner_text()
        assert 'Action audit restricted or unavailable' in page.locator('#audit-list').inner_text()
        assert page.locator('#booking-count').inner_text()=='0'
        assert page.locator('#disconnect-btn').is_enabled(), 'valid agent unexpectedly disconnected by optional 403'
        assert not errors,errors
        print('BROWSER_SMOKE_PASS: Chromium login, revocation, metrics, drafts, handover, disconnect, cross-tenant 403')
        context.close();browser.close()
finally:
    proc.send_signal(signal.SIGTERM)
    try:proc.communicate(timeout=10)
    except subprocess.TimeoutExpired:proc.kill();proc.communicate()
