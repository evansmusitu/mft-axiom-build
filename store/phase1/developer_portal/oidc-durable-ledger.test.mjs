import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createEncryptedPostgresOidcLedger} from './oidc-durable-ledger.mjs';

const fakeTime=1793100000000;
const makeState=(last='A')=>last.repeat(43);
const createFlow=(state=makeState())=>({state,nonce:'B'.repeat(43),verifier:'C'.repeat(86),createdAt:fakeTime,issuer:'https://oidc.example.org',clientId:'store-oidc-client',redirectUri:'https://store.example.org/auth/callback'});
function dbHarness(){
 const table=new Map(),calls=[];
 const query=async (sql,params)=>{
  calls.push({sql,params});
  if(/INSERT INTO store_publisher_private\.oidc_flows/.test(sql)){
   if(table.has(params[0]))return {rowCount:0,rows:[]};
   table.set(params[0],{cipher:params[1],expiresAt:params[2]});return {rowCount:1,rows:[{state_digest:params[0]}]};
  }
  if(/DELETE FROM store_publisher_private\.oidc_flows/.test(sql)){
   const row=table.get(params[0]);if(!row||row.expiresAt<=fakeTime)return {rowCount:0,rows:[]};
   table.delete(params[0]);return {rowCount:1,rows:[{encrypted_record:row.cipher}]};
  }
  throw Error('unapproved SQL');
 };
 return {table,calls,query};
}
const init=(db,key=randomBytes(32),clock=()=>fakeTime)=>createEncryptedPostgresOidcLedger({query:db.query,encryptionKey:key,now:clock});

test('trusted flow persists only AEAD ciphertext and allows one exact return',async()=>{
 const db=dbHarness(),ledger=init(db),flow=createFlow();
 assert.equal(await ledger.begin(flow),true);
 const [stored]=db.table.values();
 assert.ok(Buffer.isBuffer(stored.cipher));
 assert.ok(!stored.cipher.toString('utf8').includes(flow.verifier));
 assert.ok(!stored.cipher.toString('utf8').includes(flow.nonce));
 assert.ok(!JSON.stringify(db.calls).includes(flow.verifier));
 assert.deepEqual(await ledger.consume(flow.state),flow);
 assert.equal(await ledger.consume(flow.state),null);
 assert.equal(db.table.size,0);
});

test('duplicate state never replaces original flow even with changed nonce',async()=>{
 const db=dbHarness(),ledger=init(db),f=createFlow();
 assert.equal(await ledger.begin(f),true);
 assert.equal(await ledger.begin({...f,nonce:'D'.repeat(43)}),false);
 assert.deepEqual(await ledger.consume(f.state),f);
});

test('simultaneous consumes grant exactly one use of a state',async()=>{
 const db=dbHarness(),ledger=init(db),flow=createFlow();
 await ledger.begin(flow);
 const out=await Promise.all(Array.from({length:24},()=>ledger.consume(flow.state)));
 assert.equal(out.filter(x=>x!==null).length,1);
});

test('ciphertext tampering and incorrect KMS key fail closed after atomic consumption',async()=>{
 const db=dbHarness(),key=randomBytes(32),ledger=init(db,key),flow=createFlow();
 await ledger.begin(flow);
 const row=[...db.table.values()][0];row.cipher=Buffer.from(row.cipher);row.cipher[row.cipher.length-1]^=1;
 await assert.rejects(ledger.consume(flow.state),/oidc_ledger_denied/);
 assert.equal(await ledger.consume(flow.state),null);
 const flow2=createFlow(makeState('K'));await ledger.begin(flow2);
 await assert.rejects(init(db,randomBytes(32)).consume(flow2.state),/oidc_ledger_denied/);
});

test('invalid flow, unacceptable key, stale timestamps, and SQL outages fail closed',async()=>{
 const db=dbHarness(),ledger=init(db),flow=createFlow();
 assert.throws(()=>init(db,Buffer.alloc(12)),/oidc_ledger_denied/);
 await assert.rejects(ledger.begin({...flow,verifier:'too-short'}),/oidc_ledger_denied/);
 await assert.rejects(ledger.begin({...flow,createdAt:fakeTime-600000}),/oidc_ledger_denied/);
 await assert.rejects(ledger.begin({...flow,role:'owner'}),/oidc_ledger_denied/);
 const broken=createEncryptedPostgresOidcLedger({query:async()=>{throw Error('database unavailable');},encryptionKey:randomBytes(32),now:()=>fakeTime});
 await assert.rejects(broken.begin(flow),/oidc_ledger_denied/);
 await assert.rejects(broken.consume(flow.state),/oidc_ledger_denied/);
});

test('valid login flow can finish after two minutes but not after five minutes',async()=>{
 const db=dbHarness();let clock=fakeTime;const ledger=init(db,randomBytes(32),()=>clock);
 const flow=createFlow(makeState('Q'));assert.equal(await ledger.begin(flow),true);
 clock+=120_000;assert.deepEqual(await ledger.consume(flow.state),flow);
 const later=createFlow(makeState('R'));clock=fakeTime;assert.equal(await ledger.begin(later),true);
 clock=fakeTime+300_001;await assert.rejects(ledger.consume(later.state),/oidc_ledger_denied/);
});
