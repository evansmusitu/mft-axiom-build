import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

const action="execution:create";
const grant={grantId:"grant-a",principalId:"principal:a",tenantId:"tenant:a",action};

function sha(value:string):string{return createHash("sha256").update(value).digest("hex");}
function tempDb(prefix:string){const dir=mkdtempSync(join(tmpdir(),prefix));return {dir,db:join(dir,"security.db")};}
function event(tenantId:string,requestId:string,outcome:string){
  return {
    requestedTenantId:tenantId,requestId,principalId:"principal:a",action:"execution:create",
    resource:{kind:"execution"},credentialTokenHash:"c".repeat(64),
    authorizationDecisionHash:"d".repeat(64),requestHash:sha("request:"+requestId),
    idempotencyKeyHash:sha("idem:"+requestId),outcome,timestamp:"2026-10-06T10:00:00.000Z"
  };
}

test("SQLite security store persists exact authorization grants across reopen",async()=>{
  const phase2:any=await import("../src/index.ts");
  assert.equal(typeof phase2.SecurityStore,"function");
  const {dir,db}=tempDb("axiom-security-grants-");
  let store=new phase2.SecurityStore(db);
  try{
    await store.putGrant(grant);
    store.close();
    store=new phase2.SecurityStore(db);
    assert.deepEqual(await store.listApplicable("principal:a","tenant:a"),[grant]);
    assert.deepEqual(await store.listApplicable("principal:a","tenant:b"),[]);
    assert.deepEqual(await store.listApplicable("principal:b","tenant:a"),[]);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test("SQLite idempotency is durable, exact, conflict-safe, and stores no raw key",async()=>{
  const phase2:any=await import("../src/index.ts");
  assert.equal(typeof phase2.SecurityStore,"function");
  const {dir,db}=tempDb("axiom-security-idem-");
  const rawKey="super-secret-idempotency-key";
  const input={
    principalId:"principal:a",tenantId:"tenant:a",action,
    idempotencyKeyHash:sha(rawKey),requestHash:sha("request-v1"),
    createdAt:"2026-10-06T10:00:00.000Z"
  };
  let store=new phase2.SecurityStore(db);
  try{
    assert.deepEqual(await store.claim(input),{status:"CLAIMED"});
    assert.deepEqual(await store.claim(input),{status:"IN_PROGRESS"});
    assert.deepEqual(await store.claim({...input,requestHash:sha("request-v2")}),{status:"CONFLICT"});
    const outcome={statusCode:201,bodyJson:'{"executionId":"platform:1","ok":true}',contentType:"application/json"};
    await store.complete({...input,completedAt:"2026-10-06T10:00:01.000Z"},outcome);
    store.close();
    store=new phase2.SecurityStore(db);
    assert.deepEqual(await store.claim(input),{status:"REPLAY",outcome});

    const inspect=new DatabaseSync(db);
    try{
      const rows=inspect.prepare("SELECT * FROM axiom_idempotency_records").all();
      assert.equal(JSON.stringify(rows).includes(rawKey),false);
      assert.equal(String((rows[0] as any).body_json),outcome.bodyJson);
    }finally{inspect.close();}
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test("SQLite audit streams are tenant-separated and verify their persisted head",async()=>{
  const phase2:any=await import("../src/index.ts");
  assert.equal(typeof phase2.SecurityStore,"function");
  const {dir,db}=tempDb("axiom-security-audit-");
  const store=new phase2.SecurityStore(db);
  try{
    const a1=await store.append(event("tenant:a","r1","ALLOW"));
    const a2=await store.append(event("tenant:a","r2","SUCCESS"));
    const b1=await store.append(event("tenant:b","r1","DENY"));
    assert.equal(a1.sequence,1);assert.equal(a2.sequence,2);assert.equal(b1.sequence,1);
    assert.equal(a2.previousHash,a1.recordHash);
    assert.notEqual(b1.recordHash,a1.recordHash);
    assert.deepEqual(await store.verifyStream("tenant:a"),{status:"MATCH",diagnostics:[]});
    assert.deepEqual(await store.verifyStream("tenant:b"),{status:"MATCH",diagnostics:[]});
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

for(const tamper of ["mutation","middle-deletion","tail-deletion","sequence-corruption"] as const){
  test(`SQLite audit verification detects ${tamper}`,async()=>{
    const phase2:any=await import("../src/index.ts");
    assert.equal(typeof phase2.SecurityStore,"function");
    const {dir,db}=tempDb("axiom-security-tamper-");
    let store=new phase2.SecurityStore(db);
    try{
      await store.append(event("tenant:a","r1","ALLOW"));
      await store.append(event("tenant:a","r2","SUCCESS"));
      await store.append(event("tenant:a","r3","SUCCESS"));
      store.close();
      const raw=new DatabaseSync(db);
      try{
        if(tamper==="mutation")raw.prepare("UPDATE axiom_audit_records SET outcome='TAMPERED' WHERE tenant_id=? AND sequence=2").run("tenant:a");
        if(tamper==="middle-deletion")raw.prepare("DELETE FROM axiom_audit_records WHERE tenant_id=? AND sequence=2").run("tenant:a");
        if(tamper==="tail-deletion")raw.prepare("DELETE FROM axiom_audit_records WHERE tenant_id=? AND sequence=3").run("tenant:a");
        if(tamper==="sequence-corruption")raw.prepare("UPDATE axiom_audit_records SET sequence=99 WHERE tenant_id=? AND sequence=2").run("tenant:a");
      }finally{raw.close();}
      store=new phase2.SecurityStore(db);
      const verified=await store.verifyStream("tenant:a");
      assert.equal(verified.status,"MISMATCH");
      assert.ok(verified.diagnostics.length>0);
    }finally{store.close();rmSync(dir,{recursive:true,force:true});}
  });
}


test("SQLite security store persists evidence:acquire grants",async()=>{
  const phase2:any=await import("../src/index.ts");
  const {dir,db}=tempDb("axiom-security-evidence-grant-");
  const store=new phase2.SecurityStore(db);
  const evidenceGrant={grantId:"grant-evidence",principalId:"principal:a",tenantId:"tenant:a",action:"evidence:acquire"};
  try{
    await store.putGrant(evidenceGrant);
    assert.deepEqual(await store.listApplicable("principal:a","tenant:a"),[evidenceGrant]);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});


test("SQLite security store persists independent model compile and execute grants",async()=>{
  const phase2:any=await import("../src/index.ts");
  const {dir,db}=tempDb("axiom-security-model-grants-");
  const store=new phase2.SecurityStore(db);
  const compileGrant={grantId:"grant-model-compile",principalId:"principal:a",tenantId:"tenant:a",action:"model:compile"};
  const executeGrant={grantId:"grant-model-execute",principalId:"principal:a",tenantId:"tenant:a",action:"model:execute"};
  try{
    await store.putGrant(compileGrant);
    await store.putGrant(executeGrant);
    assert.deepEqual(await store.listApplicable("principal:a","tenant:a"),[compileGrant,executeGrant]);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
