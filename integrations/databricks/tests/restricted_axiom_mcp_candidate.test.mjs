import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
  ALLOWED_TOOL_NAMES, authorizeAndValidate, executeApprovedCall,
} from '../restricted_axiom_mcp_candidate.mjs';

const TOKEN = 'A'.repeat(48);
async function expectedDigest() {
  const encoded = new TextEncoder().encode(TOKEN);
  const hashed = await webcrypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hashed), x => x.toString(16).padStart(2, '0')).join('');
}
const req = (name, args) => ({
  jsonrpc: '2.0', id: 1, method: 'tools/call',
  params: {name, arguments: {args}},
});

test('allowlist exactly three explicit tools and never generic execute', () => {
  assert.deepEqual([...ALLOWED_TOOL_NAMES].sort(),
    ['historical_var', 'investment_npv', 'option_black_scholes'].sort());
});

test('a distinct strong bearer token is required', async () => {
  const digest = await expectedDigest();
  const good = req('investment_npv', {rate: .1,cashflows:[-100,60,60]});
  await assert.rejects(authorizeAndValidate(good, '', digest), /unauthorized/);
  await assert.rejects(authorizeAndValidate(good, 'Bearer invalid', digest), /unauthorized/);
  await assert.rejects(authorizeAndValidate(good, 'Bearer ' + 'B'.repeat(48), digest), /unauthorized/);
  const output = await authorizeAndValidate(good, 'Bearer ' + TOKEN, digest);
  assert.equal(output.name, 'investment_npv');
});

test('unapproved Axiom generic execute and billing are rejected even with a valid token', async () => {
  const digest = await expectedDigest();
  for (const name of ['musitu_axiom_execute','musitu_axiom_start_checkout','BUY','search','arbitrary']) {
    await assert.rejects(authorizeAndValidate(req(name,{rate:.1,cashflows:[-1,2]}),
      'Bearer ' + TOKEN,digest), /denied/);
  }
});

test('strict native argument contract prevents injected operation selectors', async () => {
  const digest = await expectedDigest();
  const auth = 'Bearer ' + TOKEN;
  for (const args of [
    {rate:.1,cashflows:[-100,60,60],operation:'finance.npv'},
    {rate:Infinity,cashflows:[-100,60]},
    {rate:.1,cashflows:[1]},
    {rate:.1,cashflows:[true, 6]},
    {rate:NaN,cashflows:[-100,60]},
  ]) {
    await assert.rejects(authorizeAndValidate(req('investment_npv',args),auth,digest), /invalid/);
  }
  await assert.rejects(authorizeAndValidate({
    ...req('investment_npv',{rate:.1,cashflows:[-100,60]}),
    method:'notifications/initialized',
  },auth,digest), /denied/);
});

test('option and VaR argument policy rejects unsafe shapes', async () => {
  const digest=await expectedDigest();
  const auth='Bearer '+TOKEN;
  const validOption={S:100,K:100,T:1,r:.05,sigma:.2,kind:'call'};
  assert.equal((await authorizeAndValidate(req('option_black_scholes',validOption),auth,digest)).name,'option_black_scholes');
  await assert.rejects(authorizeAndValidate(req('option_black_scholes',
    {...validOption,option_type:'put'}),auth,digest),/invalid/);
  await assert.rejects(authorizeAndValidate(req('historical_var',
    {returns:[.01,-.02],alpha:1}),auth,digest),/invalid/);
  assert.equal((await authorizeAndValidate(req('historical_var',
    {returns:[.01,-.02,.03,-.01,0],alpha:.95}),auth,digest)).name,'historical_var');
});

test('executor receives exactly one approved operation after authorization', async () => {
  const digest=await expectedDigest();
  const seen=[];
  const executor=async (name,args)=>{ seen.push({name,args});return {ok:true}; };
  const out=await executeApprovedCall(
    req('investment_npv',{rate:.1,cashflows:[-100,60,60]}),
    'Bearer '+TOKEN,digest,executor,
  );
  assert.deepEqual(out,{ok:true});
  assert.equal(seen.length,1);
  assert.equal(seen[0].name,'investment_npv');
  await assert.rejects(executeApprovedCall(req('musitu_axiom_execute',
    {operation:'finance.npv'}),'Bearer '+TOKEN,digest,executor),/denied/);
  assert.equal(seen.length,1);
});
