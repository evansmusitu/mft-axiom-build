import test from 'node:test';
import assert from 'node:assert/strict';
import { createA2AHandler, buildAgentCard, makeProductionDependencies } from '../axiom_google_a2a_candidate.mjs';

const URL = 'https://isolated-google-a2a.example.test/a2a';
const call = (operation='arithmetic.evaluate', args={expression:'40+2'}, method='message/send') => ({
  jsonrpc:'2.0', id:'case-1', method, params:{message:{role:'user',parts:[{kind:'text',text:JSON.stringify({operation,args})}],messageId:'incoming-1'}}
});
const post = (payload, authorization='Bearer test-opaque', options={}) => new Request(URL,{
  method:'POST',headers:{'content-type':'application/json',...(authorization?{authorization}:{}),...options},
  body: JSON.stringify(payload)
});
const deps = (overrides={}) => ({
  enabled:true, baseUrl: URL, verify: async token => token==='test-opaque'?{sub:'user-123'}:null,
  execute:async ({tool,args,token}) => {assert.equal(tool,'axiom_arithmetic_evaluate'); assert.deepEqual(args,{expression:'40+2'}); assert.equal(token,'test-opaque');return {text:'42', evidence:'isolated fixture only'};},...overrides
});

test('publishes correct v0.3 agent card with a2a skill descriptions and no misleading trading capability',()=>{
  const card=buildAgentCard(URL);
  assert.equal(card.protocolVersion,'0.3.0');
  assert.equal(card.url,URL);
  assert.equal(card.capabilities.streaming,true);
  assert.deepEqual(card.skills.map(x=>x.id), ['arithmetic-evaluate','investment-npv']);
  assert.doesNotMatch(JSON.stringify(card),/execute trades|move funds|broker/i);
});

test('disabled gateway fails closed before calling verifier or execute',async()=>{
 let calls=0;
 const handler=createA2AHandler(deps({enabled:false,verify:async()=>{calls++;return {sub:'x'}},execute:async()=>{calls++;throw Error('should not run')}}));
 const response=await handler(post(call()));
 assert.equal(response.status,503);assert.equal(calls,0);
});

test('missing or invalid bearer token is rejected without calling executor',async()=>{
 let executions=0;
 const handler=createA2AHandler(deps({execute:async()=>{executions++;throw Error('should not run')}}));
 assert.equal((await handler(post(call(),null))).status,401);
 assert.equal((await handler(post(call(),'Bearer bogus'))).status,401);
 assert.equal(executions,0);
});

test('authenticated message/send invokes ONLY allowlisted MCP tool and returns A2A Message',async()=>{
 const handler=createA2AHandler(deps());
 const response=await handler(post(call()));const out=await response.json();
 assert.equal(response.status,200);assert.equal(out.id,'case-1');assert.equal(out.jsonrpc,'2.0');
 assert.equal(out.result.kind,'message');assert.equal(out.result.role,'agent');
 assert.equal(out.result.parts[0].kind,'text');assert.match(out.result.parts[0].text,/42/);
 assert.equal(out.result.metadata.operation,'arithmetic.evaluate');
 assert.notEqual(out.result.messageId,'incoming-1');
});

test('rejects commerce/unsupported tools and unknown argument fields fail closed',async()=>{
 let count=0;
 const handler=createA2AHandler(deps({execute:async()=>{count++;return {text:'unexpected'}}}));
 for (const body of [call('trade.execute',{amount:1}),call('arithmetic.evaluate',{expression:'40+2',secret:'s'}),call('finance.npv',{rate:0.12,cashflows:[]})]){
  const response=await handler(post(body));const obj=await response.json();
  assert.equal(obj.error.code,-32602);
 }
 assert.equal(count,0);
});

test('streams a v0.3 SSE JSON-RPC event for message/stream',async()=>{
 const handler=createA2AHandler(deps());
 const res=await handler(post(call('arithmetic.evaluate',{expression:'40+2'},'message/stream')));
 assert.equal(res.status,200);assert.match(res.headers.get('content-type'),/text\/event-stream/);
 const body=await res.text();assert.match(body,/^data: /);let event=JSON.parse(body.match(/^data: (.*)$/m)[1]);
 assert.equal(event.result.kind,'message');assert.equal(event.result.parts[0].text,'42');
});

test('malformed A2A request never triggers the executor',async()=>{
 let count=0;const handler=createA2AHandler(deps({execute:async()=>{count++}}));
 for(const payload of [[],{}, {...call(),method:'tasks/cancel'}, {...call(),params:{message:{role:'agent',parts:[{kind:'text',text:'{}'}],messageId:'id'}}}]){
  const res=await handler(post(payload));assert.notEqual(res.status,200);
 }
 assert.equal(count,0);
});

test('upstream failure is reported without exposing secrets',async()=>{
 const handler=createA2AHandler(deps({execute:async()=>{throw new Error('private-token-value')}}));
 const res=await handler(post(call()));const out=await res.text();
 assert.equal(res.status,502);assert.doesNotMatch(out,/private-token-value/);
});

test('live dependencies reject unconfigured URLs and production is disabled by default',async()=>{
 const d=makeProductionDependencies({}, fetch);assert.equal(d.enabled,false);
 await assert.rejects(()=>d.verify('secret'));
 await assert.rejects(()=>d.execute({tool:'axiom_arithmetic_evaluate',args:{expression:'40+2'},token:'secret'}));
});

test('production adapter uses only configured userinfo and MCP endpoints with user bearer',async()=>{
 const seen=[];
 const f=async (url,opts)=>{seen.push({url,opts});
  if(url==='https://auth-google.example.test/oauth/userinfo')return new Response(JSON.stringify({sub:'actor'}),{status:200,headers:{'content-type':'application/json'}});
  if(url==='https://mcp-google.example.test/mcp')return new Response(JSON.stringify({jsonrpc:'2.0',id:7,result:{content:[{type:'text',text:'42'}]}}),{status:200,headers:{'content-type':'application/json'}});
  throw Error('Unexpected URL');};
 const d=makeProductionDependencies({AXIOM_GOOGLE_A2A_ENABLED:'true',AXIOM_GOOGLE_A2A_URL:URL,AXIOM_GOOGLE_USERINFO_URL:'https://auth-google.example.test/oauth/userinfo',AXIOM_GOOGLE_MCP_URL:'https://mcp-google.example.test/mcp'},f);
 assert.equal(d.enabled,true);assert.equal((await d.verify('secret')).sub,'actor');
 assert.equal((await d.execute({tool:'axiom_arithmetic_evaluate',args:{expression:'40+2'},token:'secret'})).text,'42');
 assert.equal(seen.length,2);assert.ok(seen.every(x=>x.opts.headers.authorization==='Bearer secret'));
});
