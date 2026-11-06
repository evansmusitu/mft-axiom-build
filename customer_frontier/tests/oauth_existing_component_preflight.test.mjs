import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {observe,DATABASE,CATALOG,CHECKS} from '../qualification/oauth_existing_component_preflight.mjs';
const publicKey=await readFile(new URL('../recovery/recipient-20261106.pem',import.meta.url));
const fields=['foreign_key_violations','invalid_customers','invalid_keys','invalid_codes','invalid_access','invalid_refresh'];
async function run(change=()=>{},options={}){
 const data=[{success:true,result:{bindings:[{type:'d1',name:'AXIOM_DB',id:DATABASE},{type:'plain_text',name:'PRIVATE_LABEL',text:'PRIVATE_VALUE'}]}},
 {success:true,result:{uuid:DATABASE,name:'musitu-axiom-prod'}},
 {success:true,result:[{success:true,meta:{changed_db:false,changes:0,rows_written:0},results:['customers','api_keys','oauth_authorization_codes','oauth_access_tokens','oauth_refresh_tokens'].map(name=>({type:'table',name,tbl_name:name,sql:'CREATE TABLE '+name+"(value TEXT DEFAULT 'PRIVATE_SQL')"}))}]},
 {success:true,result:[{success:true,meta:{changed_db:false,changes:0,rows_written:0},results:[Object.fromEntries(fields.map(k=>[k,0]))]}]}];change(data);const requests=[];
 const fetcher=async(url,opts)=>{requests.push({url,opts});return new Response(JSON.stringify(data.shift()),{status:200});};
 const result=await observe({token:'PRIVATE_TOKEN',publicKey,sourceSha:'a'.repeat(40),fetcher,...options});
 for(const {url,opts}of requests){assert(url.startsWith('https://api.cloudflare.com/client/v4/accounts/93f395f5121954671f92fffa453d6b61/'));assert.equal(opts.redirect,'error');assert.equal(opts.headers.Authorization,'Bearer PRIVATE_TOKEN');if(opts.method==='POST')assert([CATALOG,CHECKS].includes(JSON.parse(opts.body).sql));else assert.equal(opts.method,'GET');}
 for(const key of ['target_admitted','migration_qualified','release_authority'])assert.equal(result.out[key],false);
 const output=JSON.stringify(result.out);for(const secret of ['PRIVATE_LABEL','PRIVATE_VALUE','PRIVATE_SQL','PRIVATE_TOKEN'])assert(!output.includes(secret));
 return {...result,requests};
}
test('actual parent scope and base counts observed without migration authority',async()=>{const r=await run();assert.equal(r.requests.length,4);assert.equal(r.out.status,'BASE_CONSISTENCY_OBSERVED_NOT_MIGRATION');assert.equal(r.out.provider_query_mutations,0);assert(r.encrypted);assert(!r.encrypted.includes(Buffer.from('PRIVATE_SQL')));});
test('binding and metadata drift stop before SQL',async()=>{for(const change of [d=>{d[0].result.bindings[0].id='other';},d=>{d[1].result.name='other';}]){const r=await run(change);assert.equal(r.out.status,'UNKNOWN');assert(r.requests.length<=2);assert.equal(r.out.queries,0);}});
test('missing OAuth parents blocks consistency query without inventing tables',async()=>{const r=await run(d=>{d[2].result[0].results.pop();});assert.equal(r.out.error,'REAL_OAUTH_PARENT_TABLES_MISSING');assert.equal(r.requests.length,3);assert.equal(r.out.base_consistency_observed,false);});
test('write contradiction or missing counter remains unknown',async()=>{for(const change of [d=>{d[2].result[0].meta.changed_db=true;},d=>{delete d[2].result[0].meta.rows_written;},d=>{d[2].result[0].meta.changes=false;}]){const r=await run(change);assert.equal(r.out.provider_query_mutations,null);assert.equal(r.out.error,'ZERO_WRITES_NOT_CONFIRMED');}});
test('inconsistent actual base rows reject qualification',async()=>{const r=await run(d=>{d[3].result[0].results[0].invalid_keys=1;});assert.equal(r.out.status,'INCONSISTENT_BASE_ROWS_REJECTED');});
test('malformed counters cannot pass',async()=>{for(const value of [null,true,-1,0.5,'0']){const r=await run(d=>{d[3].result[0].results[0].invalid_access=value;});assert.equal(r.out.error,'INVALID_CONSISTENCY_COUNTERS');}});
test('catalog duplicates and malformed response reject observation',async()=>{for(const change of [d=>{d[2].result[0].results.push(d[2].result[0].results[0]);},d=>{d[2].result[0].results[0].private='PRIVATE_SQL';}]){const r=await run(change);assert.equal(r.out.status,'UNKNOWN');assert.equal(r.out.catalog_observed,false);}});
test('missing token or wrong public recipient makes no request',async()=>{for(const options of [{token:''},{publicKey:Buffer.from('bad')},{sourceSha:'bad'}]){const r=await run(()=>{},options);assert.equal(r.requests.length,0);assert.equal(r.out.status,'UNKNOWN');}});
