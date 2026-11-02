from playwright.sync_api import expect
import json

def create_project_and_session(page,origin):
    page.goto(origin+'/index.html#/projects',wait_until='networkidle')
    page.wait_for_function('()=>Boolean(window.AxiomComputerBootstrap)')
    page.evaluate('()=>window.AxiomComputerBootstrap')
    page.locator('#project-create-form').wait_for(state='visible')
    page.locator('#project-name').fill('Phase 8 Computer Security Proof')
    page.locator('#project-goal').fill('Prove visible sandbox, approval, takeover, receipts, rollback and prompt-injection defenses')
    page.get_by_role('button',name='Create project').click();page.wait_for_timeout(120)
    project_id=page.locator('#project-select').input_value();assert project_id.startswith('prj_')
    page.goto(origin+'/index.html#/computer',wait_until='networkidle')
    page.locator('#computer-space').wait_for(state='visible');expect(page.get_by_role('link',name='Computer')).to_be_visible()
    page.locator('#computer-project').select_option(project_id);page.locator('#computer-fixture').select_option('safe')
    page.get_by_role('button',name='Start sandbox session').click();page.wait_for_timeout(180)
    session_id=page.evaluate('window.AxiomComputer.getCurrentSessionId()');assert session_id.startswith('computer_')
    row=page.evaluate('id=>window.AxiomComputer.store.get(id)',session_id)
    assert row['project_id']==project_id and row['status']=='ACTIVE'
    assert row['sandbox_mode']=='VISIBLE_LOCAL_SRCDOC_SANDBOX_NO_EXTERNAL_NETWORK'
    assert row['network_policy']=='DENY_BY_DEFAULT_NO_RUNTIME_FETCH' and row['hidden_privileged_browser_session'] is False
    frame=page.locator('#computer-frame');assert frame.get_attribute('src') is None and frame.get_attribute('sandbox')=='allow-same-origin'
    expect(page.locator('#computer-site')).to_contain_text('https://example.test/task');expect(page.locator('#computer-step')).to_contain_text('PAGE_OBSERVED')
    diagnostic=page.evaluate("""async id=>{const row=await window.AxiomComputer.store.get(id),preview=document.querySelector('#computer-action-form button[type="submit"]'),error=document.querySelector('#error-region');return {current_session_id:window.AxiomComputer.getCurrentSessionId(),status:row?.status||null,takeover:Boolean(row?.takeover),prompt_injection_quarantined:Boolean(row?.prompt_injection_quarantined),prompt_injection_flags:row?.prompt_injection_flags||[],preview_disabled:Boolean(preview?.disabled),computer_state:document.querySelector('#computer-state')?.textContent||'',site:document.querySelector('#computer-site')?.textContent||'',step:document.querySelector('#computer-step')?.textContent||'',error_hidden:Boolean(error?.hidden),error_text:error?.innerText||'',render_source:String(window.AxiomComputer.refresh).slice(0,700)};}""",session_id)
    print('MUSITU_AXIOM_PHASE8_ACTION_READINESS_DIAGNOSTIC '+json.dumps(diagnostic,sort_keys=True))
    return project_id,session_id
