import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign as rsaSign} from 'node:crypto';
import {PostgresTenantRepository} from '../src/postgres/tenant-repository.mjs';
import {createPrivateAdminServer} from '../src/private-stage/admin-server.mjs';

const A='00000000-0000-4000-8000-00000000000a';
const B='00000000-0000-4000-8000-00000000000b';
const DRAFT='00000000-0000-4000-8000-00000000000d';
const CONVO='00000000-0000-4000-8000-00000000000c';
const SOURCE='00000000-0000-4000-8000-00000000000f';
const original={draft_id:DRAFT,conversation_id:CONVO,source_faq_id:SOURCE,body:'We open at 08:00',normalized_question:'what time do you open?',source_answer:'We open at 08:00',source_question:'what time do you open?',draft_status:'DRAFT',handling_mode:'BOT'};

function fakePool({role='AGENT',draft=original,existing=null,queryFailure=null,duplicateApprovalKey=false}={}){
 const calls=[],approvals=new Map();
 if(existing)approvals.set(DRAFT,existing);
 const client={
  async query(sql,params=[]){
   calls.push({sql,params});
   if(queryFailure&&sql.includes(queryFailure))throw new Error('SIMULATED_DATABASE_FAILURE');
   if(sql.includes('FROM musitu.memberships'))return {rows:role&&params[0]===A?[{role}]:[]};
   if(sql.includes('FROM musitu.reply_drafts AS d')&&sql.includes('ORDER BY')){
    const stale=draft&&(draft.source_answer!==draft.body||draft.source_question!==draft.normalized_question||draft.handling_mode!=='BOT');
    return {rows:draft&&params[0]===A?[{...draft,status:'DRAFT',review_status:stale?'REVIEW_EXPIRED':approvals.has(DRAFT)?'APPROVED_OFFLINE':'DRAFT'}]:[]};
   }
   if(sql.includes('musitu.draft_review_context'))return {rows:draft?[draft]:[]};
   if(sql.includes('INSERT INTO musitu.draft_approvals')){
    if(duplicateApprovalKey){const e=new Error('unique violation');e.code='23505';throw e;}
    if(approvals.has(DRAFT))return {rows:[]};
    const value={tenant_id:params[0],draft_id:params[1],actor_id:params[2],approval_key:params[3],source_digest:params[4]};
    approvals.set(DRAFT,value);return {rows:[value],rowCount:1};
   }
   if(sql.includes('FROM musitu.draft_approvals'))return {rows:approvals.has(DRAFT)?[approvals.get(DRAFT)]:[]};
   return {rows:[],rowCount:0};
  },
  release(error){calls.push({sql:'RELEASE',error});}
 };
 return {pool:{connect:async()=>client},calls,approvals};
}
const find=(db,part)=>db.calls.find(x=>x.sql.includes(part));
const args={tenantId:A,actorId:'owner-a',draftId:DRAFT,approvalKey:'review-0001'};

test('a member can approve an exact, current source-grounded draft, with no sending or external action',async()=>{
 const db=fakePool(),repo=new PostgresTenantRepository({pool:db.pool});
 const result=await repo.approveReplyDraft(args);
 assert.deepEqual(result,{tenantId:A,draftId:DRAFT,reviewedBy:'owner-a',status:'APPROVED_OFFLINE',idempotent:false,providerDelivery:'NEVER_SUBMITTED'});
 assert.deepEqual(db.calls.map(x=>x.sql).filter(x=>['BEGIN','COMMIT','ROLLBACK','RELEASE'].includes(x)),['BEGIN','COMMIT','RELEASE']);
 assert.deepEqual(find(db,"set_config('app.tenant_id'").params,[A]);
 assert.deepEqual(find(db,'FROM musitu.memberships').params,[A,'owner-a']);
 assert.deepEqual(find(db,'musitu.draft_review_context').params,['owner-a',DRAFT]);
 assert.equal(find(db,'musitu.draft_review_context').sql,'SELECT * FROM musitu.draft_review_context($1,$2)');
 const insertion=find(db,'INSERT INTO musitu.draft_approvals');
 assert.deepEqual(insertion.params.slice(0,4),[A,DRAFT,'owner-a','review-0001']);
 assert.match(insertion.params[4],/^[a-f0-9]{64}$/);
 assert.equal(db.calls.some(x=>/outbound_attempts|fetch\(|https?:\/\//.test(x.sql)),false);
});

test('same actor, source and approval key are idempotent; conflicting reviewer or key rejected',async()=>{
 const db=fakePool(),repo=new PostgresTenantRepository({pool:db.pool});
 assert.equal((await repo.approveReplyDraft(args)).idempotent,false);
 assert.equal((await repo.approveReplyDraft(args)).idempotent,true);
 await assert.rejects(repo.approveReplyDraft({...args,approvalKey:'other-review'}),/APPROVAL_CONFLICT/);
 await assert.rejects(repo.approveReplyDraft({...args,actorId:'another-agent'}),/APPROVAL_CONFLICT/);
 assert.equal(db.approvals.size,1);
});

test('viewer and revoked membership cannot approve and no insert runs',async()=>{
 for(const role of ['VIEWER',null]){
  const db=fakePool({role}),repo=new PostgresTenantRepository({pool:db.pool});
  await assert.rejects(repo.approveReplyDraft(args),/ACCESS_DENIED/);
  assert.equal(db.calls.some(x=>x.sql.includes('INSERT INTO musitu.draft_approvals')),false);
  assert.equal(db.calls.some(x=>x.sql==='ROLLBACK'),true);
 }
});

test('missing, stale, changed-source or handed-over drafts require renewed review',async()=>{
 for(const draft of [null,{...original,source_answer:'New hours: 10:00'},{...original,source_question:'different question'},{...original,handling_mode:'HUMAN'},{...original,draft_status:'REJECTED'}]){
  const db=fakePool({draft}),repo=new PostgresTenantRepository({pool:db.pool});
  await assert.rejects(repo.approveReplyDraft(args),/DRAFT_REVIEW_REQUIRED/);
  assert.equal(db.calls.some(x=>x.sql.includes('INSERT INTO musitu.draft_approvals')),false);
 }
});

test('invalid IDs and keys are rejected before database access; cross-tenant draft never found',async()=>{
 const db=fakePool({draft:null}),repo=new PostgresTenantRepository({pool:db.pool});
 for(const changes of [{tenantId:'tenant-a'},{draftId:'not uuid'},{approvalKey:''},{approvalKey:'x'.repeat(181)},{actorId:''}]){
  await assert.rejects(repo.approveReplyDraft({...args,...changes}),/INVALID_/);
 }
 assert.equal(db.calls.length,0);
 await assert.rejects(repo.approveReplyDraft({...args,tenantId:B}),/ACCESS_DENIED/);
});

test('database failure rolls back, and connection cannot commit partial approval',async()=>{
 const db=fakePool({queryFailure:'INSERT INTO musitu.draft_approvals'}),repo=new PostgresTenantRepository({pool:db.pool});
 await assert.rejects(repo.approveReplyDraft(args),/SIMULATED_DATABASE_FAILURE/);
 assert.equal(db.calls.some(x=>x.sql==='COMMIT'),false);
 assert.equal(db.calls.some(x=>x.sql==='ROLLBACK'),true);
 assert.equal(db.calls.at(-1).sql,'RELEASE');
});

const kp=generateKeyPairSync('rsa',{modulusLength:2048});
const trusted={...kp.publicKey.export({format:'jwk'}),kid:'review-test',alg:'RS256',use:'sig'};
const issuer='https://identity.example.invalid/realms/review';
const identityConfig={issuer,audience:'review-stage',jwks:{keys:[trusted]},maxTokenAgeSeconds:300};
function token(subject='owner-a'){
 const now=Math.floor(Date.now()/1000);
 const enc=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
 const data=enc({typ:'JWT',alg:'RS256',kid:'review-test'})+'.'+enc({iss:issuer,aud:identityConfig.audience,sub:subject,iat:now-1,nbf:now-1,exp:now+120});
 return data+'.'+rsaSign('RSA-SHA256',Buffer.from(data),kp.privateKey).toString('base64url');
}

test('authenticated private review endpoint persists only offline approval and requires exact JSON body',async t=>{
 const db=fakePool(),repo=new PostgresTenantRepository({pool:db.pool});
 const api=createPrivateAdminServer({store:repo,identityConfig});
 const host=await api.start();t.after(()=>api.stop());
 const url=host+`/v1/tenants/${A}/drafts/${DRAFT}/approve`;
 const body=JSON.stringify({approvalKey:'review-0001'});
 const headers={'content-type':'application/json',authorization:'Bearer '+token()};
 assert.equal((await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body})).status,401);
 assert.equal((await fetch(url,{method:'POST',headers:{...headers,'content-type':'text/plain'},body})).status,415);
 assert.equal((await fetch(url,{method:'POST',headers,body:'{invalid'})).status,400);
 assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify({approvalKey:'review-0001',extra:'unapproved'})})).status,400);
 assert.equal((await fetch(url,{method:'POST',headers,body:'x'.repeat(5000)})).status,413);
 const first=await fetch(url,{method:'POST',headers,body});
 assert.equal(first.status,201);assert.equal((await first.json()).status,'APPROVED_OFFLINE');
 const repeat=await fetch(url,{method:'POST',headers,body});assert.equal(repeat.status,200);assert.equal((await repeat.json()).idempotent,true);
 assert.equal((await fetch(url.replace('/approve','/send'),{method:'POST',headers,body})).status,404);
 assert.equal((await fetch(url.replace(A,B),{method:'POST',headers,body})).status,403);
});


test('draft listing reflects immutable offline approval without claiming WhatsApp delivery',async()=>{
 const db=fakePool(),repo=new PostgresTenantRepository({pool:db.pool});
 const before=await repo.listReplyDrafts(A,'owner-a');
 assert.equal(before.length,1);assert.equal(before[0].status,'DRAFT');
 await repo.approveReplyDraft(args);
 const after=await repo.listReplyDrafts(A,'owner-a');
 assert.equal(after[0].status,'APPROVED_OFFLINE');
 assert.equal(after[0].providerDelivery,'NEVER_SUBMITTED');
 assert.match(find(db,'LEFT JOIN musitu.draft_approvals').sql,/tenant_id=d.tenant_id/);
 await assert.rejects(repo.listReplyDrafts(B,'owner-a'),/ACCESS_DENIED/);
});


test('a reused approval key for a different draft is a conflict, not a generic server crash',async()=>{
 const db=fakePool({duplicateApprovalKey:true}),repo=new PostgresTenantRepository({pool:db.pool});
 await assert.rejects(repo.approveReplyDraft(args),/APPROVAL_CONFLICT/);
 assert.equal(db.calls.some(x=>x.sql==='ROLLBACK'),true);
});


test('listing invalidates reviewed state when approved source changes or a human takes over',async()=>{
 for(const draft of [{...original,source_answer:'Hours changed'},{...original,handling_mode:'HUMAN'}]){
  const db=fakePool({draft,existing:{tenant_id:A,draft_id:DRAFT,actor_id:'owner-a',approval_key:'review-0001',source_digest:'f'.repeat(64)}});
  const repo=new PostgresTenantRepository({pool:db.pool});
  const rows=await repo.listReplyDrafts(A,'owner-a');
  assert.equal(rows[0].status,'REVIEW_EXPIRED');
  const sql=find(db,'LEFT JOIN musitu.draft_approvals').sql;
  assert.match(sql,/JOIN musitu.faqs AS f/);
  assert.match(sql,/JOIN musitu.conversations AS c/);
  assert.match(sql,/d\.body<>f\.answer/);
  assert.match(sql,/c\.handling_mode<>'BOT'/);
 }
});
