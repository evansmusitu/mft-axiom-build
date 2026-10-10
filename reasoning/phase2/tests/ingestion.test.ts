import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { canonicalize, createSigner, type Signer } from "../../phase1/src/index.ts";
import {
  AuthenticatedFactIngestor, WorldStateStore, createIngestionKeyring,
  type IngestionKeyring, type SignedFactEnvelope, type TemporalFact
} from "../src/index.ts";

const tenant={tenantId:"tenant:ingest"};
const now="2026-10-06T04:00:00.000Z";

function fact():TemporalFact {
  return {
    id:"feed-1",entity:"market:xauusd",attribute:"price",
    value:{type:{kind:"number",unit:"USD/oz"},value:2400},
    validFrom:"2026-10-06T03:59:00.000Z",observedAt:"2026-10-06T03:59:00.000Z",
    source:"market-feed:primary",confidence:1
  };
}
function envelope(signer:Signer,overrides:Partial<Omit<SignedFactEnvelope,"signature">>={},signatureSigner=signer):SignedFactEnvelope {
  const base={
    tenantId:tenant.tenantId,keyId:"feed-key-1",issuedAt:"2026-10-06T03:59:30.000Z",
    nonce:"nonce-1",fact:fact(),...overrides
  };
  const signature=sign(null,Buffer.from(canonicalize(base as any)),signatureSigner.privateKey).toString("base64");
  return {...base,signature};
}

test("authenticated ingestion verifies tenant/key/signature/freshness and rejects nonce replay",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"axiom-ingest-")); const db=join(dir,"platform.db");
  const signer=createSigner(),attacker=createSigner();
  const world=new WorldStateStore(db);
  const keyring:IngestionKeyring={
    trustedPublicKeyPem:(tenantId,keyId)=>tenantId===tenant.tenantId&&keyId==="feed-key-1"
      ? signer.publicKey.export({type:"spki",format:"pem"}).toString()
      : undefined
  };
  const ingestor=new AuthenticatedFactIngestor({
    tenant,world,keyring,maxEnvelopeAgeMs:5*60*1000,maxFutureSkewMs:30*1000
  });

  try{
    const accepted=await ingestor.ingest(envelope(signer),now);
    assert.equal(accepted.authentication?.keyId,"feed-key-1");
    assert.equal(accepted.authentication?.nonce,"nonce-1");
    assert.match(accepted.authentication?.envelopeHash??"",/^[0-9a-f]{64}$/);

    const snap=await world.snapshot(tenant,now);
    assert.equal(snap.facts[0].authentication?.envelopeHash,accepted.authentication?.envelopeHash);

    await assert.rejects(()=>ingestor.ingest(envelope(signer),now),/nonce.*replay|already.*used/i);
    await assert.rejects(()=>ingestor.ingest(envelope(signer,{nonce:"nonce-2",keyId:"unknown"}),now),/trusted.*key|unknown.*key/i);
    await assert.rejects(()=>ingestor.ingest(envelope(signer,{nonce:"nonce-3"},attacker),now),/signature/i);
    await assert.rejects(()=>ingestor.ingest(envelope(signer,{nonce:"nonce-4",tenantId:"tenant-other"}),now),/tenant/i);
    await assert.rejects(()=>ingestor.ingest(envelope(signer,{nonce:"nonce-5",issuedAt:"2026-10-06T03:50:00.000Z"}),now),/stale|age/i);
    await assert.rejects(()=>ingestor.ingest(envelope(signer,{nonce:"nonce-6",issuedAt:"2026-10-06T04:01:00.000Z"}),now),/future/i);
  }finally{
    world.close();rmSync(dir,{recursive:true,force:true});
  }
});

test("ingestion keyring keeps tenant/key identity unambiguous and permits only Ed25519 keys",()=>{
  const first=createSigner(),second=createSigner();
  const keyring=createIngestionKeyring({
    "a\0b":{"c":first.publicKey},
    "a":{"b\0c":second.publicKey}
  });
  const firstPem=first.publicKey.export({type:"spki",format:"pem"}).toString();
  const secondPem=second.publicKey.export({type:"spki",format:"pem"}).toString();
  assert.equal(keyring.trustedPublicKeyPem("a\0b","c"),firstPem);
  assert.equal(keyring.trustedPublicKeyPem("a","b\0c"),secondPem);

  const rsa=generateKeyPairSync("rsa",{modulusLength:2048});
  assert.throws(
    ()=>createIngestionKeyring({"tenant":{"rsa-key":rsa.publicKey}}),
    /ed25519/i
  );
});


test("authenticated ingestion rejects signed facts that are not in canonical persistence form",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"axiom-ingest-canonical-")); const db=join(dir,"platform.db");
  const signer=createSigner(),world=new WorldStateStore(db);
  const keyring=createIngestionKeyring({[tenant.tenantId]:{"feed-key-1":signer.publicKey}});
  const ingestor=new AuthenticatedFactIngestor({tenant,world,keyring,maxEnvelopeAgeMs:5*60*1000,maxFutureSkewMs:30*1000});
  try{
    const nonCanonicalTime=envelope(signer,{
      nonce:"nonce-noncanonical-time",
      fact:{...fact(),id:"feed-noncanonical-time",validFrom:"2026-10-06T03:59:00Z"}
    });
    await assert.rejects(()=>ingestor.ingest(nonCanonicalTime,now),/validFrom.*canonical|canonical.*validFrom/i);

    const unsortedSupersedes=envelope(signer,{
      nonce:"nonce-unsorted-supersedes",
      fact:{...fact(),id:"feed-unsorted-supersedes",supersedes:["z","a"]}
    });
    await assert.rejects(()=>ingestor.ingest(unsortedSupersedes,now),/supersedes.*canonical|canonical.*supersedes|supersedes.*sorted/i);

    const authNull=envelope(signer,{
      nonce:"nonce-auth-field",
      fact:{...fact(),id:"feed-auth-field",authentication:null as any} as any
    });
    await assert.rejects(()=>ingestor.ingest(authNull,now),/authentication/i);
  }finally{
    world.close();rmSync(dir,{recursive:true,force:true});
  }
});

test("SQLite authenticated ingestion rolls back nonce reservation when fact persistence fails",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"axiom-ingest-atomic-")); const db=join(dir,"platform.db");
  const signer=createSigner(),world=new WorldStateStore(db);
  const keyring=createIngestionKeyring({[tenant.tenantId]:{"feed-key-1":signer.publicKey}});
  const ingestor=new AuthenticatedFactIngestor({tenant,world,keyring,maxEnvelopeAgeMs:5*60*1000,maxFutureSkewMs:30*1000});
  try{
    await world.putFact(tenant,{...fact(),id:"duplicate-fact"});
    await assert.rejects(
      ()=>ingestor.ingest(envelope(signer,{nonce:"nonce-atomic",fact:{...fact(),id:"duplicate-fact"}}),now),
      /unique|constraint|duplicate/i
    );
    const accepted=await ingestor.ingest(
      envelope(signer,{nonce:"nonce-atomic",fact:{...fact(),id:"retry-fact"}}),
      now
    );
    assert.equal(accepted.id,"retry-fact");
  }finally{
    world.close();rmSync(dir,{recursive:true,force:true});
  }
});
