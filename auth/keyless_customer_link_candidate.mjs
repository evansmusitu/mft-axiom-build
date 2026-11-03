// Staging source candidate only. No public linking, customer creation or billing.
// The two databases remain distinct; failure/unavailability in either denies access.
import {requestIdentityAssertion,validateSessionAssertion,sha256} from '../customer_frontier/customer_control_plane/identity_session.mjs';
import {canonicalCustomerForPrincipal} from '../customer_frontier/customer_control_plane/canonical_identity.mjs';
const deny=code=>{throw new Error(code);};
export async function assertCanonicalOAuthLink(env,link){
 if(!env?.CUSTOMER_DB?.prepare)deny('canonical_mapping_unavailable');
 const p=await env.CUSTOMER_DB.prepare(`SELECT i.issuer,i.external_sub AS subject,l.tenant_id,l.customer_id
 FROM canonical_customer_links l JOIN identities i ON i.id=l.identity_id
 WHERE l.customer_id=? AND l.tenant_id=? AND l.status='active'`).bind(link.customer_id,link.tenant_id).first();
 if(!p||p.issuer!==link.issuer||await sha256(p.issuer+'\n'+p.subject)!==link.subject_sha256)deny('canonical_mapping_mismatch');
 const canonical=await canonicalCustomerForPrincipal(env.CUSTOMER_DB,p);
 if(canonical.customer_id!==link.customer_id||canonical.tenant_id!==link.tenant_id)deny('canonical_mapping_mismatch');
 return canonical;
}
export async function resolveVerifiedOAuthCustomer({request,env,db,flowId,now=Date.now()}={}){
 if(env?.OAUTH_KEYLESS_QUALIFIED!=='qualified_private_binding')deny('keyless_not_qualified');
 if(!db?.prepare||typeof flowId!=='string'||!/^flow_[A-Za-z0-9_-]{16,155}$/.test(flowId))deny('oauth_flow_invalid');
 if(!Number.isSafeInteger(now))deny('oauth_time_invalid');
 if(env.OAUTH_IDENTITY_ISSUER!==env.CUSTOMER_IDENTITY_ISSUER)deny('identity_issuer_not_qualified');
 const {proof,context}=await requestIdentityAssertion(request,env,{binding:env.OAUTH_SESSION_VERIFIER,
  qualification:env.OAUTH_KEYLESS_QUALIFIED,audience:'axiom-chatgpt-oauth',purpose:'oauth-existing-customer-link',
  path:'/identity/verify-oauth-session',bindingContext:{flow_id:flowId}});
 const principal=validateSessionAssertion(proof,{...context,now});
 if(proof.production_qualified!==true||proof.flow_id!==flowId)deny('identity_assurance_denied');
 // Preserve PR65's stronger recent-authentication bound for OAuth consent.
 if(now-proof.auth_time_ms>300000||proof.expires_at_ms-proof.auth_time_ms>300000)deny('identity_session_stale');
 const hashed=await sha256(principal.issuer+'\n'+principal.subject);
 const row=await db.prepare(`SELECT l.customer_id,l.tenant_id,l.issuer,l.subject_sha256,l.witness_sha256
 FROM oauth_identity_links l JOIN customers c ON c.id=l.customer_id
 WHERE l.issuer=? AND l.subject_sha256=? AND l.tenant_id=? AND l.state='active' AND c.status='active'`)
 .bind(principal.issuer,hashed,principal.tenant_id).first();
 if(!row)deny('identity_not_linked');
 await assertCanonicalOAuthLink(env,row);
 return {customer_id:row.customer_id,tenant_id:row.tenant_id};
}
