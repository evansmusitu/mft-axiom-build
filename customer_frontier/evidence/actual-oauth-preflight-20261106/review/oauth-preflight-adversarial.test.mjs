import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {observe,DATABASE,CATALOG,CHECKS} from '../oauth-live-preflight/customer_frontier/qualification/oauth_existing_component_preflight.mjs';
const key=await readFile(new URL('../oauth-live-preflight/customer_frontier/recovery/recipient-20261106.pem',import.meta.url));
const fields=['foreign_key_violations','invalid_customers','invalid_keys','invalid_codes','invalid_access','invalid_refresh'];
const parents=['customers','api_keys','oauth_authorization_codes','oauth_access_tokens','oauth_refresh_tokens'];
const api='https://api.cloudflare.com/client/v4/accounts/93f395f5121954671f92fffa453d6b61';
async function run(change=()=>{},options={}){
 const input=[{success:true,result:{bindings:[{type:'d1',name:'AXIOM_DB',id:DATABASE},{type:'plain_text',name:'PRIVATE_LABEL_SENTINEL',text:'PRIVATE_VALUE_SENTINEL'}]}},{success:true,result:{uuid:DATABASE,name:'musitu-axiom-prod'}},{success:true,result:[{success:true,meta:{changed_db:false,changes:0,rows_written:0},results:parents.map(name=>({type:'table',name,tbl_name:name,sql:'CREATE TABLE '+name+"(v TEXT DEFAULT 'PRIVATE_DDL_SENTINEL')"}))}]},{success:true,result:[{success:true,meta:{changed_db:false,changes:0,rows_written:0},results:[Object.fromEntries(fields.map(k=>[k,0]))]}]}];
 change(input);const calls=[];
 const fetcher=async(url,opts)=>{calls.push({url,opts});const v=input.shift();if(v instanceof Error)throw v;return v instanceof Response?v:new Response(typeof v==='string'?v:JSON.stringify(v),{status:200});};
 const result=await observe({token:'PRIVATE_TOKEN_SENTINEL',publicKey:key,sourceSha:'a'.repeat(40),fetcher,...options});
 assert(calls.length<=4);for(const flag of ['target_admitted','migration_qualified','release_authority'])assert.equal(result.out[flag],false);
 for(const secret of ['PRIVATE_LABEL_SENTINEL','PRIVATE_VALUE_SENTINEL','PRIVATE_DDL_SENTINEL','PRIVATE_TOKEN_SENTINEL','PRIVATE_ERROR_SENTINEL'])assert(!JSON.stringify(result.out).includes(secret));
 for(let i=0;i<calls.length;i++){
  const {url,opts}=calls[i];assert.equal(url,api+(i===0?'/workers/scripts/musitu-axiom-oauth/settings':'/d1/database/'+DATABASE+(i>=2?'/query':'')));assert.equal(opts.redirect,'error');assert.equal(opts.headers.Authorization,'Bearer PRIVATE_TOKEN_SENTINEL');assert(opts.signal instanceof AbortSignal);
  if(i<2){assert.equal(opts.method,'GET');assert.equal(opts.body,undefined);}else{assert.equal(opts.method,'POST');assert.deepEqual(JSON.parse(opts.body),{sql:i===2?CATALOG:CHECKS,params:[]});}
 }
 return {...result,calls};
}
test('only exact four requests; catalog encrypts without plaintext and zero migration authority',async()=>{const r=await run();assert.equal(r.calls.length,4);assert.equal(r.out.status,'BASE_CONSISTENCY_OBSERVED_NOT_MIGRATION');assert.equal(r.out.provider_query_mutations,0);assert(r.encrypted);assert(!r.encrypted.includes(Buffer.from('PRIVATE_DDL_SENTINEL')));});
test('duplicate binding malformed settings and wrong UUID stop before SQL',async()=>{
 for(const change of [d=>d[0].result.bindings.push(d[0].result.bindings[0]),d=>d[0].result.bindings=null,d=>d[0].result.bindings[0].id='wrong',d=>d[1].result.uuid='wrong']){const r=await run(change);assert.equal(r.out.status,'UNKNOWN');assert.equal(r.out.queries,0);assert(r.calls.length<=2);}
});
test('permission denial redirects oversized invalidJSON and provider codes stay safe UNKNOWN',async()=>{
 for(const value of [new Response(JSON.stringify({success:false,errors:[{code:8000024,message:'PRIVATE_ERROR_SENTINEL'},{code:true}]}),{status:403}),new Response('PRIVATE_ERROR_SENTINEL',{status:307}),'{PRIVATE_ERROR_SENTINEL','x'.repeat(2_000_001)]){const r=await run(d=>d[0]=value);assert.equal(r.out.status,'UNKNOWN');assert.equal(r.calls.length,1);}
 const r=await run(d=>d[0]=new Response(JSON.stringify({success:false,errors:[{code:8000024,message:'PRIVATE_ERROR_SENTINEL'}]}),{status:400}));assert.deepEqual(r.out.transport[0].provider_error_codes,[8000024]);
});
test('each query independently requires exact zero-write evidence',async()=>{
 for(const index of [2,3])for(const patch of [{changed_db:0},{changed_db:true},{changes:false},{rows_written:true},{rows_written:1},{rows_written:null}]){const r=await run(d=>Object.assign(d[index].result[0].meta,patch));assert.equal(r.out.error,'ZERO_WRITES_NOT_CONFIRMED');assert.equal(r.out.provider_query_mutations,null);assert.equal(r.out.status,'UNKNOWN');}
});
test('missing parent malformed catalog and duplicate identities cannot qualify consistency',async()=>{
 for(const change of [d=>d[2].result[0].results.pop(),d=>d[2].result[0].results.push(d[2].result[0].results[0]),d=>d[2].result[0].results[0].sql=null,d=>d[2].result[0].results[0].extra='PRIVATE_DDL_SENTINEL']){const r=await run(change);assert.equal(r.out.status,'UNKNOWN');assert.equal(r.calls.length,3);assert.equal(r.out.base_consistency_observed,false);}
});
test('nonzero and malformed aggregate rows never pass success; fixed counts only',async()=>{
 for(const value of [1,true,-1,0.25,'0',null]){const r=await run(d=>d[3].result[0].results[0].invalid_refresh=value);assert.notEqual(r.out.status,'BASE_CONSISTENCY_OBSERVED_NOT_MIGRATION');}
 const r=await run(d=>d[3].result[0].results[0].extra='PRIVATE_VALUE_SENTINEL');assert.equal(r.out.status,'UNKNOWN');assert.equal(r.out.counts,null);
});
test('preflight provenance and token errors make zero requests',async()=>{for(const options of [{token:''},{token:'bad\nTOKEN'},{publicKey:Buffer.from('wrong')},{sourceSha:'bad'}]){const r=await run(()=>{},options);assert.equal(r.calls.length,0);assert.equal(r.out.status,'UNKNOWN');}});
