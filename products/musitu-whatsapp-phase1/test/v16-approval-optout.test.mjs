import test from 'node:test';
import assert from 'node:assert/strict';
import {PostgresTenantRepository} from '../src/postgres/tenant-repository.mjs';
const TA='00000000-0000-4000-8000-00000000000a',D='00000000-0000-4000-8000-00000000000b';
function fake({suppressed=false}={}){
 const calls=[];
 const client={async query(sql,params=[]){calls.push({sql,params});
   if(sql.includes('FROM musitu.memberships'))return {rows:[{role:'AGENT'}]};
   if(sql.includes('musitu.draft_review_context'))return {rows:[{
     draft_id:D,conversation_id:'00000000-0000-4000-8000-00000000000c',source_faq_id:'00000000-0000-4000-8000-00000000000d',body:'Confirmed information',normalized_question:'hours?',source_answer:'Confirmed information',source_question:'hours?',draft_status:'DRAFT',handling_mode:'BOT',customer_suppressed:suppressed
   }]};
   if(sql.includes('INSERT INTO musitu.draft_approvals'))return {rows:[{draft_id:D}]};
   return {rows:[]};},release(){calls.push({sql:'RELEASE'});}};
 return {pool:{connect:async()=>client},calls};
}
test('already opted-out customer cannot have a fresh draft approved via direct API bypassing UI',async()=>{
 const h=fake({suppressed:true}),r=new PostgresTenantRepository({pool:h.pool});
 await assert.rejects(r.approveReplyDraft({tenantId:TA,actorId:'reviewer-A',draftId:D,approvalKey:'key-A'}),/CUSTOMER_OPT_OUT/);
 assert.equal(h.calls.some(x=>x.sql.includes('INSERT INTO musitu.draft_approvals')),false);
 assert.equal(h.calls.some(x=>x.sql==='ROLLBACK'),true);
 const sql=h.calls.find(x=>x.sql.includes('musitu.draft_review_context'))?.sql;
 assert.equal(sql,'SELECT * FROM musitu.draft_review_context($1,$2)');
});
test('unsuppressed source-grounded reply can still be approved offline',async()=>{
 const h=fake(),r=new PostgresTenantRepository({pool:h.pool});
 const x=await r.approveReplyDraft({tenantId:TA,actorId:'reviewer-A',draftId:D,approvalKey:'key-A'});
 assert.equal(x.status,'APPROVED_OFFLINE');assert.equal(x.providerDelivery,'NEVER_SUBMITTED');
});
