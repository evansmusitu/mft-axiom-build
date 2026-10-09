import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {AxiomGlobalInferenceQuota,reserveQuotaDurable} from './durable_quota.mjs';
const key='c'.repeat(64);
function make(){
 const db=new DatabaseSync(':memory:');
 const sql={exec(query,...p){
   if(!p.length&&!/SELECT/i.test(query)){db.exec(query);return{one(){return undefined;}};}
   const st=db.prepare(query);
   if(/^SELECT/i.test(query.trim())){const arr=st.all(...p);return{one(){return arr[0]},toArray(){return arr}};}
   st.run(...p);return{one(){return undefined}};
 }};
 const ctx={storage:{sql,transactionSync(fn){db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}}};
 const obj=new AxiomGlobalInferenceQuota(ctx,{AXIOM_DO_INTERNAL_QUOTA_KEY:key});
 return {binding:{idFromName(v){assert.equal(v,'axiom-public-inference-global-v1');return v;},get(){return{fetch:(url,opts)=>obj.fetch(new Request(url,opts))};}},obj,db};
}
const payload=(n=1,subject='tenant1',provider='cloudflare',max_tokens=60)=>({nonce:n.toString(16).padStart(64,'0'),subject,project:'work1',provider,model:provider==='cloudflare'?'@cf/zai-org/glm-4.7-flash':'openai/gpt-oss-120b',max_tokens});
test('atomic durable admission and duplicate replay block',async()=>{
 const {binding}=make();
 const r=await reserveQuotaDurable(binding,key,payload());
 assert.equal(r.committed,true);
 await assert.rejects(()=>reserveQuotaDurable(binding,key,payload()),/REJECTED/);
});
test('per-minute fourth request denied with no paid fallback',async()=>{
 const {binding}=make();
 for(let i=1;i<=3;i++)await reserveQuotaDurable(binding,key,payload(i));
 await assert.rejects(()=>reserveQuotaDurable(binding,key,payload(4)),/REJECTED/);
});
test('missing/unsafe namespace and scopes fail closed',async()=>{
 const {binding,obj}=make();
 await assert.rejects(()=>reserveQuotaDurable(null,key,payload()),/BINDING/);
 await assert.rejects(()=>reserveQuotaDurable(binding,'weak',payload()),/SCOPE/);
 await assert.rejects(()=>reserveQuotaDurable(binding,key,{...payload(),subject:123}),/SCOPE/);
 const response=await obj.fetch(new Request('https://quota.internal/reserve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload())}));
 assert.equal(response.status,429);
});
test('global quota bound 3 even for different projects or users within minute',async()=>{
 const {binding}=make();
 for(let i=1;i<=3;i++)await reserveQuotaDurable(binding,key,payload(i,'user'+i));
 await assert.rejects(()=>reserveQuotaDurable(binding,key,payload(4,'user4')),/REJECTED/);
});
test('unknown provider and excessive token request denied without side effects',async()=>{
 const {binding,db}=make();
 await assert.rejects(()=>reserveQuotaDurable(binding,key,payload(1,'tenant1','other')),/SCOPE/);
 await assert.rejects(()=>reserveQuotaDurable(binding,key,payload(1,'tenant1','cloudflare',257)),/SCOPE/);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservations').get().n,0);
});
