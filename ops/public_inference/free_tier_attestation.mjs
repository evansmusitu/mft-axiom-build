/**
 * Verifies an independently signed short-lived free-provider account assertion.
 * The independent issuer, account audit and live billing/terms checks are NOT
 * implemented here. A signed assertion is not provider-native billing proof.
 * No public/production release may be inferred from this module.
 */
export class FreeTierDenied extends Error {
  constructor() { super('FREE_PROVIDER_PROOF_NOT_VERIFIED'); }
}
const PROOF_SCHEMA='musitu.axiom.zero-cash-free-provider-proof.v1';
const HEX64=/^[0-9a-f]{64}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,79}$/;
const PAIRS=Object.freeze({
  cloudflare:'@cf/zai-org/glm-4.7-flash',
  groq:'openai/gpt-oss-120b',
});
const FIELDS=[
  'schema','provider','model','account_tier','account_ref_sha256',
  'evidence_sha256','builder_id','independent_reviewer_id',
  'verified_no_overage','commercial_customer_use_allowed',
  'cash_ceiling_usd','issued_ms','expires_ms',
];
const ALLOWED=new Set(FIELDS);

export async function verifyFreeTierAttestation(provider,model,env,now){
  if (typeof provider!=='string' || !Object.hasOwn(PAIRS,provider) || PAIRS[provider]!==model ||
      !env || typeof env!=='object' || !Number.isSafeInteger(now)) throw new FreeTierDenied();
  const key=env.AXIOM_FREE_PROVIDER_PROOF_KEY;
  const capKey=env.AXIOM_CAPABILITY_HMAC_KEY;
  const prefix=provider.toUpperCase();
  const token=env[`AXIOM_${prefix}_FREE_PROOF_TOKEN`];
  const signature=env[`AXIOM_${prefix}_FREE_PROOF_HMAC`];
  if (typeof key!=='string' || key.length<48 || key.length>256 ||
      typeof capKey!=='string' || key===capKey ||
      typeof token!=='string' || token.length<20 || token.length>2500 ||
      !/^[A-Za-z0-9_-]+$/.test(token) ||
      typeof signature!=='string' || !HEX64.test(signature)) throw new FreeTierDenied();
  try{
    const decoder=new TextDecoder('utf-8',{fatal:true});
    const buf=Uint8Array.from(atob(token.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
    const claims=JSON.parse(decoder.decode(buf));
    if(!claims || typeof claims!=='object' || Array.isArray(claims) ||
       Object.keys(claims).length!==FIELDS.length ||
       Object.keys(claims).some(k=>!ALLOWED.has(k))) throw new FreeTierDenied();
    const mac=await crypto.subtle.importKey('raw',new TextEncoder().encode(key),
      {name:'HMAC',hash:'SHA-256'},false,['verify']);
    const signatureBytes=Uint8Array.from(signature.match(/../g),x=>parseInt(x,16));
    const okay=await crypto.subtle.verify('HMAC',mac,signatureBytes,new TextEncoder().encode(token));
    if(!okay || claims.schema!==PROOF_SCHEMA || claims.provider!==provider || claims.model!==model ||
       claims.account_tier!=='FREE' || claims.cash_ceiling_usd!=='0.00' ||
       claims.verified_no_overage!==true || claims.commercial_customer_use_allowed!==true ||
       typeof claims.account_ref_sha256!=='string' || !HEX64.test(claims.account_ref_sha256) ||
       typeof claims.evidence_sha256!=='string' || !HEX64.test(claims.evidence_sha256) ||
       typeof claims.builder_id!=='string' || !ID.test(claims.builder_id) ||
       typeof claims.independent_reviewer_id!=='string' || !ID.test(claims.independent_reviewer_id) ||
       claims.builder_id===claims.independent_reviewer_id ||
       !Number.isSafeInteger(claims.issued_ms) || !Number.isSafeInteger(claims.expires_ms) ||
       claims.expires_ms<=claims.issued_ms || claims.expires_ms-claims.issued_ms>86400000 ||
       now<claims.issued_ms || now>=claims.expires_ms) throw new FreeTierDenied();
    return Object.freeze({
      schema:'musitu.axiom.free-account-admission-receipt.v1',
      provider, cash_ceiling_usd:'0.00',verified_no_overage:true,
      public_release_authority:false,
      live_account_verification:'NOT_PROVEN',
    });
  }catch {throw new FreeTierDenied();}
}
