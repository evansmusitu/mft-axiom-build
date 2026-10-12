import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,unlinkSync} from 'node:fs';
import {writeMmfSyntheticProof,readMmfSyntheticProof,clearMmfSyntheticProof,assertMmfPrivateProofFlags} from '../src/staging/mmf-private-sqlite-proof.mjs';
const digest='ab'.repeat(32);
const shut=Object.freeze({MMF_STAGE_ONLY:'false',MMF_REAL_SEND_ENABLED:'false',MMF_COMMERCE_ENABLED:'false',MMF_CUSTOMER_API_ENABLED:'false',MMF_MAIL_SENDING_ENABLED:'false'});
function storage(db){
 const sql={exec(query,...args){const q=db.prepare(query);const rows=/^\s*(SELECT|PRAGMA)\b/i.test(query)?q.all(...args): (q.run(...args),[]);return {toArray:()=>rows}}};
 return {sql,transactionSync(fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result}catch(e){db.exec('ROLLBACK');throw e}}};
}
test('private proof writes only hashed synthetic marker and persists through SQLite connection restart',()=>{
 const file=`/tmp/mmf-private-proof-${process.pid}-${Date.now()}.sqlite`;
 let db=new DatabaseSync(file);let s=storage(db);
 try{
   assert.equal(readMmfSyntheticProof(s),null);
   assert.deepEqual(writeMmfSyntheticProof(s,digest),{stored:true});
   db.close();db=new DatabaseSync(file);s=storage(db);
   assert.equal(readMmfSyntheticProof(s),digest);
   assert.deepEqual(clearMmfSyntheticProof(s),{cleared:true});
   assert.equal(readMmfSyntheticProof(s),null);
 }finally{db.close();try{unlinkSync(file)}catch{}}
});
test('proof rejects arbitrary payload, mutation by default, and missing closed-stage security flags',()=>{
 const db=new DatabaseSync(':memory:');try{
   for(const value of ['', 'hi', 'A'.repeat(64),'{"customer":"x"}', 'f'.repeat(65)]) assert.throws(()=>writeMmfSyntheticProof(storage(db),value),/DENIED/);
   assert.doesNotThrow(()=>assertMmfPrivateProofFlags(shut));
   for(const name of Object.keys(shut)) assert.throws(()=>assertMmfPrivateProofFlags({...shut,[name]:'true'}),/DENIED/);
   assert.throws(()=>assertMmfPrivateProofFlags({...shut,MMF_PRIVATE_PROOF_EXTRA:'true'}),/DENIED/);
 }finally{db.close()}
});
test('isolated deployed worker retains hard 503 fetch, stage-only synthetic RPC and private caller binds exact worker',()=>{
 const edge=readFileSync(new URL('../src/edge/mmf-commercial-private-cloudflare.mjs',import.meta.url),'utf8');
 const client=readFileSync(new URL('../src/staging/mmf-private-cloud-proof-client.mjs',import.meta.url),'utf8');
 const conf=JSON.parse(readFileSync(new URL('../wrangler.mmf.private-cloud-local-probe.jsonc',import.meta.url),'utf8'));
 assert.match(edge,/async fetch\(\).*deny\(\)/);assert.match(edge,/class MmfPrivateStorageProofEntrypoint/);
 assert.match(edge,/abort\(/);assert.match(client,/127\.0\.0\.1/);
 assert.equal(conf.services[0].service,'mmf-commercial-private-sqlite-stage-20261012');
 assert.equal(conf.services[0].entrypoint,'MmfPrivateStorageProofEntrypoint');
 assert.equal(conf.services[0].remote,true);
 assert.equal(conf.workers_dev,false);assert.equal(conf.preview_urls,false);
 assert.match(readFileSync(new URL('../wrangler.mmf.commercial-private.cloud-stage-20261012.jsonc',import.meta.url),'utf8'),/\"workers_dev\"\s*:\s*false/);
});