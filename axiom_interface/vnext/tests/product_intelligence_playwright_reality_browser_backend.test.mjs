import assert from 'node:assert/strict';
import test from 'node:test';
import {PLAYWRIGHT_REALITY_BROWSER_DESCRIPTOR,createPlaywrightRealityBrowserBackend} from '../product_intelligence/backends/playwright_reality_browser_backend.js';

function client(result={observed_at:'2026-10-04T18:05:00Z',final_url:'https://example.invalid/app',title:'AXIOM',dom_sha256:'b'.repeat(64),screenshot_sha256:'c'.repeat(64),console_errors:[],failed_requests:[],viewport:{width:1440,height:900}}){
  const calls=[];return {calls,async observe(input){calls.push(structuredClone(input));return structuredClone(result);},async health(){return {status:'UP'};}};
}
const req={projectId:'project_12345678',workId:'work_12345678',workloadIdentityId:'agent_workload_12345678',surfaceRef:'https://example.invalid/app',surfaceDigestSha256:'a'.repeat(64),requestId:'request_12345678',plan:{steps:[{op:'NAVIGATE'},{op:'WAIT'},{op:'SNAPSHOT'},{op:'SCREENSHOT'},{op:'READ_CONSOLE'}]},context:{environment:'isolated-dev'}};

test('Playwright RealityBrowserBackend pins Phase-1.5 baseline and remains observation-only',()=>{
  assert.equal(PLAYWRIGHT_REALITY_BROWSER_DESCRIPTOR.kind,'RealityBrowserBackend');
  assert.equal(PLAYWRIGHT_REALITY_BROWSER_DESCRIPTOR.provider,'playwright');
  assert.equal(PLAYWRIGHT_REALITY_BROWSER_DESCRIPTOR.provider_baseline,'1.63.0');
  assert.equal(PLAYWRIGHT_REALITY_BROWSER_DESCRIPTOR.semantic_owner,'AXIOM');
  assert.equal(PLAYWRIGHT_REALITY_BROWSER_DESCRIPTOR.authority,'MECHANISM_ONLY');
  assert.equal(PLAYWRIGHT_REALITY_BROWSER_DESCRIPTOR.external_write_authority,false);
  assert.equal(PLAYWRIGHT_REALITY_BROWSER_DESCRIPTOR.release_authority,false);
});

test('observe preserves expected surface digest and returns bounded observed reality without certification',async()=>{
  const c=client();const backend=createPlaywrightRealityBrowserBackend({client:c});const out=await backend.observe(req);
  assert.equal(out.expected_surface_digest_sha256,'a'.repeat(64));
  assert.equal(out.browser_version,'1.63.0');
  assert.equal(out.observation_state,'OBSERVED');
  assert.equal(out.final_url,'https://example.invalid/app');
  assert.equal(out.dom_sha256,'b'.repeat(64));
  assert.equal(out.screenshot_sha256,'c'.repeat(64));
  assert.deepEqual(out.console_errors,[]);
  assert.equal(out.certification,'NOT_CERTIFIED');
  assert.equal(out.external_action_executed,false);
  assert.equal(out.authority_effect,'NONE');
  assert.equal(c.calls[0].plan.steps[0].op,'NAVIGATE');
});

test('read-only plan rejects external mutation operations before provider invocation',async()=>{
  const forbidden=['CLICK_SUBMIT','FILL','UPLOAD','PAY','PUBLISH','DEPLOY','DELETE','NETWORK_WRITE'];
  for(const op of forbidden){
    const c=client();const backend=createPlaywrightRealityBrowserBackend({client:c});
    await assert.rejects(()=>backend.observe({...req,plan:{steps:[{op}]}}),/observation plan operation forbidden/);
    assert.equal(c.calls.length,0);
  }
});

test('provider authority-like claims and malformed observed hashes fail closed',async()=>{
  for(const key of ['release_authority','production_authority','certified','accessibility_pass','allow_deploy','external_write_executed']){
    const backend=createPlaywrightRealityBrowserBackend({client:client({observed_at:'2026-10-04T18:05:00Z',final_url:'https://example.invalid/app',title:'x',dom_sha256:'b'.repeat(64),screenshot_sha256:'c'.repeat(64),console_errors:[],failed_requests:[],viewport:{width:1440,height:900},[key]:true})});
    await assert.rejects(()=>backend.observe(req),/forbidden authority/);
  }
  const malformed=createPlaywrightRealityBrowserBackend({client:client({observed_at:'2026-10-04T18:05:00Z',final_url:'https://example.invalid/app',title:'x',dom_sha256:'bad',screenshot_sha256:'c'.repeat(64),console_errors:[],failed_requests:[],viewport:{width:1,height:1}})});
  await assert.rejects(()=>malformed.observe(req),/dom_sha256 required/);
});

test('credential-bearing context is rejected before browser provider invocation',async()=>{
  const c=client();const backend=createPlaywrightRealityBrowserBackend({client:c});
  await assert.rejects(()=>backend.observe({...req,context:{authorization:'Bearer secret'}}),/forbidden credential material/);
  assert.equal(c.calls.length,0);
});

test('Playwright health reports provider state only and cannot certify AXIOM',async()=>{
  const health=await createPlaywrightRealityBrowserBackend({client:client()}).health();
  assert.equal(health.provider_status,'UP');
  assert.equal(health.browser_version,'1.63.0');
  assert.equal(health.axiom_authority,'NONE');
  assert.equal(health.axiom_certification,'NOT_PROVEN');
  assert.equal(health.live_runtime_qualification,'NOT_PROVEN');
});
