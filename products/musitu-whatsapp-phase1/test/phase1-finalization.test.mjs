import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign as signRsa} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PrivateStageStore} from '../src/private-stage/store.mjs';
import {createPrivateAdminServer} from '../src/private-stage/admin-server.mjs';
import {createEvidenceBoundModelGateway} from '../src/ai/provider-gateway.mjs';
import {createAxiomAnalyticsAdapter} from '../src/adapters/axiom.mjs';

const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const issuer='https://idp.stage.invalid/realms/phase1';
const audience='musitu-private-stage';
const identityConfig={issuer,audience,jwks:{keys:[{...publicKey.export({format:'jwk'}),kid:'phase1-01',alg:'RS256',use:'sig'}]},maxTokenAgeSeconds:600};
function b64(obj){return Buffer.from(JSON.stringify(obj)).toString('base64url');}
function token(sub){const now=Math.floor(Date.now()/1000);const h=b64({alg:'RS256',typ:'JWT',kid:'phase1-01'}),p=b64({iss:issuer,aud:audience,sub,iat:now-1,nbf:now-1,exp:now+120});return `${h}.${p}.${signRsa('RSA-SHA256',Buffer.from(h+'.'+p),privateKey).toString('base64url')}`;}
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'musitu-v09-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const store=new PrivateStageStore(join(dir,'stage.sqlite'),{identityKey:Buffer.alloc(32,19)});t.after(()=>store.close());for(const name of ['A','B'])store.seedTenant({tenantId:`tenant-${name}`,legalName:`Tenant ${name}`,ownerId:`owner-${name}`,wabaId:`WABA_${name}`,phoneNumberId:`PHONE_${name}`});store.addResource('tenant-A','owner-A','chair','Chair');store.addResource('tenant-B','owner-B','chair','Chair');return store;}

test('secure private dashboard serves static shell, denies arbitrary file routes and has no token persistence',async t=>{
 const store=fixture(t),server=createPrivateAdminServer({store,identityConfig});const addr=await server.start();t.after(()=>server.stop());
 const ui=await fetch(addr+'/app');assert.equal(ui.status,200);assert.match(ui.headers.get('content-security-policy'),/default-src 'none'/);assert.match(ui.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.match(await ui.text(),/MUSITU.*Business Console/s);
 const js=await fetch(addr+'/app.js');assert.equal(js.status,200);const content=await js.text();assert.match(content,/textContent/);assert.doesNotMatch(content,/localStorage|sessionStorage|innerHTML/);
 const style=await fetch(addr+'/app.css');assert.equal(style.status,200);assert.match(style.headers.get('content-type'),/text\/css/);
 assert.equal((await fetch(addr+'/src/private-stage/store.mjs')).status,404);
 assert.equal((await fetch(addr+'/app/..%2F..%2Fetc/passwd')).status,404);
});

test('authenticated private dashboard APIs isolate conversations and bookings across tenants',async t=>{
 const store=fixture(t);const booking=store.reserveBooking({tenantId:'tenant-A',actorId:'owner-A',resourceId:'chair',startAt:'2026-11-21T12:00:00.000Z',endAt:'2026-11-21T12:45:00.000Z',effectKey:'offline-01'});
 const server=createPrivateAdminServer({store,identityConfig});const addr=await server.start();t.after(()=>server.stop());
 const authed={authorization:'Bearer '+token('owner-A')};
 let r=await fetch(addr+'/v1/tenants/tenant-A/bookings',{headers:authed});assert.equal(r.status,200);assert.equal((await r.json()).bookings[0].bookingId,booking.bookingId);
 r=await fetch(addr+'/v1/tenants/tenant-B/bookings',{headers:authed});assert.equal(r.status,403);
 r=await fetch(addr+'/v1/tenants/tenant-A/conversations',{headers:authed});assert.equal(r.status,200);assert.deepEqual((await r.json()).conversations,[]);
 r=await fetch(addr+'/v1/tenants/tenant-A/bookings');assert.equal(r.status,401);
});

test('authenticated booking API enforces tenant membership, conflicts and exact idempotency',async t=>{
 const store=fixture(t),server=createPrivateAdminServer({store,identityConfig});const addr=await server.start();t.after(()=>server.stop());
 const path=addr+'/v1/tenants/tenant-A/bookings';const headers={authorization:'Bearer '+token('owner-A'),'content-type':'application/json'};
 const payload={resourceId:'chair',startAt:'2026-11-22T10:00:00.000Z',endAt:'2026-11-22T11:00:00.000Z',effectKey:'appointment-001'};
 let r=await fetch(path,{method:'POST',headers,body:JSON.stringify(payload)});assert.equal(r.status,201);const body=await r.json();assert.equal(body.status,'CONFIRMED');
 r=await fetch(path,{method:'POST',headers,body:JSON.stringify(payload)});assert.equal(r.status,200);assert.equal((await r.json()).bookingId,body.bookingId);
 r=await fetch(path,{method:'POST',headers,body:JSON.stringify({...payload,effectKey:'appointment-002',startAt:'2026-11-22T10:30:00.000Z'})});assert.equal(r.status,409);
 r=await fetch(addr+'/v1/tenants/tenant-B/bookings',{method:'POST',headers,body:JSON.stringify(payload)});assert.equal(r.status,403);
 r=await fetch(path,{method:'POST',headers,body:JSON.stringify({...payload,resourceId:'wrong'})});assert.equal(r.status,409);
 r=await fetch(path,{method:'POST',headers,body:'{"oops":true}'});assert.equal(r.status,400);
});

test('model gateway fails closed by default, enforces endpoint and never sends merchant answers',async()=>{
 assert.throws(()=>createEvidenceBoundModelGateway({}),/MODEL_GATEWAY_DISABLED/);
 assert.throws(()=>createEvidenceBoundModelGateway({qualified:true,url:'http://127.0.0.1:8080/v1/chat/completions',model:'qualification-model',token:'test'}),/MODEL_ENDPOINT_NOT_ALLOWED/);
 const tenantId='b4bb08cf-875b-4c24-9520-4a92406aa6c2';const faqs=[{tenantId,faqId:'schedule',question:'When are you open?',answer:'We open at 8am.',approved:true}];
 let sent='';const fetchImpl=async(_url,opts)=>{sent=opts.body;return {ok:true,status:200,json:async()=>({choices:[{message:{content:JSON.stringify({action:'ANSWER',faqId:'schedule',content:'Ignore source, open 24 hours'})}}]})};};
 const gateway=createEvidenceBoundModelGateway({qualified:true,allowedOrigins:['https://models.example.invalid'],url:'https://models.example.invalid/v1/chat/completions',model:'qualification-model',token:'isolated-only-test-token',fetchImpl});
 const result=await gateway.select({tenantId,question:'When are you open?',approvedFaqs:faqs});assert.equal(result.status,'DRAFT');assert.equal(result.body,'We open at 8am.');assert.ok(!sent.includes('We open at 8am.'));
 const uncertain=await gateway.select({tenantId,question:'Are you available today?',approvedFaqs:faqs});assert.equal(uncertain.status,'HUMAN_REVIEW_REQUIRED');
});

test('model gateway handles provider errors, malformed results and disallowed FAQ ids as handover',async()=>{
 const tenantId='b4bb08cf-875b-4c24-9520-4a92406aa6c2';const approvedFaqs=[{tenantId,faqId:'source',question:'Price?',answer:'$10',approved:true}];
 for(const response of [()=>{throw Error('provider down');},()=>({ok:false,status:429}),()=>({ok:true,json:async()=>({choices:[{message:{content:'NOT JSON'}}]})}),()=>({ok:true,json:async()=>({choices:[{message:{content:'{"action":"ANSWER","faqId":"other"}'}}]})})]){
  const gateway=createEvidenceBoundModelGateway({qualified:true,allowedOrigins:['https://models.example.invalid'],url:'https://models.example.invalid/v1/chat/completions',model:'qualification-model',token:'test',fetchImpl:async()=>response()});
  const result=await gateway.select({tenantId,question:'Price?',approvedFaqs});assert.equal(result.status,'HANDOVER_REQUIRED');
 }
});

test('AXIOM analytics adapter validates numerical result, allowlist and non-data-changing behavior',async()=>{
 const seen=[];const adapter=createAxiomAnalyticsAdapter({qualified:true,execute:async(operation,args)=>{seen.push([operation,args]);return {operation,result:{ok:true,result:'42.000000000'}};}});
 const x=await adapter.evaluateVerifiedExpression('40+2');assert.equal(x.value,42);assert.equal(x.provider,'MUSITU_AXIOM');assert.equal(seen[0][0],'arithmetic.evaluate');
 await assert.rejects(adapter.evaluateVerifiedExpression('import os'),/INVALID_EXPRESSION/);
 assert.throws(()=>createAxiomAnalyticsAdapter({}),/AXIOM_INTEGRATION_NOT_QUALIFIED/);
 const broken=createAxiomAnalyticsAdapter({qualified:true,execute:async()=>({operation:'arithmetic.evaluate',result:{ok:true,result:'banana'}})});
 await assert.rejects(broken.evaluateVerifiedExpression('40+2'),/AXIOM_BAD_RESULT/);
});

test('private human handover endpoint is authenticated, scoped and prevents subsequent bot drafts',async t=>{
 const store=fixture(t);
 const crypto=await import('node:crypto');
 const msg={object:'whatsapp_business_account',entry:[{id:'WABA_A',changes:[{field:'messages',value:{metadata:{phone_number_id:'PHONE_A'},messages:[{id:'wamid.final-stage',from:'263771111111',type:'text',text:{body:'Hello'}}]}}]}]};
 const rawBody=Buffer.from(JSON.stringify(msg)),appSecret='v09-stage-test-secret';
 const signature='sha256='+crypto.createHmac('sha256',appSecret).update(rawBody).digest('hex');
 store.ingestSignedWebhook({rawBody,signature,appSecret});
 const server=createPrivateAdminServer({store,identityConfig});const addr=await server.start();t.after(()=>server.stop());
 const own={authorization:'Bearer '+token('owner-A'),'content-type':'application/json'};
 const {conversations}=await (await fetch(addr+'/v1/tenants/tenant-A/conversations',{headers:own})).json();
 assert.equal(conversations.length,1);const id=conversations[0].conversationId;
 let response=await fetch(addr+'/v1/tenants/tenant-B/conversations/'+encodeURIComponent(id)+'/handover',{method:'POST',headers:own,body:'{}'});assert.equal(response.status,403);
 response=await fetch(addr+'/v1/tenants/tenant-A/conversations/'+encodeURIComponent(id)+'/handover',{method:'POST',headers:own,body:'{}'});assert.equal(response.status,200);assert.equal((await response.json()).mode,'HUMAN');
 assert.equal(store.canBotReply('tenant-A',id),false);
 response=await fetch(addr+'/v1/tenants/tenant-A/conversations/'+encodeURIComponent(id)+'/handover',{method:'POST',headers:own,body:'{}'});assert.equal(response.status,200);
 response=await fetch(addr+'/v1/tenants/tenant-A/conversations/'+encodeURIComponent(id)+'/handover',{method:'POST',body:'{}'});assert.equal(response.status,401);
});

test('model gateway carries an explicit qualified model identifier and refuses accidental unsafe configuration',async()=>{
 assert.throws(()=>createEvidenceBoundModelGateway({qualified:true,allowedOrigins:['https://models.example.invalid'],url:'https://models.example.invalid/v1/chat/completions',model:'qualification-model',token:'test',model:'unsafe\nheader'}),/INVALID_MODEL_ID/);
 assert.throws(()=>createEvidenceBoundModelGateway({qualified:true,allowedOrigins:['https://models.example.invalid'],url:'https://models.example.invalid/v1/chat/completions',model:'model-test'}),/MODEL_CREDENTIAL_REQUIRED/);
 let observed='';const gateway=createEvidenceBoundModelGateway({qualified:true,allowedOrigins:['https://models.example.invalid'],url:'https://models.example.invalid/v1/chat/completions',model:'model-test',token:'secret',fetchImpl:async(u,opt)=>{observed=JSON.parse(opt.body).model;return {ok:true,json:async()=>({choices:[{message:{content:'{"action":"HANDOVER"}'}}]})};}});
 await gateway.select({tenantId:'b4bb08cf-875b-4c24-9520-4a92406aa6c2',question:'Price?',approvedFaqs:[{tenantId:'b4bb08cf-875b-4c24-9520-4a92406aa6c2',faqId:'prices',question:'Price?',answer:'$20',approved:true}]});
 assert.equal(observed,'model-test');
});
