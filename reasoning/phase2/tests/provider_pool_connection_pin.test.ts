import test from "node:test";
import assert from "node:assert/strict";
import {pinPoolConnectionOptions} from "../src/provider_pool_connection_pin.ts";

test("read-only PostgreSQL connection identity remains valid when unchanged",()=>{
  const pool={options:{host:"private-db.internal",port:5432,user:"axiom_worker",database:"central_spend",
    password:"synthetic-not-a-real-secret",ssl:{rejectUnauthorized:true,ca:Buffer.from("synthetic-ca")},max:3}};
  const same=pinPoolConnectionOptions(pool);
  assert.equal(same(),true);
  assert.equal(same(),true);
});

test("changed PostgreSQL endpoint, role, database or credentials cannot retain trusted identity",()=>{
  for(const [field,attackerValue] of Object.entries({
    host:"other-db.example",port:15432,user:"other_role",database:"other_ledger",password:"different-fake-secret"
  })){
    const pool={options:{host:"private-db.internal",port:5432,user:"axiom_worker",database:"central_spend",
      password:"synthetic-not-a-real-secret"}};
    const same=pinPoolConnectionOptions(pool);
    (pool.options as Record<string,unknown>)[field]=attackerValue;
    assert.equal(same(),false,`mutated ${field} must fail before pg Pool.connect`);
  }
});

test("replacement or extension of pg Pool.options cannot bypass the captured trust boundary",()=>{
  const pool:{options:Record<string,unknown>}={options:{host:"private-db.internal",max:2}};
  const same=pinPoolConnectionOptions(pool);
  pool.options={host:"private-db.internal",max:2};
  assert.equal(same(),false,"replacement options object must not be accepted by identity");
  const second=pinPoolConnectionOptions(pool);
  pool.options.connectionString="postgres://alternate-private-origin/other";
  assert.equal(second(),false,"appended connection options must be rejected");
});

test("nested TLS downgrade and CA buffer mutations invalidate the pinned connection",()=>{
  const pool={options:{host:"private-db.internal",ssl:{rejectUnauthorized:true,ca:Buffer.from("synthetic-ca")}}};
  const same=pinPoolConnectionOptions(pool);
  pool.options.ssl.rejectUnauthorized=false;
  assert.equal(same(),false,"TLS verification downgrade must invalidate pg pool identity");
  pool.options.ssl.rejectUnauthorized=true;
  pool.options.ssl.ca[0]=88;
  assert.equal(same(),false,"in-place CA bytes mutation must invalidate pg pool identity");
});

test("dynamic connection getters and object graph cycles fail closed at pinning time",()=>{
  const malicious=Object.defineProperty({},"host",{enumerable:true,get(){return "private";}});
  assert.throws(()=>pinPoolConnectionOptions({options:malicious}),/supported|accessor|snapshot|safe/i);
  const cyclic:any={};cyclic.ssl=cyclic;
  assert.throws(()=>pinPoolConnectionOptions({options:cyclic}),/cycle|cyclic|safe/i);
});
