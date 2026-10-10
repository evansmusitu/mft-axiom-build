import test from "node:test";
import assert from "node:assert/strict";
import {
  HttpEd25519SigningBackend, type ExternalEd25519SignRequest
} from "../src/index.ts";

const request:ExternalEd25519SignRequest={
  protocolVersion:"axiom.sign/v1",keyId:"key:kms:v1",algorithm:"Ed25519",
  signingIntentId:"a".repeat(64),payloadHash:"b".repeat(64),
  payloadBase64:Buffer.from('{"core":{},"issuedAt":"2026-10-09T04:10:00.000Z"}').toString("base64")
};

test("HTTP signer backend uses fixed HTTPS transport, server-owned secrets, and strict echoed identity",async()=>{
  let seen:any;
  const backend=new HttpEd25519SigningBackend({
    origin:"https://signer.example.com",path:"/v1/sign",timeoutMs:1000,
    maxRequestBytes:65536,maxResponseBytes:4096,
    secretResolver:{resolve:async(ref:string)=>ref==="signer-token"?"top-secret":""},
    secretHeaders:{authorization:{secretRef:"signer-token",prefix:"Bearer "}},
    fetchFn:async(input:any,init:any)=>{
      seen={url:String(input),init};
      return new Response(JSON.stringify({
        protocolVersion:request.protocolVersion,keyId:request.keyId,algorithm:request.algorithm,
        signingIntentId:request.signingIntentId,payloadHash:request.payloadHash,
        signatureBase64:Buffer.alloc(64,7).toString("base64")
      }),{status:200,headers:{"content-type":"application/json"}});
    }
  });
  const response=await backend.sign(request);
  assert.equal(seen.url,"https://signer.example.com/v1/sign");
  assert.equal(seen.init.redirect,"manual");
  assert.equal(seen.init.headers.authorization,"Bearer top-secret");
  assert.deepEqual(JSON.parse(seen.init.body),request);
  assert.equal(response.signatureBase64,Buffer.alloc(64,7).toString("base64"));
});

test("HTTP signer backend rejects unsafe origins, redirects, authority injection, and secret echo",async()=>{
  assert.throws(()=>new HttpEd25519SigningBackend({
    origin:"https://127.0.0.1",path:"/sign",timeoutMs:1000,maxRequestBytes:1024,maxResponseBytes:1024,
    secretResolver:{resolve:async()=>""}
  }),/unsafe|loopback|private|destination/i);

  const redirect=new HttpEd25519SigningBackend({
    origin:"https://signer.example.com",path:"/sign",timeoutMs:1000,maxRequestBytes:65536,maxResponseBytes:4096,
    secretResolver:{resolve:async()=>""},
    fetchFn:async()=>new Response("",{status:302,headers:{location:"https://evil.example/sign"}})
  });
  await assert.rejects(()=>redirect.sign(request),/status|redirect|upstream/i);

  const injected=new HttpEd25519SigningBackend({
    origin:"https://signer.example.com",path:"/sign",timeoutMs:1000,maxRequestBytes:65536,maxResponseBytes:4096,
    secretResolver:{resolve:async()=>""},
    fetchFn:async()=>new Response(JSON.stringify({
      protocolVersion:request.protocolVersion,keyId:request.keyId,algorithm:request.algorithm,
      signingIntentId:request.signingIntentId,payloadHash:request.payloadHash,
      signatureBase64:Buffer.alloc(64,7).toString("base64"),publicKeyPem:"attacker"
    }),{status:200,headers:{"content-type":"application/json"}})
  });
  await assert.rejects(()=>injected.sign(request),/unknown|unexpected|schema/i);

  const echo=new HttpEd25519SigningBackend({
    origin:"https://signer.example.com",path:"/sign",timeoutMs:1000,maxRequestBytes:65536,maxResponseBytes:4096,
    secretResolver:{resolve:async()=> "top-secret"},
    secretHeaders:{authorization:{secretRef:"token",prefix:"Bearer "}},
    fetchFn:async()=>new Response(JSON.stringify({
      protocolVersion:request.protocolVersion,keyId:request.keyId,algorithm:request.algorithm,
      signingIntentId:request.signingIntentId,payloadHash:request.payloadHash,
      signatureBase64:Buffer.alloc(64,7).toString("base64"),diagnostic:"top-secret"
    }),{status:200,headers:{"content-type":"application/json"}})
  });
  await assert.rejects(()=>echo.sign(request),/secret/i);
});
