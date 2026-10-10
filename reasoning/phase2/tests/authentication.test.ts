import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";

function b64url(value:string|Buffer):string {
  return Buffer.from(value).toString("base64url");
}
function compactJwt(
  privateKey:any,
  header:Record<string,unknown>,
  payload:Record<string,unknown>
):string {
  const encodedHeader=b64url(JSON.stringify(header));
  const encodedPayload=b64url(JSON.stringify(payload));
  const signingInput=`${encodedHeader}.${encodedPayload}`;
  const signature=sign(null,Buffer.from(signingInput),privateKey).toString("base64url");
  return `${signingInput}.${signature}`;
}

test("Phase-2 exposes an Ed25519 JWT caller-authentication boundary",async()=>{
  const phase2=await import("../src/index.ts");
  assert.equal(typeof (phase2 as any).Ed25519JwtAuthenticator,"function");
  assert.equal(typeof (phase2 as any).createJwtTrustStore,"function");
});

test("Ed25519 JWT authentication derives collision-safe principals and ignores authorization claims",async()=>{
  const phase2:any=await import("../src/index.ts");
  assert.equal(typeof phase2.Ed25519JwtAuthenticator,"function");

  const a=generateKeyPairSync("ed25519");
  const b=generateKeyPairSync("ed25519");
  const trustStore=phase2.createJwtTrustStore({
    "https://issuer-a.example":{"key-1":a.publicKey},
    "https://issuer-b.example":{"key-1":b.publicKey}
  });
  const authenticator=new phase2.Ed25519JwtAuthenticator({
    trustStore,
    audience:"axiom-api",
    maxTokenAgeMs:5*60*1000,
    maxTokenLifetimeMs:10*60*1000,
    maxClockSkewMs:30*1000
  });
  const now="2026-10-06T10:00:00.000Z";
  const base={
    sub:"service:alpha",aud:"axiom-api",jti:"jwt-1",
    iat:1791280770,exp:1791281100,
    tenantId:"tenant:forged",roles:["admin"],scope:"*"
  };
  const tokenA=compactJwt(a.privateKey,{alg:"EdDSA",typ:"at+jwt",kid:"key-1"},{...base,iss:"https://issuer-a.example"});
  const tokenB=compactJwt(b.privateKey,{alg:"EdDSA",typ:"at+jwt",kid:"key-1"},{...base,jti:"jwt-2",iss:"https://issuer-b.example"});
  const principalA=await authenticator.authenticate(tokenA,now);
  const principalB=await authenticator.authenticate(tokenB,now);

  assert.notEqual(principalA.principal.principalId,principalB.principal.principalId);
  assert.deepEqual(Object.keys(principalA).sort(),["credential","principal"]);
  assert.deepEqual(Object.keys(principalA.principal).sort(),["issuer","principalId","subject"]);
  assert.deepEqual(Object.keys(principalA.credential).sort(),["expiresAt","issuedAt","issuer","jwtId","keyId","subject","tokenHash"]);
  assert.equal(principalA.principal.issuer,"https://issuer-a.example");
  assert.equal(principalA.principal.subject,"service:alpha");
  assert.match(principalA.principal.principalId,/^principal:[0-9a-f]{64}$/);
  assert.match(principalA.credential.tokenHash,/^[0-9a-f]{64}$/);
  assert.equal(principalA.credential.tokenHash.includes(tokenA),false);
});

test("Ed25519 JWT authentication fails closed on trust, header, audience, signature, claim, and time errors",async()=>{
  const phase2:any=await import("../src/index.ts");
  assert.equal(typeof phase2.Ed25519JwtAuthenticator,"function");

  const signer=generateKeyPairSync("ed25519");
  const attacker=generateKeyPairSync("ed25519");
  const trustStore=phase2.createJwtTrustStore({"https://issuer.example":{"key-1":signer.publicKey}});
  const auth=new phase2.Ed25519JwtAuthenticator({
    trustStore,audience:"axiom-api",
    maxTokenAgeMs:5*60*1000,maxTokenLifetimeMs:10*60*1000,maxClockSkewMs:30*1000
  });
  const now="2026-10-06T10:00:00.000Z";
  const valid={iss:"https://issuer.example",sub:"service:alpha",aud:"axiom-api",jti:"jwt-ok",iat:1791280770,exp:1791281100};
  const header={alg:"EdDSA",typ:"at+jwt",kid:"key-1"};

  await assert.rejects(()=>auth.authenticate("not-a-jwt",now),/token|jwt|credential|malformed/i);
  await assert.rejects(()=>auth.authenticate(compactJwt(signer.privateKey,{...header,kid:"unknown"},valid),now),/token|jwt|credential|trusted|key/i);
  await assert.rejects(()=>auth.authenticate(compactJwt(signer.privateKey,header,{...valid,iss:"https://unknown.example"}),now),/token|jwt|credential|trusted|issuer/i);
  await assert.rejects(()=>auth.authenticate(compactJwt(signer.privateKey,{...header,typ:"JWT"},valid),now),/typ|token|jwt|credential/i);
  await assert.rejects(()=>auth.authenticate(compactJwt(signer.privateKey,{...header,alg:"RS256"},valid),now),/alg|token|jwt|credential/i);
  await assert.rejects(()=>auth.authenticate(compactJwt(attacker.privateKey,header,valid),now),/signature|token|jwt|credential/i);
  await assert.rejects(()=>auth.authenticate(compactJwt(signer.privateKey,header,{...valid,aud:"other"}),now),/aud|token|jwt|credential/i);
  await assert.rejects(()=>auth.authenticate(compactJwt(signer.privateKey,header,{...valid,sub:""}),now),/sub|claim|token|jwt|credential/i);
  await assert.rejects(()=>auth.authenticate(compactJwt(signer.privateKey,header,{...valid,exp:1791280700}),now),/exp|expired|token|jwt|credential/i);
  await assert.rejects(()=>auth.authenticate(compactJwt(signer.privateKey,header,{...valid,nbf:1791280861}),now),/nbf|valid|token|jwt|credential/i);
  await assert.rejects(()=>auth.authenticate(compactJwt(signer.privateKey,header,{...valid,iat:1791280440,exp:1791281040,jti:"old"}),now),/age|iat|token|jwt|credential/i);
  await assert.rejects(()=>auth.authenticate(compactJwt(signer.privateKey,header,{...valid,iat:1791280770,exp:1791282000,jti:"long"}),now),/lifetime|exp|token|jwt|credential/i);

  const rsa=generateKeyPairSync("rsa",{modulusLength:2048});
  assert.throws(
    ()=>phase2.createJwtTrustStore({"https://issuer.example":{"rsa":rsa.publicKey}}),
    /ed25519/i
  );
});
