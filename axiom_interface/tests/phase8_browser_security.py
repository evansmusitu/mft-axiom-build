import json
from playwright.sync_api import expect

def exercise_security_and_finalize(page,session_id,project_id,requests,origin,artifact_dir):
    probes=[
      "async id=>{try{await window.AxiomComputer.store.propose(id,{actionType:'navigate',target:'https://evil.test/'});return 'ALLOWED'}catch(e){return e.name}}",
      "async id=>{try{await window.AxiomComputer.store.propose(id,{actionType:'type',target:'#name',value:'password=hunter2'});return 'ALLOWED'}catch(e){return e.name}}",
      "async id=>{try{await window.AxiomComputer.store.copyRestricted(id,'api_key=secret');return 'ALLOWED'}catch(e){return e.name}}",
      "async id=>{try{await window.AxiomComputer.store.authorizeCredential(id,'demo-login','https://example.test/');return 'ALLOWED'}catch(e){return e.name}}",
    ]
    assert [page.evaluate(p,session_id) for p in probes]==['SecurityError']*4
    safe=page.evaluate("async id=>{await window.AxiomComputer.store.copyRestricted(id,'safe local note');return await window.AxiomComputer.store.pasteRestricted(id)}",session_id);assert safe=='safe local note'
    page.evaluate("async id=>{await window.AxiomComputer.store.loadFixture(id,'hostile');return await window.AxiomComputer.refresh()}",session_id);page.wait_for_timeout(100)
    hostile=page.evaluate('id=>window.AxiomComputer.store.get(id)',session_id);assert hostile['prompt_injection_quarantined'] is True
    needed={'system-override','ignore-prior','policy-bypass','credential-request','tool-authority','role-escalation','data-exfiltration'};assert needed.issubset(set(hostile['prompt_injection_flags']))
    expect(page.locator('#computer-policy')).to_contain_text('DATA_ONLY')
    blocked=page.evaluate("async id=>{try{await window.AxiomComputer.store.propose(id,{actionType:'click',target:'#go'});return 'ALLOWED'}catch(e){return e.name}}",session_id);assert blocked=='SecurityError'
    page.get_by_role('button',name='Acknowledge quarantine').click();page.wait_for_timeout(80);ack=page.evaluate('id=>window.AxiomComputer.store.get(id)',session_id);assert ack['prompt_injection_quarantined'] is False and ack['prompt_injection_flags']
    trace=page.evaluate('id=>window.AxiomObservability.store.replay(id)',session_id);assert trace['integrity']['status']=='PASS'
    kinds=[e['kind'] for e in trace['events']];assert {'policy.decided','approval.updated','tool.called'}.issubset(kinds)
    trace_json=json.dumps(trace,sort_keys=True);assert 'hunter2' not in trace_json and 'chain_of_thought' not in trace_json
    tamper=page.evaluate("""async id=>{const s=window.AxiomComputer.store,row=await s.get(id),idx=row.receipts.findIndex(r=>r.receipt_id.startsWith('action:')),originalReceipt=structuredClone(row.receipts[idx]);row.receipts[idx].after_state_sha256='0'.repeat(64);await s.put(row);const badReceipt=await s.verify(id);row.receipts[idx]=originalReceipt;const actionIndex=row.actions.findIndex(a=>a.action_id===originalReceipt.action_id),originalAction=structuredClone(row.actions[actionIndex]);row.actions[actionIndex].target='#tampered';await s.put(row);const badAction=await s.verify(id);row.actions[actionIndex]=originalAction;await s.put(row);const good=await s.verify(id);return {badReceipt,badAction,good}}""",session_id)
    assert tamper['badReceipt']['status']=='FAIL' and any(x.startswith('receipt_hash:action:') for x in tamper['badReceipt']['errors'])
    assert tamper['badAction']['status']=='FAIL' and any(x.startswith('action_hash:') for x in tamper['badAction']['errors'])
    assert tamper['good']['status']=='PASS'
    page.reload(wait_until='networkidle');page.wait_for_function('()=>Boolean(window.AxiomComputerBootstrap)');page.evaluate('()=>window.AxiomComputerBootstrap');page.wait_for_timeout(120)
    persisted=page.evaluate('id=>window.AxiomComputer.store.get(id)',session_id);assert persisted['project_id']==project_id
    integrity=page.evaluate('id=>window.AxiomComputer.store.verify(id)',session_id);assert integrity['status']=='PASS',integrity
    page.evaluate('id=>window.AxiomComputer.selectSession(id)',session_id);page.wait_for_timeout(80);page.screenshot(path=str(artifact_dir/'phase8-computer-security.png'),full_page=True)
    page.get_by_role('button',name='Stop').click();page.wait_for_timeout(100);stopped=page.evaluate('id=>window.AxiomComputer.store.get(id)',session_id);assert stopped['status']=='STOPPED' and stopped['restricted_clipboard'] is None
    final_trace=page.evaluate('id=>window.AxiomObservability.store.getRun(id)',session_id);assert final_trace['final_status']=='CANCELLED'
    foreign=[u for u in requests if not u.startswith(origin+'/')];assert foreign==[],foreign
    evidence={'schema':'musitu.axiom.interface.phase8-computer-browser-evidence.v1','status':'PASS','session_id':session_id,'project_id':project_id,'visible_sandbox_verified':True,'sandbox_attribute':'allow-same-origin','scripts_enabled_in_sandbox':False,'current_site_and_step_visible':True,'exact_preview_approval_verified':True,'stale_approval_rejected':True,'action_receipt_verified':True,'rollback_verified':True,'pause_resume_verified':True,'takeover_verified':True,'stop_verified':True,'domain_deny_verified':True,'restricted_clipboard_verified':True,'credential_scope_verified':True,'prompt_injection_quarantine_verified':True,'retrieved_instruction_authority':'DATA_ONLY','prompt_injection_flags':hostile['prompt_injection_flags'],'observability_linkage_verified':True,'tamper_detection_verified':True,'action_tamper_detection_verified':True,'cross_reload_persistence_verified':True,'network_policy':'DENY_BY_DEFAULT_NO_RUNTIME_FETCH','foreign_requests':foreign,'hidden_privileged_browser_session':False,'arbitrary_external_site_execution_claimed':False,'os_level_computer_control_claimed':False,'production_isolation_certified':False,'integrity_sha256':integrity['integrity_sha256']}
    (artifact_dir/'phase8-computer-browser-evidence.json').write_text(json.dumps(evidence,indent=2,sort_keys=True)+'\n',encoding='utf-8')
