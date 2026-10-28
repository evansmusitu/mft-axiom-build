import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import gateway from '../musitu_axiom_plugin_gate_v4.mjs';
import {validateComputationCall} from '../plugin_contract_runtime.mjs';
globalThis.crypto ??= webcrypto;
const registry=JSON.parse(readFileSync(new URL('./fixtures/public-registry-before-2.0.5.json',import.meta.url))).result.tools;
const originalTools=registry.map(t=>t.name==='ewma_smoothing'?{...t,name:'ewma_forecast'}:t);
const examples=JSON.parse(readFileSync(new URL('./fixtures/operation-examples.json',import.meta.url)));
test('all 74 operation examples validate through focused and generic tools',()=>{
 assert.equal(Object.keys(examples).length,74);
 for(const [operation,args] of Object.entries(examples)){
  const focused=registry.find(t=>t._meta?.['musitu/operation']===operation).name;
  assert.deepEqual(validateComputationCall(focused,{args}).issues,[],operation);
  assert.deepEqual(validateComputationCall('musitu_axiom_execute',{operation,args}).issues,[],operation);
 }
});
function harness(calculation={ok:true,operation:'arithmetic.evaluate',result:'42',verified:null,elapsed_ms:12,axiom:{plan:'developer',compute_units:2,usage:{used:4,limit:1000,month:'2026-10'}}}){
  let calls=[];
  const env={AXIOM_DB:{prepare:()=>({bind:()=>({first:async()=>({customer_id:'synthetic',issuer:'https://auth.mftintelligence.com',resource:'https://mcp.mftintelligence.com',scope:'axiom.execute',expires_at:'2099-01-01',key_status:'active'})})})},MCP_CORE:{fetch:async r=>{
    const m=await r.json();
    if(m.method==='tools/list')return Response.json({jsonrpc:'2.0',id:m.id,result:{tools:originalTools}});
    calls.push(m);
    return Response.json({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:'MUSITU Axiom completed arithmetic.evaluate.'}],structuredContent:{operation:calculation.operation,request_id:'private-id',result:calculation}}});
  }}};
  return {calls,request:async(method,params={},auth=true,modern=false)=>{
    const headers={'content-type':'application/json'};if(auth)headers.authorization='Bearer synthetic-test-token';if(modern)headers['mcp-protocol-version']='2026-07-28';
    const r=await gateway.fetch(new Request('https://mcp.mftintelligence.com/mcp',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:7,method,params})}),env);
    assert.equal(r.status,200);return r.json();
  }};
}
test('all 105 computation tools expose operation-specific argument fields',async()=>{
 const h=harness(),r=await h.request('tools/list');assert.equal(r.result.tools.length,108);
 for(const t of r.result.tools.filter(t=>t.name!=='search'&&t.name!=='fetch'&&t.name!=='musitu_axiom_capabilities')){
  assert.equal(t.inputSchema.properties.args.type,'object',t.name);
  assert.ok(Object.keys(t.inputSchema.properties.args.properties||{}).length||t.inputSchema.oneOf?.length,t.name);
 }
 const sma=r.result.tools.find(t=>t.name==='moving_average');assert.deepEqual(sma.inputSchema.properties.args.required,['data','window']);
 const npv=r.result.tools.find(t=>t.name==='investment_npv');assert.ok(npv.inputSchema.properties.args.properties.cashflows);
});
test('invalid fields produce useful errors without reaching metered computation',async()=>{
 const h=harness();
 for(const [name,args,path] of [['moving_average',{series:[1,2,3],window:2},'data'],['investment_npv',{cash_flows:[-100,60,60],rate:.1},'cashflows'],['moving_average',{data:[1,2,3],window:4},'window'],['axiom_probability_normal_cdf',{x:1,sigma:-1},'sigma']]){
  const r=await h.request('tools/call',{name,arguments:{args}});assert.equal(r.result.isError,true);assert.equal(r.result.structuredContent.error.code,'invalid_arguments');assert.match(JSON.stringify(r.result),new RegExp(path));
 }
 assert.equal(h.calls.length,0);
});
test('valid calculations and legacy EWMA name still reach core unchanged',async()=>{
 const h=harness();for(const name of ['moving_average','ewma_smoothing','ewma_forecast']){
  const args=name==='moving_average'?{data:[1,2,3],window:2}:{data:[1,2,3],alpha:.5};
  const r=await h.request('tools/call',{name,arguments:{args}});assert.notEqual(r.result.isError,true);assert.deepEqual(h.calls.at(-1).params.arguments.args,args);
 }assert.equal(h.calls[1].params.name,'ewma_forecast');assert.equal(h.calls[2].params.name,'ewma_forecast');
});
test('generic executor and verification validate the selected operation',async()=>{
 const h=harness();
 for(const [name,args] of [['musitu_axiom_execute',{operation:'finance.npv',args:{cash_flows:[],rate:.1}}],['verify_calculation',{args:{operation:'finance.npv',args:{cash_flows:[],rate:.1}}}]]){
  const r=await h.request('tools/call',{name,arguments:args});assert.equal(r.result.isError,true);assert.match(JSON.stringify(r.result),/cashflows/);
 }assert.equal(h.calls.length,0);
 const r=await h.request('tools/call',{name:'verify_calculation',arguments:{args:{operation:'arithmetic.evaluate',args:{expression:'40+2'}}}});assert.notEqual(r.result.isError,true);
});
test('calculation envelopes omit plan, usage, and timing while preserving mathematical fields',async()=>{
 const result={ok:true,operation:'arithmetic.evaluate',result:{plan:'a legitimate calculation field',usage:3,elapsed_ms:9,verified:false},verified:null,kernel_version:'1.0.0',elapsed_ms:12,axiom:{plan:'developer',compute_units:2,usage:{used:4,limit:1000}}};
 const r=await harness(result).request('tools/call',{name:'axiom_arithmetic_evaluate',arguments:{args:{expression:'40+2'}}});
 const out=r.result.structuredContent.result;assert.equal(out.axiom,undefined);assert.equal(out.elapsed_ms,undefined);assert.equal(out.kernel_version,undefined);assert.deepEqual(out.result,result.result);assert.equal(r.result.structuredContent.request_id,undefined);
});
test('division by zero is an explained tool error, not successful zoo',async()=>{
 const r=await harness({ok:true,operation:'arithmetic.evaluate',result:'zoo',verified:null}).request('tools/call',{name:'axiom_arithmetic_evaluate',arguments:{args:{expression:'1/0'}}});
 assert.equal(r.result.isError,true);assert.equal(r.result.structuredContent.result.ok,false);assert.equal(r.result.structuredContent.result.error.code,'undefined_result');assert.match(r.result.content[0].text,/division by zero/i);
});
test('undefined symbolic subexpressions and matrices are rejected',async()=>{
 for(const value of ['x + zoo','zoo*x','Matrix([[zoo, 0], [0, 1]])','nan']){
  const r=await harness({ok:true,operation:'arithmetic.evaluate',result:value,verified:null}).request('tools/call',{name:'axiom_arithmetic_evaluate',arguments:{args:{expression:'x+1/0'}}});assert.equal(r.result.isError,true);assert.equal(r.result.structuredContent.result.result,null);
 }
});
test('crosschecked infinite limits and interval enclosures retain valid mathematical results',async()=>{
 const value={result:'oo',verification:{verified:null,method:'not-applicable'}};
 const r=await harness({ok:true,operation:'verify.crosscheck',result:value,verified:null}).request('tools/call',{name:'verify_calculation',arguments:{args:{operation:'calculus.limit',args:{expression:'x',to:'oo'}}}});assert.notEqual(r.result.isError,true);assert.deepEqual(r.result.structuredContent.result.result,value);assert.equal(r.result.structuredContent.result.result_kind,'extended_real');
 const interval={interval:'[-inf,+inf]',engine:'mpmath.iv',note:'interval enclosure'};
 const i=await harness({ok:true,operation:'verified.interval_eval',result:interval,verified:null}).request('tools/call',{name:'axiom_verified_interval_eval',arguments:{args:{expression:'x**2','interval':[-1e300,1e300]}}});assert.notEqual(i.result.isError,true);assert.deepEqual(i.result.structuredContent.result.result,interval);
});
test('valid boundary shapes continue to reach computation',async()=>{
 const h=harness();
 for(const [name,args] of [['axiom_linear_solve',{A:[[2,0],[0,4]],b:[[4,8],[8,16]]}],['least_squares',{A:[[1,0],[0,1],[1,1]],b:[[1,2],[2,4],[3,6]]}],['linear_optimization',{c:[1],bounds:null}],['axiom_statistics_ttest_ind',{x:[1],y:[2,3,4],equal_var:true}],['axiom_numeric_optimize_scalar',{expression:'x**2',a:1,b:1}],['axiom_numeric_integrate',{expression:'x',a:0,b:1,epsabs:0}]]){
  const before=h.calls.length,r=await h.request('tools/call',{name,arguments:{args}});assert.notEqual(r.result.isError,true,name);assert.equal(h.calls.length,before+1,name);
 }
});
test('bad complex bins and impossible implied-volatility prices identify input fields',async()=>{
 const h=harness();
 for(const [name,args,path] of [['axiom_transforms_ifft',{data:['not-a-complex-number','1']},'data[0]'],['axiom_transforms_ifft',{data:['1e999j','1']},'data[0]'],['implied_volatility',{price:200,S:100,K:100,T:1,r:0},'price']]){
  const r=await h.request('tools/call',{name,arguments:{args}});assert.equal(r.result.isError,true);assert.ok(r.result.structuredContent.error.issues.some(i=>i.path===`args.${path}`));
 }assert.equal(h.calls.length,0);
 for(const data of [['1+2j','1'],['j','-j'],['(1e-3+2J)','1_000j']])assert.deepEqual(validateComputationCall('axiom_transforms_ifft',{args:{data}}).issues,[]);
});
test('ragged matrix right-hand sides identify b before computation',async()=>{
 const h=harness();for(const name of ['axiom_linear_solve','least_squares']){
  const r=await h.request('tools/call',{name,arguments:{args:{A:[[2,0],[0,4]],b:[[4,8],[8]]}}});assert.equal(r.result.isError,true);assert.ok(r.result.structuredContent.error.issues.some(i=>i.path==='args.b'));
 }assert.equal(h.calls.length,0);
});
test('valid complex symbolic and extended-real limits retain their meaning',async()=>{
 for(const [op,value,args] of [['arithmetic.evaluate','1.0*I',{expression:'sqrt(-1)'}],['calculus.limit','oo',{expression:'x',to:'oo'}]]){
  const name=registry.find(t=>t._meta?.['musitu/operation']===op).name;
  const r=await harness({ok:true,operation:op,result:value,verified:null}).request('tools/call',{name,arguments:{args}});assert.notEqual(r.result.isError,true);assert.equal(r.result.structuredContent.result.result,value);
  if(value==='oo')assert.equal(r.result.structuredContent.result.result_kind,'extended_real');
 }
});
test('ordinary symbolic identifiers are not mistaken for undefined numbers',async()=>{
 for(const value of ['ZOO*(x + 1)','NAN*(x + 1)','NaN*(x + 1)','infinite_value + zoo_count']){
  const r=await harness({ok:true,operation:'algebra.factor',result:value,verified:null}).request('tools/call',{name:'axiom_algebra_factor',arguments:{args:{expression:'ZOO*x+ZOO'}}});assert.notEqual(r.result.isError,true);assert.equal(r.result.structuredContent.result.result,value);
 }
});
test('authentication and modern protocol survive validation changes',async()=>{
 const h=harness(),r=await h.request('tools/call',{name:'moving_average',arguments:{args:{series:[]}}},false,true);assert.equal(r.result.isError,true);assert.equal(r.result.structuredContent.authenticated,false);assert.ok(r.result._meta['mcp/www_authenticate']);assert.equal(r.result.resultType,'complete');assert.equal(h.calls.length,0);
 const list=await h.request('tools/list',{},false,true),t=list.result.tools.find(t=>t.name==='moving_average'),fetch=await h.request('tools/call',{name:'fetch',arguments:{id:'tool:moving_average'}},false);assert.deepEqual(fetch.result.structuredContent.resource.inputSchema,t.inputSchema);assert.ok(list.result._meta['io.modelcontextprotocol/serverInfo']);
});
