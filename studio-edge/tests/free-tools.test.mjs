import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.mjs';
import {searchPublicSources} from '../research.mjs';

const SITE='https://evansmusitu.github.io';
const host='https://worker.example';
const req=(path,input,origin=SITE)=>new Request(host+path,{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify(input)});
const fakeFetch=async url=>{
 const value=String(url);
 if(value.startsWith('https://en.wikipedia.org/w/rest.php/'))return new Response(JSON.stringify({pages:[{title:'Quantum computing',key:'Quantum_computing',description:'Computing using quantum mechanics',excerpt:'Example description <span>text</span>'}]}),{status:200});
 if(value.startsWith('https://hn.algolia.com/'))return new Response(JSON.stringify({hits:[{title:'Quantum processor',objectID:'123456',story_text:'New quantum news'}]}),{status:200});
 throw new Error('Unexpected URL: '+value);
};
function makeEnv(image='/9j/'+ 'A'.repeat(2400)){
 const hits=[];
 const limit=label=>({limit:async({key})=>{hits.push([label,key]);return {success:true};}});
 const env={
  IMAGE_RATE:limit('image-visitor'), IMAGE_REGIONAL:limit('image-region'),
  VISITOR_RATE:limit('chat-visitor'), GLOBAL_RATE:limit('chat-region'),
  AI:{run:async(model,options)=>{hits.push([model,options]);return model.includes('flux')?{image}:{response:'The retrieved sources [1] suggest a practical overview of the topic; verify claims using the source URLs.'};}}
 };
 return {hits,env};
}
test('internet research retrieves genuine provider results with safe fixed domains',async()=>{
 const res=await searchPublicSources('quantum computing',fakeFetch);
 assert.equal(res.sources.length,2);
 assert.equal(res.sources[0].url,'https://en.wikipedia.org/wiki/Quantum_computing');
 assert.equal(res.sources[1].url,'https://news.ycombinator.com/item?id=123456');
 assert.match(res.scope,/NOT general web search/);
 assert.doesNotMatch(JSON.stringify(res.sources),/<span>/);
});
test('source lookup rejects invalid query, caps results and degrades gracefully',async()=>{
 await assert.rejects(searchPublicSources('a',fakeFetch));
 const out=await searchPublicSources('quantum computing',async(url)=>{
  if(String(url).includes('wikipedia.org'))throw Error('upstream outage');
  return fakeFetch(url);
 });
 assert.deepEqual(out.providers,['Hacker News']);
 assert.equal(out.sources.length,1);
});
test('image mode uses real bound image model after dedicated limits',async()=>{
 const {env,hits}=makeEnv();
 const res=await worker.fetch(req('/api/image',{prompt:'A futuristic smart city in a Zimbabwean landscape under the stars.'}),env);
 const body=await res.json();
 assert.equal(res.status,200);
 assert.equal(body.tool,'image');
 assert.equal(body.model,'@cf/black-forest-labs/flux-1-schnell');
 assert.match(body.image,/^data:image\/jpeg;base64,\/9j\//);
 assert.deepEqual(hits.slice(0,2).map(x=>x[0]),['image-visitor','image-region']);
 assert.equal(hits[2][1].steps,4);
});
test('invalid image prompt consumes no AI budget',async()=>{
 const {env,hits}=makeEnv();
 const r=await worker.fetch(req('/api/image',{prompt:'short'}),env);
 assert.equal(r.status,400);
 assert.deepEqual(hits,[]);
});
test('invalid image model response fails safely',async()=>{
 const {env}=makeEnv('broken');
 const res=await worker.fetch(req('/api/image',{prompt:'A futuristic city depicted as a luminous oil painting.'}),env);
 assert.equal(res.status,502);
 assert.equal((await res.json()).code,'IMAGE_RESULT_INVALID');
});
test('external origin cannot invoke image generation',async()=>{
 const {env,hits}=makeEnv();
 const r=await worker.fetch(req('/api/image',{prompt:'A colorful photorealistic landscape with mountain sunset.'},'https://external.example'),env);
 assert.equal(r.status,403);
 assert.equal(hits.length,0);
});
test('research mode injects bounded source evidence and returns clickable citations',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=fakeFetch;
 try{
  const {env,hits}=makeEnv();
  const r=await worker.fetch(req('/api/chat',{mode:'research',prompt:'Tell me what sources say about quantum computing and research.'}),env);
  assert.equal(r.status,200);
  const json=await r.json();
  assert.equal(json.liveSearch,true);
  assert.equal(json.sources.length,2);
  assert.match(json.reply,/retrieved sources/);
  assert.equal(hits.filter(x=>String(x[0]).startsWith('@cf/')).length,1);
  assert.match(hits.at(-1)[1].messages[0].content,/Quantum computing/);
 }finally{globalThis.fetch=original;}
});
test('research mode with empty results does not hallucinate a summary',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async url=>new Response(JSON.stringify(String(url).includes('wikipedia.org')?{pages:[]}:{hits:[]}),{status:200});
 try{
  const {env,hits}=makeEnv();
  const r=await worker.fetch(req('/api/chat',{mode:'research',prompt:'Research an impossible niche unverified fabricated topic.'}),env);
  assert.equal(r.status,200);
  const j=await r.json();
  assert.equal(j.sources.length,0);
  assert.equal(j.model,null);
  assert.equal(hits.filter(x=>String(x[0]).startsWith('@cf/')).length,0);
 }finally{globalThis.fetch=original;}
});
test('health transparently declares limited internet and free image generator',async()=>{
 const {env}=makeEnv();
 const r=await worker.fetch(new Request(host+'/api/health',{headers:{origin:SITE}}),env);
 assert.equal(r.status,200);
 const data=await r.json();
 assert.equal(data.curatedLiveSources,true);
 assert.equal(data.tools[1].path,'/api/image');
 assert.match(data.tools[2].scope,/Wikipedia/);
});
