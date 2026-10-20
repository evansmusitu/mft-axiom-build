import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.mjs';
import { wikipediaSearch,generateImage,ExternalToolError } from '../vision-search.mjs';
import { kimiEnabled,invokeKimi,KimiIntegrationError } from '../kimi.mjs';

const ORIGIN='https://evansmusitu.github.io';
const BASE='https://musitu-edge.test';
function environment(overrides={}) {
  const called=[];
  const limit = name => ({limit:async()=>{called.push(name);return {success:true};}});
  const env={
    VISITOR_RATE:limit('visitor'),GLOBAL_RATE:limit('regional'),
    DEEP_RATE:limit('deep'),DEEP_REGIONAL:limit('deepregional'),
    TOOL_RATE:limit('tool'),TOOL_REGIONAL:limit('toolregional'),
    IMAGE_RATE:limit('image'),IMAGE_REGIONAL:limit('imageregional'),
    SEARCH_RATE:limit('search'),SEARCH_REGIONAL:limit('searchregional'),
    KIMI_RATE:limit('kimi'),KIMI_REGIONAL:limit('kimiregional'),
    AI:{run:async(model,payload)=>{called.push(model);return {image:'QUJD'.repeat(400),response:'An answer'}}},
    ...overrides
  };
  return {env,called};
}
function req(path,data,origin=ORIGIN) {
  return new Request(BASE+path,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(data)});
}
test('search strips untrusted HTML and returns source links with limited scope',async()=>{
 const result=await wikipediaSearch('Solar system',async url=>{
   const u=new URL(url);assert.equal(u.origin,'https://en.wikipedia.org');
   assert.equal(u.searchParams.get('q'),'Solar system');
   return new Response(JSON.stringify({pages:[{key:'Solar_System',title:'Solar System',excerpt:'<b>Solar</b> system',description:'Our &amp; nearby planets'}]}),{status:200});
 });
 assert.equal(result.results.length,1);
 assert.equal(result.results[0].excerpt,'Solar system');
 assert.equal(result.results[0].description,'Our & nearby planets');
 assert.equal(result.results[0].url,'https://en.wikipedia.org/wiki/Solar_System');
 assert.equal(result.generalWebSearch,false);
 assert.match(result.limitation,/not unrestricted/i);
});
test('search fails closed on timeout, bad JSON, invalid input',async()=>{
 await assert.rejects(()=>wikipediaSearch('a'),ExternalToolError);
 await assert.rejects(()=>wikipediaSearch('Astronomy',async()=>{throw Error('blocked');}),ExternalToolError);
 await assert.rejects(()=>wikipediaSearch('Astronomy',async()=>new Response('forbidden',{status:403})),ExternalToolError);
});
test('image uses FLUX model, four steps and validates base64 response',async()=>{
 const ai={run:async(model,args)=>{
   assert.equal(model,'@cf/black-forest-labs/flux-1-schnell');
   assert.equal(args.steps,4);
   assert.equal(args.prompt,'A luminous green valley under a full moon');
   return {image:'QUJD'.repeat(300)};
 }};
 const result=await generateImage('A luminous green valley under a full moon',ai);
 assert.match(result.dataURI,/^data:image\/jpeg;base64,QUJD/);
 assert.equal(result.tool,'image-generator');
 await assert.rejects(()=>generateImage('short',ai),ExternalToolError);
 await assert.rejects(()=>generateImage('A carefully described image scene', {run:async()=>({image:'invalid!image'})}),ExternalToolError);
});
test('image endpoint rejects invalid prompts before rate controls',async()=>{
 const {env,called}=environment();
 const r=await worker.fetch(req('/api/image',{prompt:'tiny'}),env);
 assert.equal(r.status,400);
 assert.deepEqual(called,[]);
});
test('image endpoint enforces dedicated native rate limits',async()=>{
 const {env,called}=environment();
 const response=await worker.fetch(req('/api/image',{prompt:'A spectacular sunrise on an icy mountain'}),env);
 assert.equal(response.status,200);
 const image=await response.json();
 assert.match(image.dataURI,/^data:image\/jpeg;base64,/);
 assert.deepEqual(called,['image','imageregional','@cf/black-forest-labs/flux-1-schnell']);
});
test('search endpoint enforces capacity before external calls',async()=>{
 const {env,called}=environment({SEARCH_RATE:{limit:async()=>({success:false})}});
 const response=await worker.fetch(req('/api/search',{query:'Solar System'}),env);
 assert.equal(response.status,429);
 assert.equal((await response.json()).code,'SEARCH_RATE_LIMIT');
 assert.deepEqual(called,[]);
});
test('prohibited origin cannot call image or search',async()=>{
 const {env,called}=environment();
 for(const path of ['/api/search','/api/image']){
   const response=await worker.fetch(req(path,{query:'Astronomy',prompt:'A beautiful forest rendered in watercolor'},'https://attacker.example'),env);
   assert.equal(response.status,403);
 }
 assert.deepEqual(called,[]);
});
test('health advertises real image generation, limited Wikipedia search and Kimi unavailable',async()=>{
 const {env}=environment();
 const response=await worker.fetch(new Request(BASE+'/api/health',{headers:{origin:ORIGIN}}),env);
 const data=await response.json();
 assert.equal(response.status,200);
 assert.equal(data.kimi.available,false);
 assert.equal(data.kimi.requiresAuthorizedBilling,true);
 assert.equal(data.tools.find(x=>x.id==='image-generator').path,'/api/image');
 assert.equal(data.tools.find(x=>x.id==='encyclopedia-search').generalWebSearch,false);
 assert.equal(data.liveSearch,false);
});
test('Kimi is explicitly disabled without both paid opt-in and private key',async()=>{
 const {env,called}=environment();
 const response=await worker.fetch(req('/api/chat',{mode:'kimi',prompt:'Explain how software search tools should be verified.'}),env);
 assert.equal(response.status,503);
 assert.equal((await response.json()).code,'KIMI_NOT_CONNECTED');
 assert.deepEqual(called,[]);
 assert.equal(kimiEnabled({KIMI_ENABLED:'true'}),false);
 assert.equal(kimiEnabled({KIMI_ENABLED:'false',KIMI_API_KEY:'a'.repeat(24)}),false);
});
test('Kimi request uses server-only key and a single explicitly approved provider call',async()=>{
 const secrets={KIMI_ENABLED:'true',KIMI_API_KEY:'s3cret_provider_token_1234567'};
 let calls=0;
 const data=await invokeKimi({prompt:'Explain secure model gateway access.',history:[],system:'Helpful system'},secrets,async(url,opts)=>{
   calls++;
   assert.equal(url,'https://api.moonshot.ai/v1/chat/completions');
   assert.match(opts.headers.authorization,/^Bearer s3cret/);
   const sent=JSON.parse(opts.body);
   assert.equal(sent.model,'kimi-k2.6');
   assert.equal(sent.messages.at(-1).content,'Explain secure model gateway access.');
   return new Response(JSON.stringify({choices:[{message:{content:'A verified Kimi test response.'}}]}),{status:200});
 });
 assert.equal(calls,1);
 assert.equal(data.reply,'A verified Kimi test response.');
 assert.equal(data.liveSearch,false);
});
test('Kimi provider faults fail without exposing private keys',async()=>{
 const env={KIMI_ENABLED:'true',KIMI_API_KEY:'s3cret_provider_token_1234567'};
 await assert.rejects(()=>invokeKimi({prompt:'Explain why secure APIs matter.',system:'helpful'},env,
 async()=>new Response('Provider token s3cret_provider_token_1234567',{status:401})),error=>{
    assert.ok(error instanceof KimiIntegrationError);
    assert.doesNotMatch(error.message,/s3cret/);
    return true;
 });
});
