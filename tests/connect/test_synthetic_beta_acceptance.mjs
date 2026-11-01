/**
 * Synthetic prospective customer-acceptance scenarios only.
 * Uses a test-only internal key and a mocked Axiom boundary; does not
 * represent real customer authentication, onboarding, or live qualification.
 */
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import worker from '../../connect/production_worker.mjs';

const INPUT = new URL('../../examples/connect/synthetic_beta_acceptance.json', import.meta.url);
const fixtures = JSON.parse(readFileSync(INPUT, 'utf8'));
const key = 'test-account-key-acceptance';
const internalAuth = 'Bearer ' + createHmac('sha256', key)
  .update('MUSITU-CONNECT-RUNTIME-INTERNAL-V1').digest('hex');
const env = {AXIOM_ACCOUNT_KEY:key,PRODUCTION:'false',RELEASE:'synthetic-acceptance-test'};
const jsonRequest = (path, body, auth=true) => new Request('https://synthetic.test' + path, {
  method:'POST',
  headers:{
    'content-type':'application/json',
    ...(auth ? {authorization:internalAuth} : {}),
  },
  body:JSON.stringify(body),
});

test('synthetic pilot fixture excludes credentials, real tenants, and methane predictions',()=>{
  assert.deepEqual(Object.keys(fixtures).sort(),
    ['invalid_benefit_plan','invalid_multi_record_risk','plan','risk']);
  const asText=JSON.stringify(fixtures);
  for(const secret of ['AXIOM_ACCOUNT_KEY','Bearer ','mct_','token_sha256','production_api_key',
                       'predict_methane','customer_id']){
    assert.equal(asText.includes(secret),false,secret);
  }
  assert.equal(fixtures.plan.rows.length,1);
  assert.equal(fixtures.risk.rows.length,1);
  assert.equal(fixtures.invalid_multi_record_risk.rows.length,2);
  assert.equal(fixtures.invalid_benefit_plan.rows[0].benefit>1,true);
});

test('synthetic client plan calculates exact one-row bounded selection',async()=>{
  const response=await worker.fetch(jsonRequest('/api/mining/plan',fixtures.plan),env);
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.gate,'LOCKED');
  assert.ok(Math.abs(body.baselineRisk-3.348)<1e-12);
  assert.equal(body.spend,18000);
  assert.ok(Math.abs(body.riskReduction-1.13832)<1e-12);
  assert.deepEqual(body.selected,['Synthetic ground instability']);
});

test('synthetic client risk executes one arithmetic operation with sanitized correlation',async()=>{
  const previousFetch=globalThis.fetch;
  let upstreamCalls=0;
  globalThis.fetch=async(url,init={})=>{
    upstreamCalls++;
    assert.equal(url,'https://axiom.mftintelligence.com/v1/compute');
    const requestId=init.headers['x-musitu-request-id'];
    assert.deepEqual(JSON.parse(init.body),{
      operation:'arithmetic.evaluate',args:{expression:'0.54*10*0.62'},
    });
    return Response.json({
      ok:true,request_id:requestId,
      result:{ok:true,result:'3.348'},
      private_account:'must-not-leak',
    });
  };
  try{
    const response=await worker.fetch(jsonRequest('/api/mining/risk',fixtures.risk),env);
    assert.equal(response.status,200);
    const body=await response.json();
    assert.equal(body.ok,true);
    assert.equal(body.operation,'arithmetic.evaluate');
    assert.equal(body.result,'3.348');
    assert.match(body.request_id,/^MUSITU-CONNECT-synthetic-pilot-001-[a-f0-9]{16}$/);
    assert.match(body.canonical_sha256,/^[a-f0-9]{64}$/);
    assert.equal('private_account' in body,false);
    assert.equal(upstreamCalls,1);
  }finally{globalThis.fetch=previousFetch;}
});

test('synthetic unauthenticated request and invalid plan are safely rejected',async()=>{
  const withoutAuth=await worker.fetch(jsonRequest('/api/mining/plan',fixtures.plan,false),env);
  assert.equal(withoutAuth.status,401);
  assert.deepEqual(await withoutAuth.json(),{ok:false,error:'UNAUTHORIZED'});
  const invalid=await worker.fetch(jsonRequest('/api/mining/plan',fixtures.invalid_benefit_plan),env);
  assert.equal(invalid.status,400);
  assert.deepEqual(await invalid.json(),{ok:false,error:'INVALID_REQUEST'});
});

test('synthetic risk rejects multiple records without performing Axiom calls',async()=>{
  const previousFetch=globalThis.fetch;
  let upstreamCalls=0;
  globalThis.fetch=async()=>{upstreamCalls++;throw Error('should not reach Axiom')};
  try{
    const response=await worker.fetch(jsonRequest('/api/mining/risk',
      fixtures.invalid_multi_record_risk),env);
    assert.equal(response.status,400);
    assert.deepEqual(await response.json(),{ok:false,error:'RISK_SINGLE_ROW_REQUIRED'});
    assert.equal(upstreamCalls,0);
  }finally{globalThis.fetch=previousFetch;}
});
