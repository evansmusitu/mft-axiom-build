import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHmac,generateKeyPairSync,sign} from 'node:crypto';
import {PrivateStageStore} from '../src/private-stage/store.mjs';
import {createPrivateAdminServer} from '../src/private-stage/admin-server.mjs';
const KEY=Buffer.alloc(32,150),META='offline-manual-test';
function signed(text='Hours?',sender='263770012345',id='wamid.manual.1'){
 const payload={object:'whatsapp_business_account',entry:[{id:'WABA_A',changes:[{field:'messages',value:{metadata:{phone_number_id:'PHONE_A'},messages:[{id,from:sender,type:'text',text:{body:text}}]}}]}]};
 const rawBody=Buffer.from(JSON.stringify(payload));return {rawBody,signature:'sha256='+createHmac('sha256',META).update(rawBody).digest('hex'),appSecret:META};
}
function stage(t){const dir=mkdtempSync(join(tmpdir(),'wa-manual-suppress-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const store=new PrivateStageStore(join(dir,'stage.sqlite'),{identityKey:KEY});t.after(()=>store.close());
 store.seedTenant({tenantId:'tenant-A',legalName:'A',ownerId:'owner-A',wabaId:'WABA_A',phoneNumberId:'PHONE_A'});
 store.seedTenant({tenantId:'tenant-B',legalName:'B',ownerId:'owner-B',wabaId:'WABA_B',phoneNumberId:'PHONE_B'});
 const receipt=store.ingestSignedWebhook(signed())[0];
 store.putFaq('tenant-A','owner-A','faq','Hours?','Open at 8');
 store.draftApprovedFaqReply({tenantId:'tenant-A',actorId:'owner-A',conversationId:receipt.conversationId,question:'Hours?',effectKey:'draft-before-request'});
 return {store,conversationId:receipt.conversationId};
}
function identity(){const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});const issuer='https://id.example.invalid/realms/offline',audience='offline-console';
 const config={issuer,audience,maxTokenAgeSeconds:300,jwks:{keys:[{...publicKey.export({format:'jwk'}),kid:'kid-15',alg:'RS256',use:'sig'}]}};
 const enc=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
 return {config,token(actorId){const now=Math.floor(Date.now()/1000),input=enc({alg:'RS256',typ:'JWT',kid:'kid-15'})+'.'+enc({iss:issuer,aud:audience,sub:actorId,iat:now-1,exp:now+120,nbf:now-1});return input+'.'+sign('RSA-SHA256',Buffer.from(input),privateKey).toString('base64url');}};
}

test('authenticated staff can record a customer opt-out reported outside WhatsApp; exact retries are idempotent',t=>{
 const {store,conversationId}=stage(t);
 const args={tenantId:'tenant-A',actorId:'owner-A',conversationId,reason:'CUSTOMER_REQUEST'};
 const first=store.suppressConversation(args);
 assert.equal(first.suppressed,true);assert.equal(first.idempotent,false);
 const repeat=store.suppressConversation(args);assert.equal(repeat.idempotent,true);
 assert.equal(store.canBotReply('tenant-A',conversationId),false);
 assert.equal(store.listReplyDrafts('tenant-A','owner-A')[0].status,'SUPPRESSED');
 assert.equal(store.listActionAudit('tenant-A','owner-A').filter(e=>e.action==='CUSTOMER_OPT_OUT_RECORDED').length,1);
});

test('wrong member or tenant and unknown conversation are rejected; no unsuppress operation exists',t=>{
 const {store,conversationId}=stage(t);
 assert.throws(()=>store.suppressConversation({tenantId:'tenant-A',actorId:'owner-B',conversationId,reason:'CUSTOMER_REQUEST'}),/ACCESS_DENIED/);
 assert.throws(()=>store.suppressConversation({tenantId:'tenant-B',actorId:'owner-B',conversationId,reason:'CUSTOMER_REQUEST'}),/CONVERSATION_NOT_FOUND/);
 assert.throws(()=>store.suppressConversation({tenantId:'tenant-A',actorId:'owner-A',conversationId,reason:'marketing'}),/INVALID_REASON/);
 assert.equal(store.canBotReply('tenant-A',conversationId),true);
});

test('private HTTP requires pinned JWT and explicit reason; never offers a revoke-suppression endpoint',async t=>{
 const {store,conversationId}=stage(t),auth=identity();const server=createPrivateAdminServer({store,identityConfig:auth.config});
 const url=await server.start();t.after(()=>server.stop());
 const action=url+`/v1/tenants/tenant-A/conversations/${conversationId}/suppress`;
 const options=(actorId,body)=>({method:'POST',headers:{authorization:`Bearer ${auth.token(actorId)}`,'content-type':'application/json'},body:JSON.stringify(body)});
 const missing=await fetch(action,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});assert.equal(missing.status,401);
 const other=await fetch(action,options('owner-B',{reason:'CUSTOMER_REQUEST'}));assert.equal(other.status,403);
 const invalid=await fetch(action,options('owner-A',{reason:'marketing'}));assert.equal(invalid.status,400);
 const first=await fetch(action,options('owner-A',{reason:'CUSTOMER_REQUEST'}));assert.equal(first.status,201);
 assert.equal((await first.json()).suppressed,true);
 const repeat=await fetch(action,options('owner-A',{reason:'CUSTOMER_REQUEST'}));assert.equal(repeat.status,200);
 assert.equal((await fetch(action.replace('/suppress','/unsuppress'),options('owner-A',{}))).status,404);
});
