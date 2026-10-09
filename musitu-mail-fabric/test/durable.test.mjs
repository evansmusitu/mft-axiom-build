import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {DurableMailFabric} from '../src/durable/fabric.mjs';
import {createD1Compat} from './helpers/sqlite-d1.mjs';
import {createSimulatedProvider} from '../src/providers.mjs';
import {generateDemonstrationKeys,verifyProof} from '../src/evidence.mjs';
const message={tenantId:'client1',from:'alerts@example.org',to:'customer@example.net',subject:'Account alert',text:'Test private message',kind:'SECURITY',idempotencyKey:'event-000001'};
const config=provider=>({tenantId:'client1',verifiedDomains:['example.org'],allowedRegions:['us-east-1'],provider});
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'musitu-durable-'));
 const file=join(dir,'queue.sqlite');const secret=randomBytes(32),privacyKey=randomBytes(32),keys=generateDemonstrationKeys();
 const db=()=>{const real=new DatabaseSync(file);return {real,d1:createD1Compat(real)};};
 const cleanup=()=>rmSync(dir,{force:true,recursive:true});
 return {file,secret,privacyKey,keys,db,cleanup};
}
const make=(f,d1,p,now)=>new DurableMailFabric(config(p),{db:d1,encryptionKey:f.secret,keys:f.keys,privacyKey:f.privacyKey,now});
test('durable queue survives restart; encrypted at rest; signed provider acknowledgment',async t=>{
 const f=fixture();t.after(f.cleanup);const p=createSimulatedProvider(),d=f.db();
 d.real.exec(readFileSync(new URL('../src/durable/schema.sql',import.meta.url),'utf8'));
 const producer=make(f,d.d1,p);const enqueued=await producer.enqueue(message);
 assert.equal(enqueued.state,'QUEUED');assert.equal(p.attempts,0);
 const bytes=readFileSync(f.file);assert.equal(bytes.includes(Buffer.from(message.text)),false);assert.equal(bytes.includes(Buffer.from(message.to)),false);
 d.real.close();const restarted=f.db();const consumer=make(f,restarted.d1,p);
 const completed=await consumer.processNext();assert.equal(completed.state,'ACCEPTED_BY_PROVIDER');assert.equal(p.attempts,1);
 assert.equal(verifyProof(completed.proof,{trustedPublicKey:completed.proof.publicKey}),true);
 assert.equal(JSON.stringify(completed).includes(message.to),false);restarted.real.close();
});
test('atomic idempotency under concurrent producers and consumers',async t=>{
 const f=fixture();t.after(f.cleanup);const a=f.db(),b=f.db(),provider=createSimulatedProvider();
 a.real.exec(readFileSync(new URL('../src/durable/schema.sql',import.meta.url),'utf8'));
 const fa=make(f,a.d1,provider),fb=make(f,b.d1,provider);
 const rows=await Promise.all([fa.enqueue(message),fb.enqueue({...message})]);
 assert.equal(rows[0].messageId,rows[1].messageId);
 await assert.rejects(()=>fa.enqueue({...message,text:'changed'}),{code:'IDEMPOTENCY_CONFLICT'});
 const results=await Promise.all([fa.processNext(),fb.processNext()]);
 assert.equal(provider.attempts,1);assert.equal(results.filter(r=>r?.state==='ACCEPTED_BY_PROVIDER').length,1);
 a.real.close();b.real.close();
});
test('expired in-flight work never resends automatically',async t=>{
 const f=fixture();t.after(f.cleanup);const d=f.db(),p=createSimulatedProvider();d.real.exec(readFileSync(new URL('../src/durable/schema.sql',import.meta.url),'utf8'));
 let time=1000000;const q=make(f,d.d1,p,()=>time);
 const item=await q.enqueue(message);await q.claim(item.messageId);
 time+=180000;const expired=await q.reconcileExpired();assert.equal(expired,1);
 assert.equal((await q.get(item.messageId,'client1')).state,'OUTCOME_UNKNOWN');
 assert.equal(await q.processNext(),null);assert.equal(p.attempts,0);d.real.close();
});
test('wrong encryption key never produces an outbound message',async t=>{
 const f=fixture();t.after(f.cleanup);const d=f.db(),p=createSimulatedProvider();d.real.exec(readFileSync(new URL('../src/durable/schema.sql',import.meta.url),'utf8'));
 const ok=make(f,d.d1,p),item=await ok.enqueue(message);
 const other=new DurableMailFabric(config(p),{db:d.d1,encryptionKey:randomBytes(32),keys:f.keys,privacyKey:f.privacyKey});
 const out=await other.processNext();assert.equal(out.state,'OUTCOME_UNKNOWN');assert.equal(p.attempts,0);
 assert.equal((await ok.get(item.messageId,'client1')).state,'OUTCOME_UNKNOWN');d.real.close();
});
test('durable suppression follows account across restarts and prevents queued sends',async t=>{
 const f=fixture();t.after(f.cleanup);const a=f.db(),p=createSimulatedProvider();
 a.real.exec(readFileSync(new URL('../src/durable/schema.sql',import.meta.url),'utf8'));
 const producer=make(f,a.d1,p);const item=await producer.enqueue(message);
 await producer.suppress(message.to);a.real.close();
 const b=f.db(),consumer=make(f,b.d1,p);
 await assert.rejects(()=>consumer.enqueue({...message,idempotencyKey:'event-000002'}),{code:'RECIPIENT_SUPPRESSED'});
 const result=await consumer.processNext();
 assert.equal(result.state,'BLOCKED_BY_POLICY');assert.equal(p.attempts,0);
 assert.equal((await consumer.get(item.messageId,'client1')).state,'BLOCKED_BY_POLICY');b.real.close();
});
test('processing is tenant-scoped: one tenant cannot claim another tenant\'s queue',async t=>{
 const f=fixture();t.after(f.cleanup);const d=f.db(),pA=createSimulatedProvider(),pB=createSimulatedProvider();
 d.real.exec(readFileSync(new URL('../src/durable/schema.sql',import.meta.url),'utf8'));
 const A=make(f,d.d1,pA);
 const B=new DurableMailFabric({...config(pB),tenantId:'client2'}, {db:d.d1,encryptionKey:f.secret,keys:f.keys,privacyKey:f.privacyKey});
 const item=await B.enqueue({...message,tenantId:'client2'});
 assert.equal(await A.processNext(),null);
 assert.equal(pA.attempts,0);
 assert.equal((await B.processNext()).state,'ACCEPTED_BY_PROVIDER');
 assert.equal(pB.attempts,1);
 assert.equal(await A.get(item.messageId,'client1'),null);d.real.close();
});
