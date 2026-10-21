import test from 'node:test';
import assert from 'node:assert/strict';
import {createStoreNeonD1Adapter,requireDisabledStoreNeonStaging} from './store-neon-db-adapter.mjs';

function client(){
 const calls=[];
 const sql={
  calls,
  query(statement,params,opts={}){
   calls.push({kind:'query',statement,params,opts});
   if(statement.includes('store_products'))return Promise.resolve({
     rows:[{sku:'MUSITU_OWNED_APP',amount_cents:425}],rowCount:1
   });
   return Promise.resolve({rows:[],rowCount:1});
  },
  async transaction(promises,options){
   calls.push({kind:'transaction',count:promises.length,options});
   return Promise.all(promises);
  }
 };
 return sql;
}
test('Neon adapter parameterizes customer token and Store product lookups',async()=>{
 const sql=client(),db=createStoreNeonD1Adapter(sql);
 const r=await db.prepare('SELECT sku,amount_cents FROM store_products WHERE sku=?1 LIMIT 1')
    .bind("x'; DROP TABLE users;--").first();
 assert.equal(r.amount_cents,425);
 assert.equal(sql.calls[0].statement,'SELECT sku,amount_cents FROM store_products WHERE sku=$1 LIMIT 1');
 assert.deepEqual(sql.calls[0].params,["x'; DROP TABLE users;--"]);
 assert.equal(sql.calls[0].opts.fullResults,true);
});
test('Neon adapter refuses untrusted SQL text or unrelated Axiom tables',()=>{
 const db=createStoreNeonD1Adapter(client());
 for(const sql of [
  'SELECT * FROM billing_subscriptions',
  'DELETE FROM store_products WHERE sku=?1',
  'UPDATE store_products SET status=?1; DROP TABLE store_products',
  "SELECT * FROM store_products -- injection",
  'SELECT * FROM dangerous_table',
  'SELECT 1',
 ]){
  assert.throws(()=>db.prepare(sql).bind('x'),/not_allowed/);
 }
});
test('Neon adapter checks binding completeness and mismatched statements',()=>{
 const db=createStoreNeonD1Adapter(client());
 assert.throws(()=>db.prepare('SELECT * FROM store_products WHERE sku=?2').bind('x'),/parameter_mismatch/);
 assert.throws(()=>db.prepare('SELECT * FROM store_products WHERE sku=?1').bind(),/parameter_mismatch/);
 assert.throws(()=>db.prepare('UPDATE store_products SET status=?1 WHERE sku=?2').bind('active'),/parameter_mismatch/);
});
test('Neon adapter refuses provider initiation unless durable row count is verified',async()=>{
 const db=createStoreNeonD1Adapter({query:async()=>({rows:[]}),transaction:async()=>[]});
 await assert.rejects(()=>db.prepare(
   "INSERT INTO store_checkout_intents(reference,status) VALUES(?1,'initiating')"
 ).bind('STORE-0123456789ABCDEF').run(),/missing_write_evidence/);
});
test('Neon adapter returns D1-compatible verified write metadata',async()=>{
 const sql=client(),db=createStoreNeonD1Adapter(sql);
 const r=await db.prepare("UPDATE store_checkout_intents SET status='pending' WHERE reference=?1")
     .bind('STORE-0123456789ABCDEF').run();
 assert.deepEqual(r,{success:true,meta:{changes:1}});
});
test('Neon provider review batch uses a single serializable two-write transaction',async()=>{
 const sql=client(),db=createStoreNeonD1Adapter(sql);
 const out=await db.batch([
  db.prepare("INSERT INTO store_checkout_reviews(reference,paynow_reference) VALUES(?1,?2)").bind('STORE-0123456789ABCDEF','PAYNOW-01'),
  db.prepare("UPDATE store_checkout_intents SET status=?2 WHERE reference=?1").bind('STORE-0123456789ABCDEF','review_required')
 ]);
 assert.deepEqual(out,[{success:true,meta:{changes:1}},{success:true,meta:{changes:1}}]);
 const t=sql.calls.find(x=>x.kind==='transaction');
 assert.deepEqual(t.options,{isolationMode:'Serializable',readOnly:false,fullResults:true});
 assert.equal(t.count,2);
 assert.deepEqual(sql.calls.filter(x=>x.kind==='query').map(x=>x.params),
   [['STORE-0123456789ABCDEF','PAYNOW-01'],['STORE-0123456789ABCDEF','review_required']]);
});
test('Neon provider review rejects cross-db and non-two-statement batches',async()=>{
 const one=createStoreNeonD1Adapter(client()),two=createStoreNeonD1Adapter(client());
 const a=one.prepare("UPDATE store_checkout_intents SET status=?2 WHERE reference=?1")
  .bind('STORE-0123456789ABCDEF','review_required');
 const b=two.prepare("UPDATE store_checkout_intents SET status=?2 WHERE reference=?1")
  .bind('STORE-0123456789ABCDEF','review_required');
 await assert.rejects(()=>one.batch([a,b]),/batch_invalid/);
 await assert.rejects(()=>one.batch([a]),/batch_invalid/);
});
test('Neon provider review fails closed when transaction row counts cannot be proved',async()=>{
 const sql=client();
 sql.transaction=async()=>[{rows:[],rowCount:1},{rows:[]}];
 const db=createStoreNeonD1Adapter(sql);
 await assert.rejects(()=>db.batch([
  db.prepare("UPDATE store_checkout_intents SET status=?1 WHERE reference=?2").bind('review_required','STORE-0123456789ABCDEF'),
  db.prepare("UPDATE store_checkout_intents SET status=?1 WHERE reference=?2").bind('review_required','STORE-0123456789ABCDEF')
 ]),/missing_write_evidence/);
});
test('Neon Store staging fails closed with checkout flags or merchant keys',()=>{
 const valid={STORE_NEON_STAGING_ONLY:'true',STORE_CHECKOUT_ENABLED:'false',STORE_CALLBACKS_CERTIFIED:'false',
              STORE_NEON_DATABASE_URL:'postgresql://test-only.invalid/stage'};
 assert.equal(requireDisabledStoreNeonStaging(valid),true);
 for(const bad of [
  {...valid,STORE_CHECKOUT_ENABLED:'true'},
  {...valid,STORE_CALLBACKS_CERTIFIED:'true'},
  {...valid,STORE_PAYNOW_ID:'123'},
  {...valid,STORE_PAYNOW_INTEGRATION_KEY:'secret'},
  {...valid,STORE_NEON_STAGING_ONLY:'false'},
  {...valid,STORE_NEON_DATABASE_URL:''},
 ]) assert.throws(()=>requireDisabledStoreNeonStaging(bad),/not_disabled_or_not_isolated/);
});
