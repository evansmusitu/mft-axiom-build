import test from "node:test";
import assert from "node:assert/strict";
import {PostgresViewEvidenceAdapter} from "../src/postgres_view_evidence_adapter.ts";
import {AdapterRegistry} from "../src/evidence.ts";
const H=(x:string)=>x.repeat(64);
const op={operationId:"risk:postgres:read",parameterSchemaHash:H("a"),
 responseMediaTypes:["application/json"],maxResponseBytes:1024,timeoutMs:3000,mappingIds:["risk:postgres:map"]};
const tenant={tenantId:"tenant:pg-evidence"};
function fixture(response:any={body:'[{"id":"row:1","risk":0.2}]',row_count:"1"}){
 const calls:{sql:string;values?:unknown[]}[]=[];
 let released=0;
 const client={async query(sql:string,values?:unknown[]){
   calls.push({sql,values});return sql.trim().startsWith("WITH")?{rows:[response],rowCount:1}:{rows:[],rowCount:0};
  },release(){released++;}};
 const pool={async connect(){return client;}};
 const make=(override:any={})=>new PostgresViewEvidenceAdapter({adapterId:"adapter:pg-read",version:"1",
  implementationHash:H("b"),pool:pool as any,operations:[{manifest:op,schemaName:"public",
  viewName:"safe_risk_view",tenantColumn:"tenant_id",columns:["id","risk"],orderColumn:"id",maxRows:2,...override}]});
 const input={tenant,operation:op,parameters:{}};
 return {calls,make,input,get released(){return released;},pool};
}
test("fixed read-only PostgreSQL view acquisition binds exact tenant and returns bounded JSON rows",async()=>{
 const f=fixture(),adapter=f.make();
 const result=await adapter.acquire(f.input);
 assert.equal(adapter.manifest.capability,"READ");
 assert.equal(result.body,'[{"id":"row:1","risk":0.2}]');
 assert.equal(result.status,200);
 assert.equal(result.mediaType,"application/json");
 assert.equal(result.bodyEncoding,"utf8");
 assert.equal(f.calls[0].sql.trim(),"BEGIN READ ONLY");
 assert.equal(f.calls.at(-1)?.sql.trim(),"ROLLBACK");
 const q=f.calls.find(x=>x.sql.trim().startsWith("WITH"))!;
 assert.match(q.sql,/FROM "public"\."safe_risk_view"/);
 assert.match(q.sql,/WHERE "tenant_id"=\$1/);
 assert.match(q.sql,/ORDER BY "id"/);
 assert.deepEqual(q.values,[tenant.tenantId,3,2,1024]);
 assert.equal(f.released,1);
 await assert.rejects(()=>adapter.acquire({...f.input,parameters:{sql:"DROP TABLE users"} as any}),/parameter|unexpected/i);
 await assert.rejects(()=>adapter.acquire({...f.input,operation:{...op,operationId:"wrong"}}),/unknown|operation/i);
});
test("configured view SQL identifiers must be strict and cannot contain injected statements",()=>{
 const f=fixture();
 for(const name of ['x"; DROP TABLE users;--',"public.risk","../secret","risk table",""]){
  for(const field of ["schemaName","viewName","tenantColumn","orderColumn"]){
   assert.throws(()=>f.make({[field]:name}),/identifier|column|schema|view/i,name);
  }
 }
 assert.throws(()=>f.make({columns:["id","id"]}),/duplicate/i);
 assert.throws(()=>f.make({orderColumn:"missing"}),/order|column/i);
 assert.throws(()=>f.make({maxRows:0}),/maxRows|rows/i);
});
test("row and byte limits, malformed JSON and empty results fail closed and roll back",async()=>{
 for(const [response,pattern] of [
  [{body:null,row_count:"3"},/rows|limit|quota/i],
  [{body:null,row_count:"1"},/byte|limit|large/i],
  [{body:'{"risk":1}',row_count:"1"},/array|json/i],
  [{body:'[not-json]',row_count:"1"},/json/i],
  [{body:'[]',row_count:"0"},/empty|rows|evidence/i],
  [{body:'[{"id":"1","secret":"x"}]',row_count:"1"},/column|unexpected/i]
 ] as const){
  const f=fixture(response);
  await assert.rejects(()=>f.make().acquire(f.input),pattern);
  assert.equal(f.calls.at(-1)?.sql.trim(),"ROLLBACK");
  assert.equal(f.released,1);
 }
});
test("database and connection errors do not expose provider SQL, credentials or internal endpoint",async()=>{
 const secret="password:irrecoverable";
 const f=fixture();
 const pool={async connect(){throw new Error(secret);}};
 const adapter=new PostgresViewEvidenceAdapter({adapterId:"adapter:pg-read",version:"1",implementationHash:H("b"),
  pool:pool as any,operations:[{manifest:op,schemaName:"public",viewName:"safe_risk_view",
  tenantColumn:"tenant_id",columns:["id","risk"],orderColumn:"id",maxRows:2}]});
 await assert.rejects(()=>adapter.acquire(f.input),(error:any)=>{
  assert.equal(error.message.includes(secret),false);
  assert.match(error.message,/unavailable|source|database/i);return true;
 });
});
test("tenant registry prevents another tenant from resolving PostgreSQL source",()=>{
 const f=fixture(),adapter=f.make();
 const mapper={manifest:{mappingId:"risk:postgres:map",version:"1",implementationHash:H("c")},map(){return [];}};
 const registry=new AdapterRegistry([{adapter,mappers:[mapper],tenantIds:[tenant.tenantId]}]);
 assert.equal(registry.resolve(tenant,"adapter:pg-read",op.operationId,"risk:postgres:map").adapter,adapter);
 assert.throws(()=>registry.resolve({tenantId:"tenant:other"},"adapter:pg-read",op.operationId,"risk:postgres:map"),/tenant|eligible/i);
});

test("query failures roll back and release pooled credentials without revealing SQL errors",async()=>{
 const secret="postgres://user:password@internal.cluster.example/";
 const seen:string[]=[];
 let released=0;
 const pool={async connect(){return {
  async query(sql:string){seen.push(sql);
   if(sql.trim().startsWith("WITH"))throw new Error(secret);
   return {rows:[],rowCount:0};
  },release(){released++;}
 };}};
 const adapter=new PostgresViewEvidenceAdapter({adapterId:"adapter:pg-read",version:"1",implementationHash:H("b"),
  pool:pool as any,operations:[{manifest:op,schemaName:"public",viewName:"safe_risk_view",
  tenantColumn:"tenant_id",columns:["id","risk"],orderColumn:"id",maxRows:2}]});
 await assert.rejects(()=>adapter.acquire({tenant,operation:op,parameters:{}}),(err:any)=>{
  assert.equal(err.message.includes(secret),false);
  assert.match(err.message,/unavailable|source/i);return true;
 });
 assert.equal(seen[0],"BEGIN READ ONLY");
 assert.equal(seen.at(-1),"ROLLBACK");
 assert.equal(released,1);
});

test("pool release failure does not disclose connection credentials",async()=>{
 const secret="postgres://operator:top-secret@internal";
 const pool={async connect(){return {
  async query(sql:string){return sql.trim().startsWith("WITH")
   ?{rows:[{body:'[{"id":"row:1","risk":0.2}]',row_count:"1"}],rowCount:1}
   :{rows:[],rowCount:0};},
  release(){throw new Error(secret);}
 };}};
 const adapter=new PostgresViewEvidenceAdapter({adapterId:"adapter:pg-read",version:"1",implementationHash:H("b"),
  pool:pool as any,operations:[{manifest:op,schemaName:"public",viewName:"safe_risk_view",
  tenantColumn:"tenant_id",columns:["id","risk"],orderColumn:"id",maxRows:2}]});
 await assert.rejects(()=>adapter.acquire({tenant,operation:op,parameters:{}}),(err:any)=>{
  assert.equal(err.message.includes(secret),false);
  assert.match(err.message,/unavailable|source/i);return true;
 });
});
