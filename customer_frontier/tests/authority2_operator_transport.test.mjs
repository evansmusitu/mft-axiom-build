import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createDecipheriv} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {cfAllowed,ghAllowed,OperatorTransport,WORKER_ROOT} from '../qualification/authority2_operator/transport.mjs';
import {ACCOUNT,SOURCE_ACCOUNT,REPO,CHECKPOINT_REPO} from '../qualification/authority2_operator/pins.mjs';
import {summarizeToken,assertSameBoundary,freshBuildDenials} from '../qualification/authority2_operator/boundary.mjs';
import {PrivateEvidence} from '../qualification/authority2_operator/private_evidence.mjs';
import {observePrivateSchedule} from '../qualification/authority2_operator/tail.mjs';
import {parseIdentityJson} from '../customer_control_plane/zitadel_provider_tokens_candidate.mjs';
const key='PRIVATE_CF_VALUE_'+ 'k'.repeat(32),gh='PRIVATE_GH_VALUE_'+ 'g'.repeat(32),cred={kind:'global_key',secret:key,email:'private-owner@example.invalid'};
const good=x=>Response.json({success:true,errors:[],result:x});
const token=(name='Workers Scripts Read',resources={['com.cloudflare.api.account.'+ACCOUNT]:'*'},effect='allow')=>({id:'a'.repeat(32),status:'active',policies:[{effect,resources,permission_groups:[{name}]}]});
test('operator CF writes are confined to the exact authority Worker; D1, buckets, source account and public routing writes are rejected',()=>{
 for(const p of [WORKER_ROOT,WORKER_ROOT+'/content',WORKER_ROOT+'/schedules'])assert(cfAllowed('PUT',p));
 for(const [m,p]of [['DELETE',WORKER_ROOT],['PUT','/accounts/'+SOURCE_ACCOUNT+'/workers/scripts/'+ 'other'],['POST','/accounts/'+ACCOUNT+'/d1/database'],['DELETE','/accounts/'+ACCOUNT+'/r2/buckets/history'],['PUT',WORKER_ROOT+'/routes'],['POST','/user/tokens'],['PATCH','/accounts/'+ACCOUNT+'/subscriptions']])assert.equal(cfAllowed(m,p),false);
});
test('GitHub writes are qualification releases or one pinned denial rerun; main, PR1, releases elsewhere and tag deletion cannot be used',()=>{
 assert(ghAllowed('POST','/repos/'+CHECKPOINT_REPO+'/releases'));assert(ghAllowed('POST','/repos/'+REPO+'/actions/jobs/138679115528/rerun'));
 for(const [m,p]of [['POST','/repos/'+REPO+'/releases'],['PATCH','/repos/'+REPO+'/git/refs/heads/main'],['DELETE','/repos/'+CHECKPOINT_REPO+'/git/refs/tags/a'],['PATCH','/repos/'+REPO+'/pulls/1'],['POST','/repos/'+REPO+'/actions/jobs/1/rerun']])assert.equal(ghAllowed(m,p),false);
});
test('Cloudflare and GitHub credentials never cross providers or enter the public mutation journal',async()=>{
 const seen=[],journal=[],privateRecords=[];const t=new OperatorTransport({credential:cred,githubToken:gh,journal:x=>journal.push(x),capturePrivate:x=>{privateRecords.push(x);return true;},fetchImpl:async r=>{seen.push(r);return r.url.includes('cloudflare')?good({enabled:false,previews_enabled:false}):Response.json({id:1});}});
 await t.cf('POST',WORKER_ROOT+'/subdomain',{body:{enabled:false,previews_enabled:false}});await t.gh('GET','/repos/'+CHECKPOINT_REPO);
 assert.equal(seen[0].headers.get('x-auth-key'),key);assert.equal(seen[0].headers.has('authorization'),false);assert.equal(seen[1].headers.get('authorization'),'Bearer '+gh);assert.equal(seen[1].headers.has('x-auth-key'),false);assert(seen.every(r=>r.redirect==='manual'&&r.credentials==='omit'));
 const out=JSON.stringify(journal);for(const v of [key,gh,cred.email])assert(!out.includes(v));assert(privateRecords.every(x=>x.response_complete===true));
});
test('redirects cannot forward credentials and non200 bodies remain private evidence, not success',async()=>{
 let called=0;const encrypted=[];const t=new OperatorTransport({credential:cred,githubToken:gh,capturePrivate:x=>{encrypted.push(x);return true;},fetchImpl:async()=>{called++;return new Response('PRIVATE_PROVIDER_ERROR_'+key,{status:302,headers:{location:'https://attacker.invalid/'+key}});}});
 await assert.rejects(t.cf('GET','/user'),/A2OP_PROVIDER_STATUS_HOLD/);assert.equal(called,1);assert(encrypted.some(x=>x.body_base64&&Buffer.from(x.body_base64,'base64').toString().includes(key)));
});
test('duplicate JSON cannot qualify provider identity; bounded raw response is retained privately',async()=>{
 const t=new OperatorTransport({credential:cred,githubToken:gh,parseJson:parseIdentityJson,fetchImpl:async()=>new Response('{"success":false,"success":true,"errors":[],"result":{}}')});await assert.rejects(t.cf('GET','/user'),/A2OP_PROVIDER_JSON_HOLD/);
});
test('malformed or oversized responses fail closed without exporting a provider message',async()=>{
 const t=new OperatorTransport({credential:cred,githubToken:gh,fetchImpl:async()=>new Response('x'.repeat(1048577))});await assert.rejects(t.cf('GET','/user'),/A2OP_RESPONSE_SIZE_HOLD/);
 const bad=new OperatorTransport({credential:cred,githubToken:gh,fetchImpl:async()=>good(null)});assert.equal((await bad.cf('GET','/user')).data,null); // identity validation belongs to readBoundary
});
test('loss of private evidence stops further mutations while permitting owned cleanup',async()=>{
 let calls=0;const t=new OperatorTransport({credential:cred,githubToken:gh,capturePrivate:()=>false,fetchImpl:async()=>{calls++;return good({});}});
 await t.cf('GET','/user');await assert.rejects(t.cf('POST',WORKER_ROOT+'/subdomain',{body:{enabled:false}}),/A2OP_PRIVATE_EVIDENCE_INCOMPLETE_HOLD/);assert.equal(calls,1);t.cleanupMode=true;await t.cf('POST',WORKER_ROOT+'/subdomain',{body:{enabled:false}});assert.equal(calls,2);
});
test('read-only labels include the three independently resolved exceptions and never treat Write/Edit/unknown as read',()=>{
 for(const n of ['Workers Scripts Read','Workers Content Read-Only','Workers Metadata Read-Only','Magic Firewall Packet Captures - Read PCAPs API'])assert.equal(summarizeToken(token(n)).potential_A2_or_global_credential_admin_allow,false);
 for(const n of ['Workers Scripts Write','Workers Editor','Unrecognized Permission'])assert.equal(summarizeToken(token(n)).potential_A2_or_global_credential_admin_allow,true);
});
test('write grants outside A2 are distinguished from all-account and global user-token administration',()=>{
 assert.equal(summarizeToken(token('Workers Scripts Write',{['com.cloudflare.api.account.'+SOURCE_ACCOUNT]:'*'})).potential_A2_or_global_credential_admin_allow,false);
 assert.equal(summarizeToken(token('Workers Scripts Write',{'com.cloudflare.api.account.*':'*'})).potential_A2_or_global_credential_admin_allow,true);
 assert.equal(summarizeToken(token('API Tokens Write',{'com.cloudflare.api.user.*':'*'})).potential_A2_or_global_credential_admin_allow,true);
 assert.equal(summarizeToken(token('Workers Scripts Write',{'com.cloudflare.api.account.*':'*'},'deny')).potential_A2_or_global_credential_admin_allow,false);
 assert.equal(summarizeToken(token('Workers Routes Write',{'com.cloudflare.api.account.zone.*':'*'})).potential_A2_or_global_credential_admin_allow,true);
 assert.equal(summarizeToken(token('Workers Scripts Write',{'com.cloudflare.api.account.*':{'*':'*'}})).potential_A2_or_global_credential_admin_allow,true);
 assert.throws(()=>summarizeToken({...token(),status:'unmapped'}),/A2OP_TOKEN_METADATA_HOLD/);
});
test('malformed policy/resource data is a hold; a timestamp change alone is not policy drift',()=>{
 assert.throws(()=>summarizeToken({...token(),policies:[{effect:'allow',resources:null,permission_groups:[]}]}),/A2OP_TOKEN_POLICY_HOLD/);assertSameBoundary({x:1,observed_at_utc:'a'},{x:1,observed_at_utc:'b'});assert.throws(()=>assertSameBoundary({x:1},{x:2}),/A2OP_BOUNDARY_DRIFT_HOLD/);
});
test('private provider originals are AES-GCM encrypted and the session key can be wrapped without exposing raw records',()=>{
 const root=mkdtempSync(join(tmpdir(),'a2-private-archive-'));let captured;
 try{const p=new PrivateEvidence(root,{wrap:key=>{captured=Buffer.from(key);return Buffer.concat([Buffer.from('SYNTHETIC_WRAPPER_ONLY'),key]);}});const original={body_base64:Buffer.from(key).toString('base64'),http_status:200};assert.equal(p.capture(original),true);const raw=readFileSync(p.file,'utf8');assert(!raw.includes(key)&&!raw.includes(original.body_base64));const e=JSON.parse(raw),d=createDecipheriv('aes-256-gcm',captured,Buffer.from(e.iv_base64,'base64'));d.setAuthTag(Buffer.from(e.tag_base64,'base64'));const plain=Buffer.concat([d.update(Buffer.from(e.ciphertext_base64,'base64')),d.final()]);assert.deepEqual(JSON.parse(plain),original);p.close();assert(p.key.every(x=>x===0));}finally{captured?.fill(0);rmSync(root,{recursive:true,force:true});}
});
test('provider token identifiers are domain-separated metadata hashes, not credential-value hashes',()=>{
 const t=token(),s=summarizeToken(t);assert.equal(s.token_identifier_sha256,createHash('sha256').update('cloudflare-token-id\n'+t.id).digest('hex'));assert(!JSON.stringify(s).includes(t.id));
});
test('zone query punctuation is literal and the empty owner control cannot be turned into a script upload or deletion',()=>{
 assert(cfAllowed('GET',`/zones?account.id=${ACCOUNT}&page=1&per_page=50`));assert(!cfAllowed('GET',`/zones?accountXid=${ACCOUNT}&page=1&per_page=50`));
 const root=`/accounts/${ACCOUNT}/workers/scripts/axiom-a2-op-authcheck-${'a'.repeat(32)}`;
 assert(cfAllowed('GET',root+'/settings'));assert(cfAllowed('POST',root+'/assets-upload-session'));
 for(const method of ['PUT','DELETE','PATCH'])assert(!cfAllowed(method,root));assert(!cfAllowed('POST',root+'/subdomain'));assert(!cfAllowed('POST',root.replace(ACCOUNT,SOURCE_ACCOUNT)+'/assets-upload-session'));
});
test('fresh denial acceptance waits beyond the latest existing attempt and rejects stale or partial reports',async()=>{
 const source='a932c5f7b9a4bf40c9b0bf1af811015b9b88383b';let polls=0,reran=false;
 const current={id:123,head_sha:source,name:'bounded-canaries',run_attempt:4,status:'completed',conclusion:'success'};
 const t={parseJson:JSON.parse,async gh(method,path){if(path.endsWith('/jobs/138679115528'))return {data:{...current,id:138679115528,run_id:45459847877,run_attempt:1}};if(method==='POST'){reran=true;return {status:201};}assert(path.includes('/jobs?filter=latest'));if(reran)polls++;return {data:{total_count:1,jobs:[polls>1?{...current,id:124,run_attempt:5}:current]}};}};
 const record={schema:'musitu.axiom.gate3.bounded-denials.v1',bounded_worker_assets_r2_denial_tests_passed:true,target_account:ACCOUNT,subject_identity_and_policy_stable:true,preconditions_passed:true,unexpected_write_observed:false,possible_orphan_bucket_names:[],retained_bucket_or_customer_state_targeted:false,observed_at_utc:new Date().toISOString()};
 const args={wait:async()=>{},progress:()=>{},readLog:async()=>JSON.stringify(record)};
 const result=await freshBuildDenials(t,args);assert.equal(result.run_attempt,5);assert.equal(result.job_id,124);assert.equal(result.all_provider_denial_inferred,false);assert(polls>=2);
 for(const change of [{observed_at_utc:'2000-01-01T00:00:00Z'},{unexpected_write_observed:true},{possible_orphan_bucket_names:['unknown']},{target_account:SOURCE_ACCOUNT}]){polls=0;reran=false;await assert.rejects(freshBuildDenials(t,{...args,readLog:async()=>JSON.stringify({...record,...change})}),/A2OP_DENIAL_REPORT_SCOPE_HOLD/);}
});
test('private cron observation filters foreign traces and retires its owned tail without exposing raw events or the capability URL',async()=>{
 const now=Date.now(),cron='1 2 26 11 *',privateUrl='wss://tail.cloudflare.com/PRIVATE_TRACE_CAPABILITY',captured=[],calls=[];
 const trace={scriptName:'axiom-security-authority2-highwater',event:{cron,scheduledTime:now},outcome:'ok',exceptions:[],logs:[{message:['PRIVATE_UNRELATED_LOG']}]};
 class Socket extends EventTarget{constructor(url,protocol){super();assert.equal(url,privateUrl);assert.equal(protocol,'trace-v1');queueMicrotask(()=>{this.dispatchEvent(new Event('open'));for(const x of [{...trace,scriptName:'foreign'},trace]){const e=new Event('message');Object.defineProperty(e,'data',{value:JSON.stringify(x)});this.dispatchEvent(e);}});}send(x){assert.equal(x,'{"debug":false}');}close(){}}
 const t={capturePrivate:x=>{captured.push(x);return true;},async cf(method,path){calls.push({method,path});return {data:{id:'a'.repeat(32),url:privateUrl,expires_at:new Date(now+3600000).toISOString()}};}};
 const result=await observePrivateSchedule(t,{cron,not_before_ms:now-1000,not_after_ms:now+3000,phase:'GENESIS',parseJson:JSON.parse,WebSocketImpl:Socket});assert.equal(result.outcome,'ok');assert.equal(result.scheduled_time_ms,now);assert.equal(calls.at(-1).method,'DELETE');assert.equal(captured.length,2);assert(!JSON.stringify(result).includes('PRIVATE_'));
});
test('an invalid tail destination still triggers owned cleanup and an unconfirmed tail retirement is a HOLD',async()=>{
 const now=Date.now(),window={cron:'1 2 26 11 *',not_before_ms:now-1000,not_after_ms:now+3000,phase:'GENESIS',parseJson:JSON.parse};let deleted=false,connected=false;
 const t={capturePrivate:()=>true,async cf(method){if(method==='DELETE'){deleted=true;return {data:{}};}return {data:{id:'b'.repeat(32),url:'wss://attacker.invalid/PRIVATE',expires_at:new Date(now+3600000).toISOString()}};}};
 class Socket{constructor(){connected=true;}}
 await assert.rejects(observePrivateSchedule(t,{...window,WebSocketImpl:Socket}),/A2OP_PRIVATE_TAIL_DESTINATION_HOLD/);assert(deleted);assert(!connected);
 t.cf=async method=>{if(method==='DELETE')throw Error('PRIVATE_PROVIDER_ERROR');return {data:{id:'b'.repeat(32),url:'wss://attacker.invalid/PRIVATE',expires_at:new Date(now+3600000).toISOString()}};};await assert.rejects(observePrivateSchedule(t,{...window,WebSocketImpl:Socket}),/A2OP_PRIVATE_TAIL_RETIREMENT_HOLD/);
});
