// Isolated Gate4 admission candidate. No writes, hosted qualification or cache.
import {assertCanonicalOAuthLink} from './keyless_customer_link_candidate.mjs';
import {pinnedIdentityIssuer,sha256} from '../customer_frontier/customer_control_plane/identity_session.mjs';

const no=()=>{throw new Error('canonical_mcp_not_authorized');};
function origin(value){
 let u;try{u=new URL(value);}catch{no();}
 if(typeof value!=='string'||u.protocol!=='https:'||u.origin!==value||u.username||u.password)no();
 return value;
}
const future=(value,now)=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&Date.parse(value)>now;

async function context(db,tokenHash,issuer,resource,identityIssuer){
 const row=await db.prepare(`SELECT a.api_key_id,a.customer_id,a.issuer,a.resource,a.scope,a.expires_at,a.revoked_at,
 k.customer_id AS key_customer_id,k.status AS key_status,k.expires_at AS key_expires,k.revoked_at AS key_revoked,
 c.status AS customer_status,t.issuer AS identity_issuer,t.subject_sha256,t.tenant_id,
 t.customer_id AS linked_customer_id,l.customer_id AS identity_customer_id,l.tenant_id AS identity_tenant_id,l.state AS identity_state
 FROM oauth_access_tokens a JOIN api_keys k ON k.id=a.api_key_id JOIN customers c ON c.id=a.customer_id
 LEFT JOIN oauth_identity_token_links t ON t.api_key_id=a.api_key_id
 LEFT JOIN oauth_identity_links l ON l.issuer=t.issuer AND l.subject_sha256=t.subject_sha256
 WHERE a.token_hash=? LIMIT 1`).bind(tokenHash).first();
 const now=Date.now();
 if(!row||row.customer_status!=='active'||row.key_status!=='active'||row.revoked_at!==null||row.key_revoked!==null||
    !future(row.expires_at,now)||(row.key_expires!==null&&!future(row.key_expires,now))||
    row.customer_id!==row.key_customer_id||row.customer_id!==row.linked_customer_id||
    row.customer_id!==row.identity_customer_id||row.tenant_id!==row.identity_tenant_id||
    typeof row.tenant_id!=='string'||!row.tenant_id||row.identity_state!=='active'||
    row.issuer!==issuer||row.resource!==resource||row.identity_issuer!==identityIssuer||
    !/^[0-9a-f]{64}$/.test(row.subject_sha256??'')||
    !new Set(String(row.scope??'').split(/\s+/)).has('axiom.execute'))no();
 return {api_key_id:row.api_key_id,customer_id:row.customer_id,issuer:row.identity_issuer,
  subject_sha256:row.subject_sha256,tenant_id:row.tenant_id};
}

export async function authorizeCanonicalMCP(request,env){
 try{
  if(env?.MCP_CANONICAL_QUALIFIED!=='qualified_private_binding'||
     env.OAUTH_KEYLESS_QUALIFIED!=='qualified_private_binding'||
     typeof env.AXIOM_DB?.prepare!=='function'||typeof env.CUSTOMER_DB?.prepare!=='function')no();
  const identityIssuer=pinnedIdentityIssuer(env);
  if(env.OAUTH_IDENTITY_ISSUER!==identityIssuer)no();
  const issuer=origin(env.AUTH_ISSUER||'https://auth.mftintelligence.com');
  const resource=origin(env.MCP_PUBLIC_BASE||'https://mcp.mftintelligence.com');
  const credential=request.headers.get('authorization')||'';
  if(!/^Bearer [A-Za-z0-9._~-]{16,4096}$/.test(credential))no();
  const tokenHash=await sha256(credential.slice(7));
  const before=await context(env.AXIOM_DB,tokenHash,issuer,resource,identityIssuer);
  await assertCanonicalOAuthLink(env,before);
  // Deny token/key/link changes committed while the separate canonical DB was
  // being read. These checks do not create distributed atomicity or a lease.
  const after=await context(env.AXIOM_DB,tokenHash,issuer,resource,identityIssuer);
  if(JSON.stringify(before)!==JSON.stringify(after))no();
  return {ok:true,customer_id:after.customer_id,tenant_id:after.tenant_id};
 }catch{
  // Never expose tokens, database/provider errors or private identity metadata.
  return {ok:false};
 }
}
