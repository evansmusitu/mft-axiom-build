// Credentialless customer enrollment. Only accepts fresh attestation from an independently
// qualified, private service binding. Client JSON and OAuth account keys are never proof.
import {one,atomic} from './ledger.mjs';
const invalid = (s)=>{throw new Error(s)};
const string=(x,n=160)=>typeof x==='string'&&x.length>0&&x.length<=n;
const sha=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(b=>b.toString(16).padStart(2,'0')).join('');
export function validateEnrollmentAttestation(a,now=Date.now()){
 if(!a||a.verified!==true||a.production_qualified!==true||a.audience!=='customer-control-plane'||a.email_verified!==true||a.mfa_verified!==true||a.tenant_kind!=='personal')invalid('enrollment_assurance_required');
 if(!string(a.issuer,200)||!string(a.subject,240)||!string(a.proof_id,160)||!string(a.verifier_identity,160)||!/^[a-zA-Z0-9_:.\-/]{12,160}$/.test(a.proof_id))invalid('invalid_enrollment_principal');
 let issuer;try{issuer=new URL(a.issuer)}catch{invalid('invalid_enrollment_issuer')}
 if(issuer.protocol!=='https:'||issuer.username||issuer.password||issuer.search||issuer.hash||a.issuer!==issuer.origin)invalid('invalid_enrollment_issuer');
 // Only the identity broker is allowed to assert these timestamps, not the browser.
 if(!Number.isSafeInteger(a.verified_at_ms)||!Number.isSafeInteger(a.expires_at_ms)||a.verified_at_ms>now+30000||now-a.verified_at_ms>300000||a.expires_at_ms<=now||a.expires_at_ms-a.verified_at_ms>300000)invalid('stale_enrollment_evidence');
 return a;
}
export async function provisionPersonalTenant(db,attestation,{now=Date.now()}={}){
 const a=validateEnrollmentAttestation(attestation,now);
 const existing=await one(db,'SELECT i.id,m.tenant_id,m.status FROM identities i LEFT JOIN memberships m ON m.identity_id=i.id WHERE i.issuer=? AND i.external_sub=? ORDER BY m.tenant_id LIMIT 1',a.issuer,a.subject);
 if(existing){
  if(existing.status!=='active')invalid('enrollment_existing_identity_review_required');
  return {tenant_id:existing.tenant_id,identity_id:existing.id,created:false};
 }
 const tenant=crypto.randomUUID(),identity=crypto.randomUUID();const hash=await sha(a.issuer+'\n'+a.subject);
 try{
  await atomic(db,[
   ['INSERT INTO tenants(id,name,status) VALUES(?,?,?)',tenant,'Personal workspace','active'],
   ['INSERT INTO identities(id,issuer,external_sub) VALUES(?,?,?)',identity,a.issuer,a.subject],
   ["INSERT INTO memberships(tenant_id,identity_id,role,status) VALUES(?,?,?,?)",tenant,identity,'owner','active'],
   ['INSERT INTO enrollment_evidence(proof_id,tenant_id,identity_id,issuer,external_sub_hash,verified_at,verifier_identity) VALUES(?,?,?,?,?,?,?)',a.proof_id,tenant,identity,a.issuer,hash,new Date(a.verified_at_ms).toISOString(),a.verifier_identity]
  ]);
 }catch(e){
  // Two genuinely concurrent qualified sessions may enroll the same principal.
  // Never override a revoked membership, conflicting proof, or another tenant.
  const prior=await one(db,'SELECT i.id,m.tenant_id,m.status FROM identities i JOIN memberships m ON m.identity_id=i.id WHERE i.issuer=? AND i.external_sub=?',a.issuer,a.subject);
  if(prior?.status==='active')return {tenant_id:prior.tenant_id,identity_id:prior.id,created:false};
  throw e;
 }
 return {tenant_id:tenant,identity_id:identity,created:true};
}
export async function verifyAndEnroll(request,env,db){
 if(env.IDENTITY_ENROLLMENT_QUALIFIED!=='qualified_private_binding'||!env.IDENTITY_ENROLLMENT_VERIFIER?.fetch)invalid('enrollment_not_qualified');
 const attested=await env.IDENTITY_ENROLLMENT_VERIFIER.fetch(new Request('https://axiom-internal/identity/enrollment-proof',{method:'POST',headers:{cookie:request.headers.get('cookie')||'','x-axiom-purpose':'qualified-enrollment'},redirect:'error'}));
 if(attested.status!==200)invalid('enrollment_proof_unavailable');
 return provisionPersonalTenant(db,await attested.json());
}
