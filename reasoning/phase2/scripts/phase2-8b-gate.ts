import assert from "node:assert/strict";
import {hashJson} from "../../phase1/src/canonical.ts";
import {PostgresViewEvidenceAdapter} from "../src/postgres_view_evidence_adapter.ts";
import {AdapterRegistry,createEvidenceArtifact,verifyEvidenceArtifact,mapEvidenceArtifact} from "../src/evidence.ts";
const tenant={tenantId:"tenant:p28b"};
const H=(x:string)=>x.repeat(64);
const manifest={operationId:"risk:pg:view",parameterSchemaHash:H("a"),
 responseMediaTypes:["application/json"],maxResponseBytes:1024,timeoutMs:3000,mappingIds:["risk:pg:map"]};
const queries:{sql:string;values?:unknown[]}[]=[];
let releases=0;
const pool={async connect(){return {async query(sql:string,values?:unknown[]){
 queries.push({sql,values});
 return sql.trim().startsWith("WITH")
 ?{rows:[{body:'[{"id":"observation:1","risk":0.21}]',row_count:"1"}],rowCount:1}
 :{rows:[],rowCount:0};
},release(){releases++;}};}};
const adapter=new PostgresViewEvidenceAdapter({
 adapterId:"adapter:pg:gate",version:"1",implementationHash:H("b"),pool:pool as any,
 operations:[{manifest,schemaName:"public",viewName:"axiom_risk_view",
 tenantColumn:"tenant_id",columns:["id","risk"],orderColumn:"id",maxRows:2}]
});
const mapper={manifest:{mappingId:"risk:pg:map",version:"1",implementationHash:H("c")},
 map(artifact:any){const record=JSON.parse(artifact.body)[0];
 return [{entity:"risk:tenant",attribute:"current",value:{type:{kind:"number",unit:"ratio"},value:record.risk},
 validFrom:"2026-11-01T12:00:00.000Z",observedAt:"2026-11-01T12:00:00.000Z",source:"operator:pg-view"}];}};
const registry=new AdapterRegistry([{adapter,mappers:[mapper],tenantIds:[tenant.tenantId]}]);
const resolved=registry.resolve(tenant,adapter.manifest.adapterId,manifest.operationId,mapper.manifest.mappingId);
const capture=await resolved.adapter.acquire({tenant,operation:resolved.operation,parameters:{}});
assert.equal(capture.body,'[{"id":"observation:1","risk":0.21}]');
assert.equal(queries[0].sql,"BEGIN READ ONLY");
const q=queries.find(x=>x.sql.trim().startsWith("WITH"))!;
assert.match(q.sql,/FROM "public"\."axiom_risk_view"/);
assert.match(q.sql,/WHERE "tenant_id"=\$1/);
assert.match(q.sql,/LIMIT \$2/);
assert.deepEqual(q.values,[tenant.tenantId,3,2,1024]);
assert.equal(queries.at(-1)?.sql,"ROLLBACK");
assert.equal(releases,1);
const artifact=createEvidenceArtifact({
 tenantId:tenant.tenantId,adapterId:adapter.manifest.adapterId,
 adapterVersion:adapter.manifest.version,adapterImplementationHash:adapter.manifest.implementationHash,
 operationId:manifest.operationId,mappingId:mapper.manifest.mappingId,
 canonicalRequestHash:hashJson({request:"pg:fixed"}),capturedAt:"2026-11-01T12:00:01.000Z",
 upstreamStatus:capture.status,mediaType:capture.mediaType,
 bodyEncoding:capture.bodyEncoding??"utf8",body:capture.body
});
const facts=mapEvidenceArtifact(tenant,verifyEvidenceArtifact(tenant,artifact),mapper);
assert.equal(facts[0].value.value,0.21);
assert.equal(facts[0].acquisition?.artifactHash,artifact.artifactHash);
assert.throws(()=>verifyEvidenceArtifact(tenant,{...artifact,body:"[]"}),/integrity/i);
assert.throws(()=>registry.resolve({tenantId:"tenant:wrong"},adapter.manifest.adapterId,
 manifest.operationId,mapper.manifest.mappingId),/tenant/i);
await assert.rejects(()=>adapter.acquire({tenant,operation:manifest,
 parameters:{sql:"SELECT * FROM secret"} as any}),/parameters/i);
assert.throws(()=>new PostgresViewEvidenceAdapter({
 adapterId:"adapter:bad",version:"1",implementationHash:H("b"),pool:pool as any,
 operations:[{manifest,schemaName:"public",viewName:'risk"; DROP TABLE users;--',
 tenantColumn:"tenant_id",columns:["id","risk"],orderColumn:"id",maxRows:2}]
}),/identifier/i);
console.log(JSON.stringify({phase:"P2.8B — Tenant-Scoped PostgreSQL View Evidence",status:"PASS",
 checks:["accept only trusted schema/view/column identifiers",
 "bind an exact tenant predicate using server-owned tenant identity",
 "execute exclusively inside a read-only PostgreSQL transaction",
 "bound selected rows and returned JSON bytes before exposure",
 "roll back and release connection after acquisition",
 "feed immutable tenant-scoped evidence artifact and fact provenance",
 "reject caller SQL, cross-tenant registry access and artifact tampering"],
 artifactId:artifact.artifactId,factId:facts[0].id}));
