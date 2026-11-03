import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync,rmSync,unlinkSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {FileJsonEvidenceAdapter} from "../src/file_json_evidence_adapter.ts";
import {AdapterRegistry} from "../src/evidence.ts";
const H=(c:string)=>c.repeat(64);
const manifest={operationId:"risk:file:read",parameterSchemaHash:H("a"),
 responseMediaTypes:["application/json"],maxResponseBytes:128,timeoutMs:1500,mappingIds:["risk:file:map"]};
function setup(){
 const root=mkdtempSync(join(tmpdir(),"axiom-file-adapter-"));
 writeFileSync(join(root,"snapshot.json"),'{"risk":0.23,"source":"operator"}',"utf8");
 const make=(overrides:any={})=>new FileJsonEvidenceAdapter({
  adapterId:"adapter:local-file",version:"1.0",implementationHash:H("b"),
  rootDirectory:root,operations:[{manifest,fileName:"snapshot.json",...overrides}]
 });
 const input={tenant:{tenantId:"tenant:local-file"},operation:manifest,parameters:{}};
 return {root,make,input,close(){rmSync(root,{recursive:true,force:true});}};
}
test("bound file adapter reads raw bounded JSON without caller-selected paths",async()=>{
 const f=setup();try{
  const adapter=f.make();
  assert.equal(adapter.manifest.capability,"READ");
  assert.equal(adapter.manifest.operations.length,1);
  const captured=await adapter.acquire(f.input);
  assert.equal(captured.status,200);
  assert.equal(captured.mediaType,"application/json");
  assert.equal(captured.body,'{"risk":0.23,"source":"operator"}');
  assert.equal(captured.bodyEncoding,"utf8");
  await assert.rejects(()=>adapter.acquire({...f.input,parameters:{path:"/etc/passwd"} as any}),/parameter|not allowed|unexpected/i);
  await assert.rejects(()=>adapter.acquire({...f.input,operation:{...manifest,operationId:"risk:other"}}),/unregistered|operation/i);
 }finally{f.close();}
});
test("dangerous filenames, duplicate bindings, invalid roots and symlinks are rejected",async()=>{
 const f=setup();try{
  for(const fileName of ["../secret.json","/etc/passwd",".hidden","nested/file.json","..","snapshot.txt","%2e%2e.json"]){
   assert.throws(()=>f.make({fileName}),/filename|file name|basename|path/i,fileName);
  }
  assert.throws(()=>new FileJsonEvidenceAdapter({adapterId:"x",version:"1",implementationHash:H("a"),
   rootDirectory:f.root,operations:[
    {manifest,fileName:"snapshot.json"},{manifest:{...manifest,operationId:"risk:file:other"},fileName:"snapshot.json"}]}),/duplicate|file name|basename/i);
  symlinkSync(join(f.root,"snapshot.json"),join(f.root,"alias.json"));
  const alias=f.make({fileName:"alias.json"});
  await assert.rejects(()=>alias.acquire(f.input),/symlink|symbolic|file|unsafe/i);
  mkdirSync(join(f.root,"dir.json"));
  const dir=f.make({fileName:"dir.json"});
  await assert.rejects(()=>dir.acquire(f.input),/regular|file/i);
  assert.throws(()=>new FileJsonEvidenceAdapter({adapterId:"x",version:"1",implementationHash:H("a"),
   rootDirectory:join(f.root,"snapshot.json"),operations:[{manifest,fileName:"snapshot.json"}]}),/root|directory/i);
 }finally{f.close();}
});
test("adapter rejects oversized files, malformed JSON and non-UTF8 bytes",async()=>{
 const f=setup();try{
  const adapter=f.make();
  writeFileSync(join(f.root,"snapshot.json"),"z".repeat(129));
  await assert.rejects(()=>adapter.acquire(f.input),/size|large|limit/i);
  writeFileSync(join(f.root,"snapshot.json"),"{bad");
  await assert.rejects(()=>adapter.acquire(f.input),/json/i);
  writeFileSync(join(f.root,"snapshot.json"),Buffer.from([123,34,255,34,58,49,125]));
  await assert.rejects(()=>adapter.acquire(f.input),/utf.?8|encoding/i);
  writeFileSync(join(f.root,"snapshot.json"),"{}");
  const ok=await adapter.acquire(f.input);
  assert.equal(ok.body,"{}");
 }finally{f.close();}
});
test("registered file adapter retains strict tenant and mapper authority",()=>{
 const f=setup();try{
  const adapter=f.make();
  const mapper={manifest:{mappingId:"risk:file:map",version:"1",implementationHash:H("c")},map(){return [];}};
  const registry=new AdapterRegistry([{adapter,mappers:[mapper],tenantIds:["tenant:local-file"]}]);
  assert.equal(registry.resolve(f.input.tenant,"adapter:local-file",manifest.operationId,"risk:file:map").adapter,adapter);
  assert.throws(()=>registry.resolve({tenantId:"tenant:other"},"adapter:local-file",manifest.operationId,"risk:file:map"),/eligible|tenant/i);
 }finally{f.close();}
});

test("missing operator file denies acquisition without leaking root filesystem path",async()=>{
 const f=setup();try{
  const adapter=f.make();
  unlinkSync(join(f.root,"snapshot.json"));
  await assert.rejects(()=>adapter.acquire(f.input),(error:any)=>{
   assert.equal(typeof error.message,"string");
   assert.doesNotMatch(error.message,new RegExp(f.root.replace(/[.*+?^$\{\}()|[\]\\]/g,"\\$&")));
   assert.match(error.message,/file|unavailable|not found/i);
   return true;
  });
 }finally{f.close();}
});

test("a root removed after registration fails closed without disclosing its absolute path",async()=>{
 const f=setup();
 const adapter=f.make();
 try{
  rmSync(f.root,{recursive:true,force:true});
  await assert.rejects(()=>adapter.acquire(f.input),(error:any)=>{
   assert.match(error.message,/unavailable|root|directory/i);
   assert.equal(error.message.includes(f.root),false);
   return true;
  });
 }finally{f.close();}
});
