import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {draftMmfFmiPaynowQuote,canonicalMmfPaymentClaim,MMF_PREPARATION_SKU} from '../src/commercial/fmi-paynow-reuse.mjs';
import {ensureMmfPaymentTables,openMmfPreparationOrder,reconcileMmfSandboxSettlement} from '../src/commercial/mmf-order-ledger.mjs';
const useDb=()=>{
 const sqlite=new DatabaseSync(':memory:');
 return {db:{prepare(sql){return {bind(...args){const q=sqlite.prepare(sql);return {
  async run(){const z=q.run(...args);return {success:true,meta:{changes:Number(z.changes)}};},
  async first(){return q.get(...args)??null;}
 };},async run(){const z=sqlite.prepare(sql).run();return {success:true,meta:{changes:Number(z.changes)}};}};}},close(){sqlite.close()}};
};
const env={MMF_STAGE_ONLY:'true',MMF_REAL_SEND_ENABLED:'false',MMF_COMMERCE_ENABLED:'false'};
const data={tenantId:'mail_tenant',customerReference:'customer:allowed:001',contractReference:'contract:approved:123',orderReference:'MMF-AAAAAABBBBBB'};
const quote=draftMmfFmiPaynowQuote(data),time=Date.UTC(2026,9,11,7,0);
const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const publicKeyPem=publicKey.export({type:'spki',format:'pem'});
const fingerprint=createHash('sha256').update(publicKey.export({type:'spki',format:'der'})).digest('hex');
const verification={publicKeyPem,fingerprint,nowMs:time};
const claim=q=>({schema:'mmf-paynow-settlement-v1',product:MMF_PREPARATION_SKU.product,sku:MMF_PREPARATION_SKU.sku,
 tenantId:q.tenantId,orderReference:q.orderReference,contractReference:q.contractReference,
 provider:'paynow',paymentAuthority:'mft-phase8-external-authority',providerReferenceSha256:'a'.repeat(64),
 amountCents:9900,currency:'USD',status:'paid',settledAtMs:time});
const envelop=c=>({claim:c,signature:sign(null,canonicalMmfPaymentClaim(c),privateKey).toString('base64url')});
test('MMF separate SQLite store records internal pending intent only, idempotently, never starts money or mail',async()=>{
 const x=useDb();try{
  await ensureMmfPaymentTables(x.db);
  await assert.rejects(()=>openMmfPreparationOrder({db:x.db,quote,nowMs:time}),/DENIED/);
  const a=await openMmfPreparationOrder({db:x.db,quote,env,nowMs:time});
  assert.equal(a.status,'PENDING');assert.equal(a.grantsMailSending,false);assert.equal(a.externalCheckoutCreated,false);
  const b=await openMmfPreparationOrder({db:x.db,quote,env,nowMs:time+1});
  assert.equal(b.status,'PENDING');assert.equal(b.idempotent,true);
  await assert.rejects(()=>openMmfPreparationOrder({db:x.db,quote:{...quote,amountCents:14900},env,nowMs:time}),/DENIED/);
 }finally{x.close()}
});
test('an offline signed synthetic settlement is idempotent, order and provider-reference unique, grants no mail sending',async()=>{
 const x=useDb();try{
  await ensureMmfPaymentTables(x.db);await openMmfPreparationOrder({db:x.db,quote,env,nowMs:time});
  const receipt=envelop(claim(quote));
  const first=await reconcileMmfSandboxSettlement({db:x.db,quote,receipt,verification,env});
  assert.equal(first.status,'SANDBOX_SETTLEMENT_RECORD_ONLY');assert.equal(first.idempotent,false);assert.equal(first.grantsMailSending,false);
  assert.equal(first.realProviderSettlementVerified,false);
  const second=await reconcileMmfSandboxSettlement({db:x.db,quote,receipt,verification,env});
  assert.equal(second.idempotent,true);
  const other=draftMmfFmiPaynowQuote({...data,tenantId:'another_tenant',orderReference:'MMF-CCCXXXDDDDDD'});
  await openMmfPreparationOrder({db:x.db,quote:other,env,nowMs:time});
  await assert.rejects(()=>reconcileMmfSandboxSettlement({db:x.db,quote:other,receipt:envelop(claim(other)),verification,env}),/DENIED/);
 }finally{x.close()}
});
test('refund/pending spoof, missing stage lock or mutated claim never affects the ledger',async()=>{
 const x=useDb();try{
  await ensureMmfPaymentTables(x.db);await openMmfPreparationOrder({db:x.db,quote,env,nowMs:time});
  for(const wrong of [{...env,MMF_COMMERCE_ENABLED:'true'},{...env,MMF_STAGE_ONLY:'false'},
   {...env,MMF_REAL_SEND_ENABLED:'true'},{}]){
   await assert.rejects(()=>reconcileMmfSandboxSettlement({db:x.db,quote,receipt:envelop(claim(quote)),verification,env:wrong}),/DENIED/);
  }
  await assert.rejects(()=>reconcileMmfSandboxSettlement({db:x.db,quote,receipt:{claim:{...claim(quote),status:'pending'},signature:'bad'},verification,env}),/DENIED/);
  assert.equal((await x.db.prepare('SELECT state FROM mmf_prep_orders WHERE order_reference=?').bind(quote.orderReference).first()).state,'PENDING');
 }finally{x.close()}
});
