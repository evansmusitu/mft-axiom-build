import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createD1Compat} from './helpers/sqlite-d1.mjs';
import {SenderRegistry,SenderVerificationError} from '../src/security/sender-ownership.mjs';
const t0=Date.parse('2026-10-10T04:00:00Z');
function fixture(t){
 const d=new DatabaseSync(':memory:');d.exec(readFileSync(new URL('../src/durable/schema.sql',import.meta.url),'utf8'));
 t.after(()=>d.close());return {db:createD1Compat(d),d};
}
test('sender ownership requires authenticated DNS TXT challenge and expires',async t=>{
 const {db}=fixture(t),keys=[];let clock=t0;
 const r=new SenderRegistry({db,tenantId:'client1',now:()=>clock,resolver:async name=>{assert.equal(name,'_mmf-verify.email.example.org');return keys;}});
 const challenge=await r.issue('email.example.org');
 assert.match(challenge.txtValue,/^musitu-mail-fabric-v1=/);
 assert.equal(await r.isVerified('email.example.org'),false);
 keys.push(challenge.txtValue);
 assert.deepEqual(await r.verify('email.example.org'),{verified:true});
 assert.equal(await r.isVerified('email.example.org'),true);
 const repeat=await r.verify('email.example.org');assert.equal(repeat.verified,true);
 clock=t0+91*86400_000;assert.equal(await r.isVerified('email.example.org'),false);
});
test('unverified forged DNS, challenge expiry and malformed domains fail closed',async t=>{
 const {db}=fixture(t);let clock=t0;let records=[];
 const r=new SenderRegistry({db,tenantId:'client1',now:()=>clock,resolver:async()=>records});
 await assert.rejects(()=>r.issue('localhost'),{code:'INVALID_DOMAIN'});
 await assert.rejects(()=>r.issue('example.org/path'),{code:'INVALID_DOMAIN'});
 await assert.rejects(()=>r.issue('10.0.0.1'),{code:'INVALID_DOMAIN'});
 await assert.rejects(()=>r.verify('example.org'),{code:'CHALLENGE_NOT_FOUND'});
 const a=await r.issue('example.org');records=['"musitu-mail-fabric-v1=fake"'];
 await assert.rejects(()=>r.verify('example.org'),{code:'DNS_CHALLENGE_MISMATCH'});
 clock+=3700_000;records=[a.txtValue];
 await assert.rejects(()=>r.verify('example.org'),{code:'CHALLENGE_EXPIRED'});
});
test('tenant isolation and revocation cannot inherit verified sender',async t=>{
 const {db}=fixture(t);let proof=[];
 const a=new SenderRegistry({db,tenantId:'client1',now:()=>t0,resolver:async()=>proof});
 const b=new SenderRegistry({db,tenantId:'client2',now:()=>t0,resolver:async()=>proof});
 const c=await a.issue('example.org');proof=[c.txtValue];await a.verify('example.org');
 assert.equal(await b.isVerified('example.org'),false);
 await a.revoke('example.org');assert.equal(await a.isVerified('example.org'),false);
});
test('resolver outage never creates a verified sender',async t=>{
 const {db}=fixture(t);
 const a=new SenderRegistry({db,tenantId:'client1',now:()=>t0,resolver:async()=>{throw Error('dns timeout')}});
 await a.issue('example.org');
 await assert.rejects(()=>a.verify('example.org'),{code:'DNS_UNAVAILABLE'});
 assert.equal(await a.isVerified('example.org'),false);
});
