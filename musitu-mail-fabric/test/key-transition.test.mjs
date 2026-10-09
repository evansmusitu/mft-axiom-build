import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {MailFabric} from '../src/fabric.mjs';
import {generateDemonstrationKeys} from '../src/evidence.mjs';
import {createSimulatedProvider} from '../src/providers.mjs';
import {createKeyTransition,verifyTrustChain,verifyCurrentReceipt,initialTrustHead} from '../src/trust/transitions.mjs';
const pem=k=>k.export({format:'pem',type:'spki'}).toString();
const fixture=async()=>{
 const root=generateDemonstrationKeys(),next=generateDemonstrationKeys(),third=generateDemonstrationKeys();
 const tenantId='regulated-bank';
 const genesis=initialTrustHead(tenantId,pem(root.publicKey));
 const t1=createKeyTransition({tenantId,previousHead:genesis,sequence:1,oldPrivateKey:root.privateKey,oldPublicKey:root.publicKey,newPrivateKey:next.privateKey,newPublicKey:next.publicKey,issuedAt:'2026-10-10T00:00:00.000Z'});
 const head=createHash('sha256').update(JSON.stringify(t1)).digest('hex');
 const ledger=new MailFabric({tenantId,verifiedDomains:['example.org'],allowedRegions:['us-east-1'],provider:createSimulatedProvider()},{keys:next});
 const data={tenantId,from:'sender@example.org',to:'recipient@example.net',subject:'Security notification',text:'Private',kind:'SECURITY',idempotencyKey:'rotation-12345'};
 const proof=(await ledger.submit(data)).proof;
 return {root,next,third,tenantId,genesis,t1,head,proof};
};
test('rotated key verifies a receipt only with separately pinned genesis and chain head',async()=>{
 const f=await fixture();
 assert.equal(verifyTrustChain({tenantId:f.tenantId,rootPublicKey:pem(f.root.publicKey),trustedHead:f.head,transitions:[f.t1]}).currentPublicKey,pem(f.next.publicKey));
 assert.equal(verifyCurrentReceipt(f.proof,{tenantId:f.tenantId,rootPublicKey:pem(f.root.publicKey),trustedHead:f.head,transitions:[f.t1]}),true);
});
test('tampered record, forged new key and wrong root fail closed',async()=>{
 const f=await fixture();
 assert.throws(()=>verifyTrustChain({tenantId:f.tenantId,rootPublicKey:pem(f.third.publicKey),trustedHead:f.head,transitions:[f.t1]}));
 const tampered=structuredClone(f.t1);tampered.statement.newPublicKey=pem(f.third.publicKey);
 assert.throws(()=>verifyTrustChain({tenantId:f.tenantId,rootPublicKey:pem(f.root.publicKey),trustedHead:f.head,transitions:[tampered]}));
 const madeUp={...f.t1,successorSignature:f.t1.predecessorSignature};
 assert.throws(()=>verifyTrustChain({tenantId:f.tenantId,rootPublicKey:pem(f.root.publicKey),trustedHead:f.head,transitions:[madeUp]}));
});
test('offline verifier rejects missing, truncated, reordered and false trust head',async()=>{
 const f=await fixture();
 assert.throws(()=>verifyTrustChain({tenantId:f.tenantId,rootPublicKey:pem(f.root.publicKey),transitions:[f.t1]}));
 assert.throws(()=>verifyTrustChain({tenantId:f.tenantId,rootPublicKey:pem(f.root.publicKey),trustedHead:f.head,transitions:[]}));
 assert.throws(()=>verifyTrustChain({tenantId:f.tenantId,rootPublicKey:pem(f.root.publicKey),trustedHead:'0'.repeat(64),transitions:[f.t1]}));
 assert.throws(()=>verifyTrustChain({tenantId:'other-tenant',rootPublicKey:pem(f.root.publicKey),trustedHead:f.head,transitions:[f.t1]}));
});
test('historical root key cannot issue current receipts after rotation',async()=>{
 const f=await fixture();
 const old=new MailFabric({tenantId:f.tenantId,verifiedDomains:['example.org'],allowedRegions:['us-east-1'],provider:createSimulatedProvider()},{keys:f.root});
 const oldProof=(await old.submit({tenantId:f.tenantId,from:'sender@example.org',to:'recipient@example.net',subject:'Old',text:'Old message',kind:'ACCOUNT',idempotencyKey:'old-key-123456'})).proof;
 assert.equal(verifyCurrentReceipt(oldProof,{tenantId:f.tenantId,rootPublicKey:pem(f.root.publicKey),trustedHead:f.head,transitions:[f.t1]}),false);
});
test('genesis-only receipt verification works only with genesis pinned head',async()=>{
 const f=await fixture();
 const old=new MailFabric({tenantId:f.tenantId,verifiedDomains:['example.org'],allowedRegions:['us-east-1'],provider:createSimulatedProvider()},{keys:f.root});
 const proof=(await old.submit({tenantId:f.tenantId,from:'sender@example.org',to:'recipient@example.net',subject:'Original',text:'Old message',kind:'ACCOUNT',idempotencyKey:'genesis-test-1'})).proof;
 assert.equal(verifyCurrentReceipt(proof,{tenantId:f.tenantId,rootPublicKey:pem(f.root.publicKey),trustedHead:f.genesis,transitions:[]}),true);
});
test('two sequential rotations require the complete ordered chain and the latest key',async()=>{
 const f=await fixture();
 const second=createKeyTransition({tenantId:f.tenantId,previousHead:f.head,sequence:2,
   oldPrivateKey:f.next.privateKey,oldPublicKey:f.next.publicKey,newPrivateKey:f.third.privateKey,newPublicKey:f.third.publicKey,issuedAt:'2026-10-10T01:00:00.000Z'});
 const head=createHash('sha256').update(JSON.stringify(second)).digest('hex');
 const trust={tenantId:f.tenantId,rootPublicKey:pem(f.root.publicKey),trustedHead:head,transitions:[f.t1,second]};
 assert.equal(verifyTrustChain(trust).epoch,2);
 assert.equal(verifyCurrentReceipt(f.proof,trust),false);
 assert.throws(()=>verifyTrustChain({...trust,transitions:[second,f.t1]}));
 const third=new MailFabric({tenantId:f.tenantId,verifiedDomains:['example.org'],allowedRegions:['us-east-1'],provider:createSimulatedProvider()},{keys:f.third});
 const receipt=(await third.submit({tenantId:f.tenantId,from:'sender@example.org',to:'recipient@example.net',subject:'Current',text:'Signed current',kind:'ACCOUNT',idempotencyKey:'third-12345'})).proof;
 assert.equal(verifyCurrentReceipt(receipt,trust),true);
});
