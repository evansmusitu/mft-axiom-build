// Private, development-only linking seam. Never mount this write on public ingress.
// The separate account authority must verify the EXISTING production customer,
// consent and (for legacy links) key ownership; it must never return the key.
import {one,execute} from './ledger.mjs';
import {requestIdentityAssertion,validateSessionAssertion,verifyCustomerSession,sha256} from './identity_session.mjs';
const fail=code=>{throw new Error(code);};
const opaque=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{12,160}$/.test(v);
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
export async function activeIdentityMembership(db,p){
 const row=await one(db,`SELECT i.id AS identity_id,m.role,t.id AS tenant_id FROM identities i
 JOIN memberships m ON m.identity_id=i.id JOIN tenants t ON t.id=m.tenant_id
 WHERE i.issuer=? AND i.external_sub=? AND m.tenant_id=? AND m.status='active' AND t.status='active'`,p.issuer,p.subject,p.tenant_id);
 if(!row)fail('membership_not_authorized');return row;
}
export async function canonicalCustomerForPrincipal(db,p){
 const membership=await activeIdentityMembership(db,p);
 const link=await one(db,'SELECT * FROM canonical_customer_links WHERE identity_id=?',membership.identity_id);
 if(!link)fail('canonical_mapping_required');
 if(link.status!=='active')fail('canonical_link_revoked');
 if(link.tenant_id!==membership.tenant_id||!uuid(link.customer_id))fail('canonical_link_conflict');
 return {...membership,customer_id:link.customer_id};
}
export async function verifyAndLinkCanonicalAccount(request,env,db){
 if(env.IDENTITY_ACCOUNT_LINK_QUALIFIED!=='qualified_private_binding'||!env.IDENTITY_ACCOUNT_LINK_VERIFIER?.fetch)fail('canonical_link_not_qualified');
 const {proof:p,context}=await requestIdentityAssertion(request,env,{binding:env.IDENTITY_ACCOUNT_LINK_VERIFIER,
  qualification:env.IDENTITY_ACCOUNT_LINK_QUALIFIED,audience:'customer-control-plane',purpose:'canonical-account-link',path:'/identity/customer-link-proof'});
 const principal=validateSessionAssertion(p,context);
 if(!uuid(p.production_customer_id)||p.customer_status!=='active'||p.consent_verified!==true||
  !['fresh','legacy'].includes(p.link_kind)||!opaque(p.proof_id)||!opaque(p.consent_id)||!opaque(p.authority_subject)||
  (p.link_kind==='legacy'&&(p.legacy_ownership_verified!==true||!opaque(p.ownership_proof_id))))fail('canonical_link_assurance_required');
 const membership=await activeIdentityMembership(db,principal);
 // Hash only non-secret approval metadata; never store raw cookies, email or keys.
 const receipt={issuer:principal.issuer,subject:principal.subject,tenant_id:membership.tenant_id,
  customer_id:p.production_customer_id,link_kind:p.link_kind,proof_id:p.proof_id,consent_id:p.consent_id,
  authority_subject:p.authority_subject,ownership_proof_id:p.link_kind==='legacy'?p.ownership_proof_id:null};
 const proof_sha256=await sha256(JSON.stringify(receipt));
 const check=link=>{
  if(link.status!=='active')fail('canonical_link_revoked');
  if(link.customer_id!==p.production_customer_id||link.tenant_id!==membership.tenant_id||
   link.proof_id!==p.proof_id||link.proof_sha256!==proof_sha256)fail('canonical_link_conflict');
  return {...membership,customer_id:link.customer_id};
 };
 const existing=await one(db,'SELECT * FROM canonical_customer_links WHERE identity_id=?',membership.identity_id);
 if(existing)return check(existing);
 try{
  // Membership is checked AGAIN in the mutation, preventing revocation between
  // the asynchronous read and write from admitting a new link.
  await execute(db,`INSERT INTO canonical_customer_links(identity_id,tenant_id,customer_id,link_kind,proof_id,proof_sha256,consent_id,authority_subject)
   SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM memberships m JOIN tenants t ON t.id=m.tenant_id
   WHERE m.identity_id=? AND m.tenant_id=? AND m.status='active' AND t.status='active')`,
   membership.identity_id,membership.tenant_id,p.production_customer_id,p.link_kind,p.proof_id,proof_sha256,p.consent_id,p.authority_subject,
   membership.identity_id,membership.tenant_id);
 }catch{
  const prior=await one(db,'SELECT * FROM canonical_customer_links WHERE identity_id=?',membership.identity_id);
  if(prior)return check(prior);fail('canonical_link_conflict');
 }
 await activeIdentityMembership(db,principal);
 const saved=await one(db,'SELECT * FROM canonical_customer_links WHERE identity_id=?',membership.identity_id);
 if(!saved)fail('membership_not_authorized');return check(saved);
}
export async function resolveOAuthCustomer(request,env,db){
 // Candidate only: intentionally not wired to the live OAuth worker or token mint.
 return canonicalCustomerForPrincipal(db,await verifyCustomerSession(request,env,{audience:'axiom-chatgpt-oauth'}));
}
