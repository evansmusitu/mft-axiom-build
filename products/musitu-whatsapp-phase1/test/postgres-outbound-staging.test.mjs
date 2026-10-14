import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PostgresTenantRepository} from '../src/postgres/tenant-repository.mjs';
const T='00000000-0000-4000-8000-00000000000a';
const OTHER='00000000-0000-4000-8000-00000000000b';
const D='00000000-0000-4000-8000-00000000000d';
const C='00000000-0000-4000-8000-00000000000c';
const FAQ='00000000-0000-4000-8000-00000000000f';
const PHONE='PHONE_A',REMOTE='hmac256:'+'e'.repeat(64);
const body='Open at 8.';
const normalized='what hours?';
const approvalDigest=createHash('sha256').update(JSON.stringify([T,D,FAQ,normalized,body])).digest('hex');
const BASE={draft_id:D,conversation_id:C,source_faq_id:FAQ,body,normalized_question:normalized,
 draft_status:'DRAFT',source_answer:body,source_question:normalized,handling_mode:'BOT',
 phone_number_id:PHONE,remote_wa_id:REMOTE,channel_status:'VERIFIED',source_digest:approvalDigest,
 session_active:true,reviewer_active:true};
const ARGS={tenantId:T,actorId:'agent-a',draftId:D,reservationKey:'reservation-01'};
function harness({role='AGENT',draft=BASE,consent={status:'GRANTED',scope:'CUSTOMER_SERVICE',valid:true,evidence_ref:'optin:external-record:1'},failAt='',preset=null}={}){
 const calls=[];const prepared=new Map();if(preset)prepared.set('initial',preset);
 const client={async query(sql,params=[]){calls.push({sql,params});
  if(failAt&&sql.includes(failAt))throw new Error('SIMULATED_STORAGE_FAILURE');
  if(sql.includes('musitu.staging_context'))return {rows:draft?[draft]:[]};
  if(sql.includes('FROM musitu.memberships'))return {rows:role&&params[0]===T?[{role}]:[]};
  if(sql.includes('musitu.consent_context'))return {rows:consent?[consent]:[]};
  if(sql.includes('INSERT INTO musitu.outbound_preparations')){
    if(prepared.size)return {rows:[]};
    const row={preparation_id:params[1],draft_id:params[2],conversation_id:params[3],reservation_key:params[4],
     channel_phone_number_id:params[5],recipient_hash:params[6],source_digest:params[7],body_digest:params[8]};
    prepared.set('initial',row);return {rows:[{preparation_id:row.preparation_id}]};
  }
  if(sql.includes('FROM musitu.outbound_preparations'))return {rows:[...prepared.values()]};
  return {rows:[]};
 },release(err){calls.push({sql:'RELEASE',error:err});}};
 return {pool:{connect:async()=>client},calls,prepared};
}
const called=(h,part)=>h.calls.find(x=>x.sql.includes(part));

test('offline staging requires a current reviewed draft, active signed inbound session and explicit verified consent',async()=>{
 const h=harness(),r=new PostgresTenantRepository({pool:h.pool});
 const result=await r.stageApprovedReply(ARGS);
 assert.equal(result.status,'STAGED_OFFLINE');assert.equal(result.providerDelivery,'NEVER_SUBMITTED');
 assert.equal(result.transport,'DISABLED');assert.equal(result.idempotent,false);
 assert.deepEqual(h.calls.map(x=>x.sql).filter(x=>['BEGIN','COMMIT','ROLLBACK','RELEASE'].includes(x)),['BEGIN','COMMIT','RELEASE']);
 assert.deepEqual(called(h,"set_config('app.tenant_id'").params,[T]);
 assert.deepEqual(called(h,'FROM musitu.memberships').params,[T,'agent-a']);
 const lookup=called(h,'musitu.staging_context');
 assert.equal(lookup.sql,'SELECT * FROM musitu.staging_context($1,$2)');
 assert.deepEqual(lookup.params,['agent-a',D]);
 assert.equal(called(h,'musitu.consent_context').sql,'SELECT * FROM musitu.consent_context($1,$2,$3)');
 const insert=called(h,'INSERT INTO musitu.outbound_preparations');
 assert.equal(insert.params[0],T);assert.equal(insert.params[2],D);assert.equal(insert.params[6],REMOTE);
 assert.equal(insert.params[7],approvalDigest);
 assert.match(insert.params[8],/^[a-f0-9]{64}$/);
 assert.equal(h.calls.some(x=>/INSERT INTO musitu.outbound_attempts|https:\/\/|provider\.send\(/.test(x.sql)),false);
});

test('identical reservation replays are idempotent; changed key and reused key conflict',async()=>{
 const h=harness(),r=new PostgresTenantRepository({pool:h.pool});
 const first=await r.stageApprovedReply(ARGS);
 const second=await r.stageApprovedReply(ARGS);
 assert.equal(first.idempotent,false);assert.equal(second.idempotent,true);
 assert.equal(second.preparationId,first.preparationId);
 await assert.rejects(r.stageApprovedReply({...ARGS,reservationKey:'another-reservation'}),/STAGE_CONFLICT/);
 assert.equal(h.prepared.size,1);
});

test('revoked roles, other tenant, changed knowledge, handover, unapproved draft and inactive channel fail closed',async()=>{
 for(const change of [
   {role:'VIEWER'}, {role:null}, {draft:{...BASE,source_answer:'Hours changed'}},
   {draft:{...BASE,handling_mode:'HUMAN'}},{draft:{...BASE,source_digest:'f'.repeat(64)}},
   {draft:{...BASE,source_digest:null}},{draft:{...BASE,channel_status:'REVOKED'}},{draft:{...BASE,reviewer_active:false}},
   {draft:null}
 ]){
  const h=harness(change),r=new PostgresTenantRepository({pool:h.pool});
  await assert.rejects(r.stageApprovedReply(ARGS),/(ACCESS_DENIED|DRAFT_NOT_STAGEABLE)/);
  assert.equal(called(h,'INSERT INTO musitu.outbound_preparations'),undefined);
  assert.equal(h.calls.some(x=>x.sql==='ROLLBACK'),true);
 }
 const h=harness(),r=new PostgresTenantRepository({pool:h.pool});
 await assert.rejects(r.stageApprovedReply({...ARGS,tenantId:OTHER}),/ACCESS_DENIED/);
 assert.equal(called(h,'INSERT INTO musitu.outbound_preparations'),undefined);
});

test('closed service window, missing verified consent, revoked consent and expired consent are blocked',async()=>{
 for(const options of [{draft:{...BASE,session_active:false}}, {consent:null},
   {consent:{status:'REVOKED',scope:'CUSTOMER_SERVICE',valid:true,evidence_ref:'optin:1'}},
   {consent:{status:'GRANTED',scope:'CUSTOMER_SERVICE',valid:false,evidence_ref:'optin:1'}},
   {consent:{status:'GRANTED',scope:'MARKETING',valid:true,evidence_ref:'optin:1'}},
   {consent:{status:'GRANTED',scope:'CUSTOMER_SERVICE',valid:true,evidence_ref:''}}]){
  const h=harness(options),r=new PostgresTenantRepository({pool:h.pool});
  await assert.rejects(r.stageApprovedReply(ARGS),/(SESSION_WINDOW_CLOSED|CONSENT_REQUIRED)/);
  assert.equal(called(h,'INSERT INTO musitu.outbound_preparations'),undefined);
 }
});

test('invalid ids/keys and storage fault never cause partial staging',async()=>{
 const h=harness(),r=new PostgresTenantRepository({pool:h.pool});
 for(const x of [{tenantId:'tenant-a'},{draftId:'wrong'},{actorId:'bad actor'},{reservationKey:''},{reservationKey:'a'.repeat(181)}])
  await assert.rejects(r.stageApprovedReply({...ARGS,...x}),/INVALID_/);
 assert.equal(h.calls.length,0);
 const failed=harness({failAt:'INSERT INTO musitu.outbound_preparations'}),r2=new PostgresTenantRepository({pool:failed.pool});
 await assert.rejects(r2.stageApprovedReply(ARGS),/SIMULATED_STORAGE_FAILURE/);
 assert.equal(failed.calls.some(x=>x.sql==='ROLLBACK'),true);
 assert.equal(failed.calls.some(x=>x.sql==='COMMIT'),false);
});

test('issuer-pinned private API allows stage-offline but has no outbound send endpoint',async t=>{
 const {generateKeyPairSync,sign}=await import('node:crypto');
 const {createPrivateAdminServer}=await import('../src/private-stage/admin-server.mjs');
 const kp=generateKeyPairSync('rsa',{modulusLength:2048});
 const identityConfig={issuer:'https://identity.example.invalid/realms/private',audience:'private-stage',maxTokenAgeSeconds:300,
  jwks:{keys:[{...kp.publicKey.export({format:'jwk'}),kid:'stage-key',alg:'RS256',use:'sig'}]}};
 const now=Math.floor(Date.now()/1000),enc=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
 const input=enc({typ:'JWT',alg:'RS256',kid:'stage-key'})+'.'+enc({iss:identityConfig.issuer,
  aud:identityConfig.audience,sub:'agent-a',iat:now-1,nbf:now-1,exp:now+120});
 const jwt=input+'.'+sign('RSA-SHA256',Buffer.from(input),kp.privateKey).toString('base64url');
 const h=harness(),repo=new PostgresTenantRepository({pool:h.pool});
 const server=createPrivateAdminServer({store:repo,identityConfig});
 const host=await server.start();t.after(()=>server.stop());
 const uri=host+`/v1/tenants/${T}/drafts/${D}/stage-offline`;
 const headers={authorization:'Bearer '+jwt,'content-type':'application/json'};
 const body=JSON.stringify({reservationKey:ARGS.reservationKey});
 assert.equal((await fetch(uri,{method:'POST',headers:{'content-type':'application/json'},body})).status,401);
 assert.equal((await fetch(uri,{method:'POST',headers:{...headers,'content-type':'text/plain'},body})).status,415);
 assert.equal((await fetch(uri,{method:'POST',headers,body:'badjson'})).status,400);
 assert.equal((await fetch(uri,{method:'POST',headers,body:JSON.stringify({reservationKey:ARGS.reservationKey,force:true})})).status,400);
 const done=await fetch(uri,{method:'POST',headers,body});
 assert.equal(done.status,201);assert.equal((await done.json()).status,'STAGED_OFFLINE');
 const again=await fetch(uri,{method:'POST',headers,body});
 assert.equal(again.status,200);assert.equal((await again.json()).idempotent,true);
 assert.equal((await fetch(uri.replace('stage-offline','send'),{method:'POST',headers,body})).status,404);
});


test('a persisted signed customer opt-out blocks even a previously approved and consented offline preparation',async()=>{
 const h=harness({draft:{...BASE,customer_suppressed:true}}),r=new PostgresTenantRepository({pool:h.pool});
 await assert.rejects(r.stageApprovedReply(ARGS),/CUSTOMER_OPT_OUT/);
 const statement=called(h,'musitu.staging_context').sql;
 assert.equal(statement,'SELECT * FROM musitu.staging_context($1,$2)');
 assert.equal(called(h,'INSERT INTO musitu.outbound_preparations'),undefined);
 assert.equal(h.calls.some(x=>x.sql==='ROLLBACK'),true);
});
