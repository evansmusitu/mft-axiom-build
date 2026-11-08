import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHmac} from 'node:crypto';
import {PrivateStageStore} from '../src/private-stage/store.mjs';
const key=Buffer.alloc(32,53),secret='synthetic-stage-traffic-test';
function sign(p){const rawBody=Buffer.from(JSON.stringify(p));return {rawBody,appSecret:secret,signature:'sha256='+createHmac('sha256',secret).update(rawBody).digest('hex')};}
const msg=(i,text='Hello')=>({id:`wamid.synthetic-${i}`,from:'263771111111',type:'text',text:{body:text}});
const payload=messages=>({object:'whatsapp_business_account',entry:[{id:'WABA_A',changes:[{field:'messages',value:{metadata:{phone_number_id:'PHONE_A'},messages}}]}]});
function setup(t){const dir=mkdtempSync(join(tmpdir(),'stage-webhook-limit-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const store=new PrivateStageStore(join(dir,'stage.sqlite'),{identityKey:key});t.after(()=>store.close());store.seedTenant({tenantId:'tenant-A',legalName:'Test',ownerId:'owner-A',wabaId:'WABA_A',phoneNumberId:'PHONE_A'});return store;}
test('signed 256 KiB oversize payload fails before local persistence',t=>{
 const store=setup(t);
 assert.throws(()=>store.ingestSignedWebhook(sign(payload([msg(1,'A'.repeat(270000))]))),/WEBHOOK_BODY_LIMIT/);
 assert.equal(store.snapshot('tenant-A','owner-A').inquiries,0);
});
test('signed 51 event batch fails atomically instead of expanding work without limit',t=>{
 const store=setup(t);const args=sign(payload(Array.from({length:51},(_,i)=>msg(i))));
 assert.throws(()=>store.ingestSignedWebhook(args),/WEBHOOK_EVENT_LIMIT/);
 assert.equal(store.snapshot('tenant-A','owner-A').inquiries,0);
});
