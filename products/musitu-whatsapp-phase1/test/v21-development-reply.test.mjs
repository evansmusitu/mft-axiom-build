import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createDevelopmentReplySender} from '../src/staging/development-reply.mjs';
import {encryptLedger} from '../src/security/ledger-encryption.mjs';
const tenant='986eb904-7296-46a9-9e9b-94074db9b547',owner='395558180472062118';
const conversation='11111111-1111-4111-8111-111111111111',attempt='22222222-2222-4222-8222-222222222222';
const key=Buffer.alloc(32,4),phone='1292923853915392',recipient='19999990001',remote='hmac256:'+'a'.repeat(64),body='MUSITU controlled test reply.';
const sha=s=>createHash('sha256').update(s).digest('hex');
const input={tenantId:tenant,actorId:owner,conversationId:conversation,messageId:'wamid.test',requestKey:'review-key',body,approveText:true,confirmOwnNumber:true};
function fixture(overrides={}){
 const calls=[],db=[];let checks=0;
 const reserved={admitted:true,attemptId:attempt,phoneNumberId:phone,recipientHash:remote,encryptedRecipient:encryptLedger(recipient,key,[tenant,phone,'contact:'+remote]),encryptedBody:encryptLedger(body,key,[tenant,phone,attempt]),bodyDigest:sha(body)};
 const scoped=async(t,a,roles,work)=>work({query:async(sql,args)=>{db.push({sql,args});if(sql.includes('reserve_development_reply'))return{rows:[{result:{...reserved,attemptId:args[4],encryptedBody:args[5],...overrides.reserved}}]};if(overrides.completionError)throw Error('DB_OUTCOME_UNKNOWN');return{rows:[{result:{status:'ACCEPTED'}}]};}});
 const request=async(url,options)=>{calls.push({url,options});if(url.endsWith('/app?fields=id'))return Response.json({id:overrides.app??'1096094346481018'});if(url.includes('/phone_numbers?fields=id'))return Response.json({data:[{id:phone}]});if(overrides.transportError)throw Error('sensitive raw provider error');if(overrides.response)return overrides.response();return Response.json({messaging_product:'whatsapp',contacts:[{wa_id:recipient}],messages:[{id:'wamid.reply'}]});};
 const sender=createDevelopmentReplySender({scoped,token:'EAA'+'A'.repeat(40),enabled:true,contentKey:key,recipientSha256:sha(recipient),request,...overrides.config});
 return{sender,calls,db,get checks(){return checks;},run:(extra={})=>sender({...input,recheckSession:async()=>{checks++;if(overrides.sessionError&&checks===2)throw Error('SESSION_REVOKED');},...extra})};
}
test('development reply needs exact scope, owner, explicit text approval and self-test consent',async()=>{
 for(const change of [{tenantId:conversation},{actorId:'agent'},{approveText:false},{confirmOwnNumber:false},{body:' '},{requestKey:''},{recipientWaId:recipient}]){const f=fixture();await assert.rejects(f.run(change),/DEVELOPMENT_REPLY_REJECTED/);assert.equal(f.calls.length,0);assert.equal(f.db.length,0);}
 const f=fixture({config:{enabled:false}});await assert.rejects(f.run(),/DEVELOPMENT_SENDING_DISABLED/);assert.equal(f.calls.length,0);
});
test('issuer mismatch or revoked session prevents reservation and provider POST',async()=>{
 const wrong=fixture({app:'1775810357073694'});await assert.rejects(wrong.run(),/META_APP_ID_REJECTED/);assert.equal(wrong.calls.length,1);assert.equal(wrong.db.length,0);
 const revoked=fixture({sessionError:true});await assert.rejects(revoked.run(),/SESSION_REVOKED/);assert.equal(revoked.db.length,0);assert.equal(revoked.calls.filter(x=>x.options.method==='POST').length,0);
});
test('committed reservation precedes exactly one fixed-endpoint POST and sanitized outcome',async()=>{
 const f=fixture();const r=await f.run();assert.equal(r.status,'ACCEPTED');assert.equal(r.automaticRetry,false);assert.equal(f.checks,2);
 assert.equal(f.db.length,2);assert.match(f.db[0].sql,/reserve_development_reply/);assert.match(f.db[1].sql,/complete_development_reply/);
 const posts=f.calls.filter(x=>x.options.method==='POST');assert.equal(posts.length,1);assert.equal(posts[0].url,'https://graph.facebook.com/v25.0/1292923853915392/messages');assert.equal(posts[0].options.redirect,'error');assert.equal(posts[0].options.headers.authorization,'Bearer EAA'+'A'.repeat(40));
 assert.deepEqual(JSON.parse(posts[0].options.body),{messaging_product:'whatsapp',to:recipient,type:'text',text:{body,preview_url:false}});
 assert.ok(!JSON.stringify(r).includes(recipient));assert.ok(!JSON.stringify(r).includes('wamid.reply'));assert.ok(!JSON.stringify(r).includes(body));
});
test('a consumed reservation can never issue another POST',async()=>{
 const f=fixture({reserved:{admitted:false,status:'UNKNOWN'}});const r=await f.run();assert.equal(r.status,'UNKNOWN');assert.equal(r.idempotent,true);assert.equal(r.automaticRetry,false);assert.equal(f.calls.filter(x=>x.options.method==='POST').length,0);
});
test('uncertain, oversized, redirected or invalid provider outcomes stay UNKNOWN without retry',async()=>{
 for(const o of [{transportError:true},{response:()=>Response.json({error:{code:4}},{status:429})},{response:()=>new Response('x'.repeat(17000))},{response:()=>Response.json({messaging_product:'whatsapp',contacts:[{wa_id:'19999990002'}],messages:[{id:'wamid.other'}]})}]){
  const f=fixture(o);const r=await f.run();assert.equal(r.status,'UNKNOWN');assert.equal(r.automaticRetry,false);assert.equal(f.calls.filter(x=>x.options.method==='POST').length,1);assert.equal(f.db[1].args[2],'UNKNOWN');assert.equal(f.db[1].args[3],null);
 }
});
test('tampered recipient or approved content fails after reservation but before POST',async()=>{
 for(const o of [{config:{recipientSha256:sha('19999990002')}},{reserved:{bodyDigest:'0'.repeat(64)}},{reserved:{encryptedRecipient:'v1.tampered'}},{reserved:{phoneNumberId:'999999999999'}}]){const f=fixture(o);await assert.rejects(f.run(),/DEVELOPMENT_BINDING_REJECTED/);assert.equal(f.calls.filter(x=>x.options.method==='POST').length,0);}
});
test('reservation failure or uncertain commit prevents provider submission',async()=>{
 const f=fixture({config:{scoped:async()=>{throw Error('COMMIT_UNKNOWN');}}});await assert.rejects(f.run(),/COMMIT_UNKNOWN/);assert.equal(f.calls.filter(x=>x.options.method==='POST').length,0);
});
test('provider rejection is recorded once and completion failure stays uncertain',async()=>{
 const reject=fixture({response:()=>Response.json({error:{code:131030}},{status:400})});assert.equal((await reject.run()).status,'FAILED');assert.equal(reject.db[1].args[4],400);
 const lost=fixture({completionError:true});
 const r=await lost.run();assert.equal(r.status,'UNKNOWN');assert.equal(r.outcomeRecorded,false);assert.equal(lost.calls.filter(x=>x.options.method==='POST').length,1);
});
