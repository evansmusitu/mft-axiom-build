from playwright.sync_api import expect

def exercise_action_controls(page,session_id):
    page.locator('#computer-action-type').select_option('type');page.locator('#computer-action-target').fill('#name');page.locator('#computer-action-value').fill('Ada')
    page.get_by_role('button',name='Preview action').click();page.wait_for_timeout(100)
    action=page.evaluate('id=>(window.AxiomComputer.store.get(id)).then(r=>r.actions.at(-1))',session_id)
    assert action['status']=='PROPOSED' and len(action['action_sha256'])==64
    assert page.get_by_role('button',name='Execute approved action').is_disabled()
    stale=page.evaluate("""async ({sid,aid})=>{try{await window.AxiomComputer.store.approve(sid,aid,'0'.repeat(64),'local-user');return 'ALLOWED'}catch(e){return e.name}}""",{'sid':session_id,'aid':action['action_id']})
    assert stale=='SecurityError'
    page.get_by_role('button',name='Approve exact preview').click();page.wait_for_timeout(100);assert page.get_by_role('button',name='Execute approved action').is_enabled()
    page.get_by_role('button',name='Execute approved action').click();page.wait_for_timeout(150)
    expect(page.locator('#computer-receipts')).to_contain_text('approval:');expect(page.locator('#computer-receipts')).to_contain_text('action:')
    frame_input=page.frame_locator('#computer-frame').locator('#name');expect(frame_input).to_have_value('Ada')
    page.get_by_role('button',name='Rollback last action').click();page.wait_for_timeout(120);expect(frame_input).to_have_value('');expect(page.locator('#computer-receipts')).to_contain_text('rollback:')
    page.get_by_role('button',name='Pause').click();page.wait_for_timeout(60);assert page.evaluate('id=>window.AxiomComputer.store.get(id)',session_id)['status']=='PAUSED'
    page.locator('#computer-resume').click();page.wait_for_timeout(60);page.get_by_role('button',name='Take over').click();page.wait_for_timeout(60)
    takeover=page.evaluate('id=>window.AxiomComputer.store.get(id)',session_id);assert takeover['takeover'] is True and takeover['status']=='PAUSED'
    blocked=page.evaluate("""async id=>{try{await window.AxiomComputer.store.propose(id,{actionType:'click',target:'#commit'});return 'ALLOWED'}catch(e){return e.name}}""",session_id);assert blocked=='InvalidStateError'
    page.get_by_role('button',name='Release takeover').click();page.wait_for_timeout(60)
    return True
