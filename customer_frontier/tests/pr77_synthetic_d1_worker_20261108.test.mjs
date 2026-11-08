import test from 'node:test';
import assert from 'node:assert/strict';
import {handle} from '../qualification/pr77_synthetic_d1_worker_20261108.mjs';
const run='axiom-pr77-synthetic-20261108-01',token='f'.repeat(64);
const fx={plan_sha256:'6946e796539e6787033e20f1d0afdcb5259a130ca77be6e3c5afb60b5dc9888a',seed:Array(41).fill('CREATE TABLE synthetic(x INT)'),plan:Array(89).fill('SELECT 1')};
function env(db){return {DB:db,TOKEN:token,RUN:run,EXPIRES:String(Date.now()+120000),EPOCH:'synthetic'};}
function req(path,{method='GET',auth=true,origin=false,cookie=false}={}){
 const headers={...(auth?{authorization:'Bearer '+token}:{}),...(origin?{origin:'https://evil.invalid'}:{}),...(cookie?{cookie:'s=bad'}:{})};
 return new Request('https://synthetic-only.invalid'+path,{method,headers});
}
const db=(onBatch=async x=>x.map(()=>({success:true})),onQuery=()=>({results:[]}))=>({
 prepare(sql){return {query:sql,async all(){return onQuery(sql)},async first(){return {n:0}}}},
 async batch(statements){return onBatch(statements)}
});
test('unauthorized and browser-origin requests cannot reach D1',async()=>{
 let count=0;const d=db(async x=>{count++;return x});
 for(const request of [req('/seed',{method:'POST',auth:false}),req('/seed',{method:'POST',origin:true}),req('/seed',{method:'POST',cookie:true})]){
   const r=await handle(request,env(d),fx);assert([401,403].includes(r.status));
 }
 assert.equal(count,0);
});
test('exact 41 statement seed is allowed only for empty synthetic DB',async()=>{
 let n=0;const d=db(async arr=>{n++;assert.equal(arr.length,41);return []});
 let r=await handle(req('/seed',{method:'POST'}),env(d),fx);
 assert.equal(r.status,200);assert.equal((await r.json()).status,'SYNTHETIC_SEED_BATCH_ACCEPTED');assert.equal(n,1);
 const nonempty=db(async()=>{throw Error('should not write')},()=>({results:[{name:'foreign',type:'table'}]}));
 r=await handle(req('/seed',{method:'POST'}),env(nonempty),fx);assert.equal(r.status,503);
});
test('bounded batch uses exact PR77 prefix 46 plus two deliberate failure statements',async()=>{
 const d=db(async arr=>{assert.equal(arr.length,48);assert(arr.at(-2).query.includes('axiom_pr77_abort_probe'));assert(arr.at(-1).query.includes('VALUES(0)'));throw Error('D1_ERROR: CHECK constraint failed: axiom_pr77_expected_abort')});
 const r=await handle(req('/bounded-rollback',{method:'POST'}),env(d),fx);
 const x=await r.json();assert.equal(x.status,'PR77_PREFIX_INTENTIONAL_CHECK_ABORT');assert.equal(x.total_batched_statements,48);assert.equal(x.release_authority,false);
});
test('unrecognized bounded D1 error must not be called successful rollback',async()=>{
 const d=db(async()=>{throw Error('Connection reset')});
 const r=await handle(req('/bounded-rollback',{method:'POST'}),env(d),fx);
 assert.equal((await r.json()).status,'PR77_PREFIX_NOT_QUALIFIED');
});
test('full 89 statement free tier limit cannot claim successful qualification',async()=>{
 const d=db(async arr=>{assert.equal(arr.length,89);throw Error('Too many D1 subrequests per invocation')});
 const x=await (await handle(req('/full-89',{method:'POST'}),env(d),fx)).json();
 assert.equal(x.status,'FULL_89_BATCH_NOT_QUALIFIED');
 assert.equal(x.failure_kind,'provider_query_limit');
 assert.equal(x.release_authority,false);
});
test('complete 89 statement synthetic acceptance is kept separate from release',async()=>{
 const d=db(async arr=>arr.map(()=>({success:true})));
 const x=await (await handle(req('/full-89',{method:'POST'}),env(d),fx)).json();
 assert.equal(x.status,'FULL_89_SYNTHETIC_BATCH_ACCEPTED');
 assert.equal(x.statements,89);
 assert.equal(x.release_authority,false);
});
test('wrong schema plan hash or missing origin denied without reads',async()=>{
 const d=db(async()=>{throw Error('unexpected')});
 const x=await (await handle(req('/full-89',{method:'POST'}),env(d),{...fx,plan_sha256:'WRONG'})).json();
 assert.equal(x.error,'fixture_not_pinned');
 assert.equal(x.release_authority,false);
});
test('unknown route and expired credential deny with no release',async()=>{
 const d=db();
 assert.equal((await handle(req('/random'),env(d),fx)).status,404);
 const e=env(d);e.EXPIRES='0';
 assert.equal((await handle(req('/seed',{method:'POST'}),e,fx)).status,403);
});
