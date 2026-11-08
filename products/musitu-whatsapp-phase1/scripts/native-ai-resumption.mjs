/** Real SQL checks inside the existing disposable loopback qualification only. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createAiResumptionService} from '../src/staging/ai-resumption.mjs';

export async function qualifyAiResumption({seed,pool,scoped,fixtures,transport,tenant,owner,phone}){
 if(process.env.PG_ISOLATED_QUALIFICATION!=='YES'||(await seed.query('SELECT current_database() AS name')).rows[0].name!=='musitu_phase1_sender_ci')throw Error('DISPOSABLE_AI_RESUMPTION_REQUIRED');
 const results=[];
 const check=async(name,work)=>{const detail=await work();results.push({name,status:'PASS',detail});};
 const command=(conversation,confirmed=true,actor=owner)=>scoped(tenant,owner,['OWNER'],async c=>(await c.query('SELECT musitu.resume_ai_assistance($1,$2,$3) AS result',[actor,conversation,confirmed])).rows[0].result);
 const enable=()=>scoped(tenant,owner,['OWNER'],c=>c.query('SELECT musitu.configure_ai($1,true)',[owner]));
 const mode=async id=>(await seed.query('SELECT handling_mode FROM musitu.conversations WHERE conversation_id=$1',[id])).rows[0].handling_mode;
 const audit=async()=>(await seed.query("SELECT count(*)::int AS n FROM musitu.action_audit WHERE action='AI_ASSISTANCE_RESUMED'")).rows[0].n;

 await check('runtime_has_execute_without_direct_conversation_update',async()=>{
  await fixtures(1);
  const c=await pool.connect();try{
   await assert.rejects(c.query("UPDATE musitu.conversations SET handling_mode='BOT'"),e=>e.code==='42501');
   const r=(await seed.query("SELECT pg_get_userbyid(p.proowner) AS owner,p.prosecdef,p.proconfig,r.rolcanlogin,r.rolbypassrls FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid='musitu.resume_ai_assistance(text,uuid,boolean)'::regprocedure")).rows[0];
   assert.equal(r.owner,'musitu_commands');assert.equal(r.prosecdef,true);assert.equal(r.rolcanlogin,false);assert.equal(r.rolbypassrls,false);assert.deepEqual(r.proconfig,['search_path=pg_catalog, musitu','row_security=on']);
  }finally{c.release();}
  return{directUpdateDenied:true,nonloginNonBypassDefiner:true};
 });
 await check('explicit_review_confirmation_is_required',async()=>{
  const [f]=await fixtures(1);await enable();
  for(const v of [false,null])await assert.rejects(command(f.conversationId,v),/AI_RESUMPTION_CONFIRMATION_REQUIRED/);
  assert.equal(await mode(f.conversationId),'HUMAN');assert.equal(await audit(),0);
 });
 await check('disabled_ai_permission_cannot_be_overridden',async()=>{
  const [f]=await fixtures(1);await assert.rejects(command(f.conversationId),/AI_ASSISTANCE_DISABLED/);assert.equal(await mode(f.conversationId),'HUMAN');
 });
 await check('admin_agent_viewer_and_revoked_owner_are_denied',async()=>{
  const [f]=await fixtures(1);await enable();
  for(const role of ['ADMIN','AGENT','VIEWER']){
   const actor='synthetic-'+role;await seed.query("INSERT INTO musitu.memberships VALUES($1,$2,$3,'ACTIVE')",[tenant,actor,role]);
   await assert.rejects(command(f.conversationId,true,actor),/ACCESS_DENIED/);
  }
  await seed.query("INSERT INTO musitu.memberships VALUES($1,'synthetic-revoked','OWNER','REVOKED')",[tenant]);
  await assert.rejects(command(f.conversationId,true,'synthetic-revoked'),/ACCESS_DENIED/);assert.equal(await mode(f.conversationId),'HUMAN');
 });
 await check('missing_foreign_and_invalid_scopes_cannot_resume',async()=>{
  const [f]=await fixtures(1);await enable();
  for(const scope of ['',randomUUID(),'invalid']){
   const c=await pool.connect();try{await c.query('BEGIN');await c.query("SELECT set_config('app.tenant_id',$1,true)",[scope]);await assert.rejects(c.query('SELECT musitu.resume_ai_assistance($1,$2,true)',[owner,f.conversationId]),e=>['P0001','22P02'].includes(e.code));}finally{await c.query('ROLLBACK');c.release();}
  }
  await assert.rejects(command(randomUUID()),/CONVERSATION_NOT_FOUND/);assert.equal(await mode(f.conversationId),'HUMAN');
 });
 await check('customer_opt_out_is_preserved_and_blocks_resumption',async()=>{
  const [f]=await fixtures(1);await enable();
  await seed.query("INSERT INTO musitu.customer_suppressions(tenant_id,conversation_id,phone_number_id,remote_wa_id,source_provider_message_id) SELECT tenant_id,conversation_id,phone_number_id,remote_wa_id,'wamid.SYNTHETIC_OPT_OUT' FROM musitu.conversations WHERE conversation_id=$1",[f.conversationId]);
  await assert.rejects(command(f.conversationId),/CUSTOMER_OPT_OUT/);assert.equal(await mode(f.conversationId),'HUMAN');assert.equal(await audit(),0);
  assert.equal((await seed.query('SELECT count(*)::int AS n FROM musitu.customer_suppressions')).rows[0].n,1);
 });
 await check('confirmed_owner_return_is_review_only_and_idempotent',async()=>{
  const [f]=await fixtures(1);await enable();
  assert.deepEqual(await command(f.conversationId),{conversationId:f.conversationId,mode:'BOT',changed:true,reviewOnly:true,providerDelivery:'NEVER_SUBMITTED'});
  assert.equal((await command(f.conversationId)).changed,false);assert.equal(await audit(),1);assert.equal(await mode(f.conversationId),'BOT');
  assert.equal((await seed.query('SELECT count(*)::int AS n FROM musitu.outbound_attempts')).rows[0].n,0);
 });
 await check('ten_concurrent_owner_returns_make_one_transition_and_audit',async()=>{
  const [f]=await fixtures(1);await enable();const results=await Promise.all(Array.from({length:10},()=>command(f.conversationId)));
  assert.equal(results.filter(x=>x.changed).length,1);assert.equal(await audit(),1);assert.equal(await mode(f.conversationId),'BOT');return{contenders:10,transitions:1,audits:1};
 });
 await check('reserved_and_unknown_ai_requests_remain_closed',async()=>{
  const f=await fixtures(2);await enable();
  await scoped(tenant,owner,['OWNER'],c=>c.query('SELECT musitu.approve_knowledge($1,$2,$3,$4,true)',[owner,randomUUID(),'Synthetic return question','Synthetic approved answer']));
  await command(f[0].conversationId);
  await scoped(tenant,owner,['OWNER'],c=>c.query('SELECT musitu.reserve_ai_draft($1,$2,$3,$4)',[owner,f[0].conversationId,phone,f[0].messageId]));
  await assert.rejects(command(f[1].conversationId),/AI_UNCERTAIN_REQUEST/);
  await seed.query("UPDATE musitu.ai_requests SET state='UNKNOWN'");await assert.rejects(command(f[1].conversationId),/AI_UNCERTAIN_REQUEST/);
  assert.equal((await seed.query('SELECT state FROM musitu.ai_requests')).rows[0].state,'UNKNOWN');assert.equal(await mode(f[1].conversationId),'HUMAN');
 });
 await check('uncertain_outbound_is_unchanged_and_cannot_send_again',async()=>{
  const f=await fixtures(2);await enable();const http=transport({uncertain:true});assert.equal((await http.sender(f[0])).status,'UNKNOWN');
  const before=(await seed.query('SELECT to_jsonb(a) AS row FROM musitu.outbound_attempts a ORDER BY attempt_id')).rows;
  await command(f[0].conversationId);
  assert.deepEqual((await seed.query('SELECT to_jsonb(a) AS row FROM musitu.outbound_attempts a ORDER BY attempt_id')).rows,before);
  await assert.rejects(http.sender(f[1]),/DEVELOPMENT_UNCERTAIN_ATTEMPT/);assert.equal(http.posts,1);return{originalSyntheticPosts:1,resumptionPosts:0,additionalPosts:0};
 });
 await check('session_revocation_before_commit_rolls_back_mode_and_audit',async()=>{
  const [f]=await fixtures(1);await enable();let checks=0;
  const service=createAiResumptionService({scoped});
  await assert.rejects(service({tenantId:tenant,actorId:owner,conversationId:f.conversationId,confirmReviewOnly:true,recheckSession:async()=>{if(++checks===2)throw Error('SESSION_REVOKED');}}),/SESSION_REVOKED/);
  assert.equal(checks,2);assert.equal(await mode(f.conversationId),'HUMAN');assert.equal(await audit(),0);
 });
 return{kind:'NATIVE_AI_RESUMPTION_QUALIFICATION',status:'PASS',passed:results.length,failed:0,results,modelRequests:0,realMetaPosts:0,hostedDatabaseTouched:false};
}
