import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {DatabaseSync} from 'node:sqlite';import {randomBytes} from 'node:crypto';
import {createD1Compat} from './helpers/sqlite-d1.mjs';import {generateDemonstrationKeys} from '../src/evidence.mjs';import {createSimulatedProvider} from '../src/providers.mjs';import {DurableMailFabric} from '../src/durable/fabric.mjs';
test('atomic recipient-specific ceiling cannot be bypassed by competing submission or restart',async t=>{
 const d=new DatabaseSync(':memory:');d.exec(readFileSync(new URL('../src/durable/schema.sql',import.meta.url),'utf8'));t.after(()=>d.close());
 const config={tenantId:'tenant1',verifiedDomains:['example.org'],allowedRegions:['us-east-1'],provider:createSimulatedProvider(),dailySendLimit:100,dailyRecipientLimit:2};
 const keys=generateDemonstrationKeys(),encryptionKey=randomBytes(32),privacyKey=randomBytes(32),db=createD1Compat(d),now=()=>Date.parse('2026-10-10T15:00:00Z');
 const create=()=>new DurableMailFabric(config,{db,keys,encryptionKey,privacyKey,now});
 const mail=i=>({tenantId:'tenant1',from:'notice@example.org',to:'person@example.net',kind:'ACCOUNT',subject:'Verification',text:'This is a transactional notice',idempotencyKey:'notice-'+String(i).padStart(8,'0')});
 const results=await Promise.allSettled(Array.from({length:12},(_,i)=>create().enqueue(mail(i))));
 assert.equal(results.filter(x=>x.status==='fulfilled').length,2);
 assert.equal(results.filter(x=>x.status==='rejected'&&x.reason.code==='QUOTA_EXCEEDED').length,10);
 assert.equal(d.prepare('SELECT COUNT(*) n FROM mail_messages').get().n,2);
 const winningIndex=results.findIndex(x=>x.status==='fulfilled');
 assert.ok(winningIndex>=0);
 assert.equal((await create().enqueue(mail(winningIndex))).state,'QUEUED');
 assert.equal((await create().enqueue({...mail(13),to:'different@example.net'})).state,'QUEUED');
});
