import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {verifyFreeTierAttestation,FreeTierDenied} from './free_tier_attestation.mjs';

const NOW=Date.UTC(2026,9,9,9,0);
const POLICY_KEY='Q'.repeat(64);
const WORKER_KEY='S'.repeat(64);
const MODELS={cloudflare:'@cf/zai-org/glm-4.7-flash',groq:'openai/gpt-oss-120b'};
export function signedFreeProof(provider='cloudflare',updates={}){
  const claims={schema:'musitu.axiom.zero-cash-free-provider-proof.v1',provider,model:MODELS[provider],
    account_tier:'FREE',account_ref_sha256:'b'.repeat(64),evidence_sha256:'c'.repeat(64),
    builder_id:'axiom-builder',independent_reviewer_id:'human-security-reviewer',
    verified_no_overage:true,commercial_customer_use_allowed:true,cash_ceiling_usd:'0.00',
    issued_ms:NOW-1000,expires_ms:NOW+60000,...updates};
  const token=Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature=createHmac('sha256',POLICY_KEY).update(token).digest('hex');
  return {claims,token,signature};
}
function envWithProof(provider='cloudflare',updates={}){
  const p=signedFreeProof(provider,updates);
  return {AXIOM_FREE_PROVIDER_PROOF_KEY:POLICY_KEY,AXIOM_CAPABILITY_HMAC_KEY:WORKER_KEY,
    [`AXIOM_${provider.toUpperCase()}_FREE_PROOF_TOKEN`]:p.token,
    [`AXIOM_${provider.toUpperCase()}_FREE_PROOF_HMAC`]:p.signature};
}

test('accepts exact independent signed free-provider proof but grants no release authority',async()=>{
  for(const provider of ['cloudflare','groq']){
    const result=await verifyFreeTierAttestation(provider,MODELS[provider],envWithProof(provider),NOW);
    assert.equal(result.provider,provider);
    assert.equal(result.cash_ceiling_usd,'0.00');
    assert.equal(result.verified_no_overage,true);
    assert.equal(result.public_release_authority,false);
    assert.equal(result.live_account_verification,'NOT_PROVEN');
    assert.doesNotMatch(JSON.stringify(result),/QQQQQ|SSSSS|[bc]{64}/);
  }
});

test('rejects boolean attestation flags without independent proof',async()=>{
  const env={AXIOM_FREE_ACCOUNT_ATTESTED:'TRUE',AXIOM_GROQ_FREE_ORG_ATTESTED:'TRUE'};
  await assert.rejects(()=>verifyFreeTierAttestation('cloudflare',MODELS.cloudflare,env,NOW),FreeTierDenied);
});

test('rejects stale, wrong scope, billing-enabled, and self-reviewed claims',async()=>{
  const cases=[
    {account_tier:'PAID'}, {verified_no_overage:false}, {cash_ceiling_usd:'0.01'},
    {commercial_customer_use_allowed:false},{independent_reviewer_id:'axiom-builder'},
    {expires_ms:NOW-1},{issued_ms:NOW+1000},{expires_ms:NOW+90000000},
    {model:MODELS.groq},{provider:'groq'}, {evidence_sha256:null},
    {builder_id:123}, {unexpected:'untrusted extra'}
  ];
  for(const c of cases){
    await assert.rejects(()=>verifyFreeTierAttestation('cloudflare',MODELS.cloudflare,envWithProof('cloudflare',c),NOW),FreeTierDenied,
      `unexpectedly accepted ${JSON.stringify(c)}`);
  }
});

test('rejects a forged free-tier attestation and same key reused by capability signer',async()=>{
  const env=envWithProof(); env.AXIOM_CLOUDFLARE_FREE_PROOF_HMAC='a'.repeat(64);
  await assert.rejects(()=>verifyFreeTierAttestation('cloudflare',MODELS.cloudflare,env,NOW),FreeTierDenied);
  const e=envWithProof();e.AXIOM_CAPABILITY_HMAC_KEY=POLICY_KEY;
  await assert.rejects(()=>verifyFreeTierAttestation('cloudflare',MODELS.cloudflare,e,NOW),FreeTierDenied);
});

test('rejects unknown provider, missing account proof or invalid signature key',async()=>{
  const env=envWithProof();
  for(const provider of ['openai','__proto__','none'])
    await assert.rejects(()=>verifyFreeTierAttestation(provider,'x',env,NOW),FreeTierDenied);
  delete env.AXIOM_CLOUDFLARE_FREE_PROOF_HMAC;
  await assert.rejects(()=>verifyFreeTierAttestation('cloudflare',MODELS.cloudflare,env,NOW),FreeTierDenied);
});
