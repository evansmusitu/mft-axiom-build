import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sign } from "node:crypto";
import {
  AxiomRuntime, canonicalize, compileProgram, createDefaultRegistry, createSigner,
  type AxiomProgram
} from "../../phase1/src/index.ts";
import {
  createExternalEd25519SignerProvider, createStaticSignerProvider,
  type ExternalEd25519SigningBackend
} from "../src/index.ts";

const fixture=JSON.parse(readFileSync(new URL("../../phase1/fixtures/xau-risk-program.json",import.meta.url),"utf8")) as AxiomProgram;

function execution(){
  const program=compileProgram(structuredClone(fixture),createDefaultRegistry());
  return {program,result:new AxiomRuntime(createDefaultRegistry()).execute(program)};
}

test("external signer uses a pinned Ed25519 key and one deterministic signing intent across retries",async()=>{
  const remote=createSigner();
  const calls:any[]=[];
  const backend:ExternalEd25519SigningBackend={
    async sign(request){
      calls.push(structuredClone(request));
      return {
        protocolVersion:"axiom.sign/v1",keyId:request.keyId,algorithm:"Ed25519",
        signingIntentId:request.signingIntentId,payloadHash:request.payloadHash,
        signatureBase64:sign(null,Buffer.from(request.payloadBase64,"base64"),remote.privateKey).toString("base64")
      };
    }
  };
  const provider=createExternalEd25519SignerProvider({
    providerId:"kms:test",activeKeyId:"key:kms:v1",activePublicKey:remote.publicKey,
    trustedKeys:{"key:kms:v1":remote.publicKey},backend
  });
  assert.deepEqual(provider.identity,{
    protocolVersion:"axiom.signer/v1",providerId:"kms:test",mode:"EXTERNAL",
    keyId:"key:kms:v1",algorithm:"Ed25519",publicKeySha256:provider.identity.publicKeySha256
  });
  assert.match(provider.identity.publicKeySha256,/^[0-9a-f]{64}$/);

  const {program,result}=execution();
  const expectedIntent=provider.signingIntentId(program,result,"2026-10-09T04:10:00.000Z");
  const a=await provider.issue(program,result,"2026-10-09T04:10:00.000Z");
  const b=await provider.issue(program,result,"2026-10-09T04:10:00.000Z");
  assert.equal(calls.length,2);
  assert.equal(calls[0].signingIntentId,expectedIntent);
  assert.deepEqual(calls[1],calls[0]);
  assert.equal(a.certificateId,b.certificateId);
  assert.equal(a.signature,b.signature);
  assert.equal(provider.trustedPublicKeyPem("key:kms:v1"),a.publicKeyPem);
});

test("external signer rejects upstream metadata or signature that does not match pinned authority",async()=>{
  const remote=createSigner();
  const {program,result}=execution();
  const mismatched:ExternalEd25519SigningBackend={
    async sign(request){
      return {
        protocolVersion:"axiom.sign/v1",keyId:"key:other",algorithm:"Ed25519",
        signingIntentId:request.signingIntentId,payloadHash:request.payloadHash,
        signatureBase64:sign(null,Buffer.from(request.payloadBase64,"base64"),remote.privateKey).toString("base64")
      };
    }
  };
  const provider=createExternalEd25519SignerProvider({
    providerId:"kms:test",activeKeyId:"key:kms:v1",activePublicKey:remote.publicKey,
    trustedKeys:{"key:kms:v1":remote.publicKey},backend:mismatched
  });
  await assert.rejects(()=>provider.issue(program,result,"2026-10-09T04:10:00.000Z"),/signer response keyId mismatch/i);

  const attacker=createSigner();
  const badSignature:ExternalEd25519SigningBackend={
    async sign(request){
      return {
        protocolVersion:"axiom.sign/v1",keyId:request.keyId,algorithm:"Ed25519",
        signingIntentId:request.signingIntentId,payloadHash:request.payloadHash,
        signatureBase64:sign(null,Buffer.from(request.payloadBase64,"base64"),attacker.privateKey).toString("base64")
      };
    }
  };
  const hostile=createExternalEd25519SignerProvider({
    providerId:"kms:test",activeKeyId:"key:kms:v1",activePublicKey:remote.publicKey,
    trustedKeys:{"key:kms:v1":remote.publicKey},backend:badSignature
  });
  await assert.rejects(()=>hostile.issue(program,result,"2026-10-09T04:10:00.000Z"),/signature verification failed/i);
});

test("local signer exposes the same explicit signer identity contract",()=>{
  const local=createStaticSignerProvider("key:local:v1",createSigner());
  assert.equal(local.identity.protocolVersion,"axiom.signer/v1");
  assert.equal(local.identity.mode,"LOCAL");
  assert.equal(local.identity.providerId,"axiom.local-ed25519");
  assert.equal(local.identity.keyId,"key:local:v1");
  assert.equal(local.identity.algorithm,"Ed25519");
  assert.match(local.identity.publicKeySha256,/^[0-9a-f]{64}$/);
});
