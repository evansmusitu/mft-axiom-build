import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalize, hashJson, sha256Hex } from "../../phase1/src/canonical.ts";

const A={tenantId:"tenant:explain-store-a"},B={tenantId:"tenant:explain-store-b"};
const H=(c:string)=>c.repeat(64);
const sha=(s:string)=>sha256Hex(Buffer.from(s,"utf8"));

function record(salt="primary"){
  const requestBody=JSON.stringify({providerRequest:true,salt});
  const responseBody=JSON.stringify({provider:"fixture",salt,text:"raw"});
  const normalizedResponseBody=canonicalize({summary:"Advisory summary",keyFactors:["Verified replay"],limitations:["Advisory only"]} as any);
  const base:any={
    tenantId:A.tenantId,executionId:"platform:"+H("1"),executionRecordHash:H("2"),
    principalId:"principal:explain-store",authorizationDecisionHash:H("3"),explanationRequestHash:H("4"),
    profileId:"profile:explain",profileVersion:"1.0.0",profileHash:H("5"),
    adapterManifest:{adapterId:"model:explain:fixture",version:"1.0.0",implementationHash:H("6"),provider:"fixture",modelId:"fixture-model"},
    capturedAt:"2026-10-07T20:55:00.000Z",
    requestBody,requestBodyHash:sha(requestBody),
    responseBody,responseBodyHash:sha(responseBody),
    normalizedResponseBody,normalizedResponseBodyHash:sha(normalizedResponseBody),
    authority:"ADVISORY_ONLY",
    content:{summary:"Advisory summary",keyFactors:["Verified replay"],limitations:["Advisory only"]}
  };
  const explanationId="model-explanation:"+hashJson(base);
  const core={explanationId,...base};
  return {...core,recordHash:hashJson(core)};
}

test("SQLite explanation persistence is tenant-scoped exact and tamper-evident",async()=>{
  const phase2:any=await import("../src/index.ts");
  assert.equal(typeof phase2.ModelExplanationStore,"function");
  const dir=mkdtempSync(join(tmpdir(),"axiom-explain-")),path=join(dir,"explain.sqlite");
  try{
    const repo=new phase2.ModelExplanationStore(path),r=record();
    await repo.put(A,r);
    assert.deepEqual(await repo.get(A,r.explanationId),r);
    await assert.rejects(()=>repo.get(B,r.explanationId),/not found|tenant/i);
    await assert.rejects(()=>repo.put(B,r),/tenant/i);

    const db=new DatabaseSync(path);
    const row=db.prepare("SELECT request_body,response_body,normalized_response_body,record_json FROM axiom_model_explanations WHERE tenant_id=? AND explanation_id=?").get(A.tenantId,r.explanationId) as any;
    assert.equal(String(row.request_body),r.requestBody);
    assert.equal(String(row.response_body),r.responseBody);
    assert.equal(String(row.normalized_response_body),r.normalizedResponseBody);
    assert.equal(JSON.stringify(row).includes("provider-secret-that-must-not-exist"),false);
    db.prepare("UPDATE axiom_model_explanations SET request_body=? WHERE tenant_id=? AND explanation_id=?").run("tampered",A.tenantId,r.explanationId);
    db.close();
    await assert.rejects(()=>repo.get(A,r.explanationId),/integrity|hash/i);
    repo.close();
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test("SQLite explanation persistence rejects record and redundant-hash tampering",async()=>{
  const phase2:any=await import("../src/index.ts");
  const fields=[
    ["request_body_hash",H("9")],
    ["response_body_hash",H("9")],
    ["normalized_response_body_hash",H("9")],
    ["record_hash",H("9")]
  ];
  for(const [field,value] of fields){
    const dir=mkdtempSync(join(tmpdir(),"axiom-explain-tamper-")),path=join(dir,"explain.sqlite");
    try{
      const repo=new phase2.ModelExplanationStore(path),r=record(String(field));
      await repo.put(A,r);
      const db=new DatabaseSync(path);
      db.prepare(`UPDATE axiom_model_explanations SET ${field}=? WHERE tenant_id=? AND explanation_id=?`).run(value,A.tenantId,r.explanationId);
      db.close();
      await assert.rejects(()=>repo.get(A,r.explanationId),/integrity|hash/i);
      repo.close();
    }finally{rmSync(dir,{recursive:true,force:true});}
  }
});

test("SQLite explanation insert fails atomically and preserves prior immutable record",async()=>{
  const phase2:any=await import("../src/index.ts");
  const dir=mkdtempSync(join(tmpdir(),"axiom-explain-atomic-")),path=join(dir,"explain.sqlite");
  try{
    const repo=new phase2.ModelExplanationStore(path),first=record("same");
    await repo.put(A,first);
    const forged=structuredClone(first);
    forged.content.summary="changed after identity";
    await assert.rejects(()=>repo.put(A,forged),/integrity|hash/i);
    assert.deepEqual(await repo.get(A,first.explanationId),first);

    await assert.rejects(()=>repo.put(A,first),/unique|constraint|duplicate/i);
    assert.deepEqual(await repo.get(A,first.explanationId),first);
    repo.close();
  }finally{rmSync(dir,{recursive:true,force:true});}
});
