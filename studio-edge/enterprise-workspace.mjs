// Optional enterprise-only API. No workspace endpoint is enabled without both
// externally verified Cloudflare Access identity and dedicated D1 binding.
const ID = /^[A-Za-z0-9_-]{8,64}$/;
const B64 = /^[A-Za-z0-9_-]+$/;
const SITE = 'https://evansmusitu.github.io';
const encoded = value => JSON.stringify(value);
function reply(data, status = 200, origin = '') {
  const headers = {'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','vary':'Origin'};
  if (origin === SITE) headers['access-control-allow-origin'] = SITE;
  return new Response(encoded(data),{status,headers});
}
function fail(code, status, origin) {return reply({code,error:'Enterprise workspace request denied.'},status,origin);}
function decode(segment) {
  if (!B64.test(segment) || segment.length > 8192) throw Error('bad encoding');
  const bytes = atob(segment.replace(/-/g,'+').replace(/_/g,'/') + '='.repeat((4-segment.length%4)%4));
  return Uint8Array.from(bytes, c => c.charCodeAt(0));
}
function object(segment) { return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(decode(segment))); }
function validTeam(domain) { return typeof domain === 'string' && /^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(domain); }
export async function verifyAccessJwt(token, {teamDomain,audience,fetchJwks = fetch,now = Math.floor(Date.now()/1000)}) {
  if (!validTeam(teamDomain) || typeof audience !== 'string' || !ID.test(audience)) throw Error('access configuration');
  if (typeof token !== 'string' || token.length > 10000) throw Error('token');
  const parts = token.split('.');
  if (parts.length !== 3) throw Error('parts');
  const header = object(parts[0]); const claims = object(parts[1]);
  if (header?.alg !== 'RS256' || typeof header.kid !== 'string' || !ID.test(header.kid) || !claims || typeof claims !== 'object') throw Error('header');
  if (claims.iss !== teamDomain || !Array.isArray(claims.aud) || !claims.aud.includes(audience) ||
      typeof claims.exp !== 'number' || !Number.isSafeInteger(claims.exp) || claims.exp <= now ||
      typeof claims.iat !== 'number' || !Number.isSafeInteger(claims.iat) || claims.iat > now + 60 ||
      (claims.nbf !== undefined && (!Number.isSafeInteger(claims.nbf) || claims.nbf > now + 60)) ||
      claims.exp - claims.iat > 86400 || typeof claims.sub !== 'string' ||
      claims.sub.length < 1 || claims.sub.length > 256) throw Error('claims');
  const r = await fetchJwks(teamDomain + '/cdn-cgi/access/certs',{method:'GET',redirect:'error'});
  if (!r?.ok || Number(r.headers?.get('content-length') || 0) > 32768) throw Error('certs');
  const jwks = await r.json();
  const key = jwks.keys?.find(k => k.kid === header.kid && k.kty === 'RSA' && k.alg === 'RS256' && k.use === 'sig');
  if (!key || !key.n || !key.e) throw Error('key');
  const pub = await crypto.subtle.importKey('jwk',{kty:'RSA',n:key.n,e:key.e,alg:'RS256',ext:true},
    {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5',pub,decode(parts[2]),
    new TextEncoder().encode(parts[0]+'.'+parts[1]));
  if (!valid) throw Error('signature');
  return claims.sub;
}
async function limitedJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) throw Error('type');
  const len = Number(request.headers.get('content-length') || 0);
  if (!Number.isSafeInteger(len) || len > 14000) throw Error('size');
  const reader = request.body?.getReader();
  if (!reader) throw Error('empty');
  const parts=[]; let size=0;
  try {while(true) {const {value,done}=await reader.read(); if(done)break;size+=value.byteLength;if(size>14000)throw Error('size');parts.push(value);}}
  finally {await reader.cancel().catch(()=>{});}
  const all=new Uint8Array(size);let offset=0;for(const part of parts){all.set(part,offset);offset+=part.length;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(all));
}
function validEnvelope(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === 'ciphertext,iv,version' && value.version === 1 &&
    typeof value.iv === 'string' && value.iv.length === 16 && B64.test(value.iv) && decode(value.iv).length === 12 &&
    typeof value.ciphertext === 'string' && value.ciphertext.length >= 24 &&
    value.ciphertext.length <= 12000 && B64.test(value.ciphertext) && decode(value.ciphertext).length >= 16;
}
export async function handleEnterpriseWorkspace(request, env, {fetchJwks=fetch,now=Math.floor(Date.now()/1000)}={}) {
  const origin=request.headers.get('origin')||'';
  // This is an independently authenticated API, not the public site's local encrypted vault.
  if (origin && origin !== SITE) return fail('ORIGIN_DENIED',403,origin);
  if (request.method === 'OPTIONS') {
    if(origin !== SITE)return fail('ORIGIN_DENIED',403,origin);
    return new Response(null,{status:204,headers:{'access-control-allow-origin':SITE,
      'access-control-allow-methods':'GET,PUT,DELETE,OPTIONS',
      'access-control-allow-headers':'content-type,cf-access-jwt-assertion',
      'access-control-max-age':'300','vary':'Origin'}});
  }
  if (!env?.WORKSPACE_DB?.prepare || !validTeam(env.ACCESS_TEAM_DOMAIN) || !env.ACCESS_AUDIENCE) return fail('NOT_CONFIGURED',503,origin);
  const parts=new URL(request.url).pathname.split('/');
  if (parts.length !== 6 || parts[1] !== 'api' || parts[2] !== 'enterprise' || parts[3] !== 'tenants' ||
      !ID.test(parts[4]) || parts[5] !== 'artifacts') return fail('NOT_FOUND',404,origin);
  const tenant=parts[4];
  if (!['GET','PUT','DELETE'].includes(request.method))return fail('METHOD_DENIED',405,origin);
  const artifact=new URL(request.url).searchParams.get('id');
  if (artifact !== null && !ID.test(artifact))return fail('INVALID_ID',400,origin);
  if ((request.method==='PUT'||request.method==='DELETE') && artifact === null)return fail('INVALID_ID',400,origin);
  if (request.method==='GET' && artifact === null) return fail('INVALID_ID',400,origin);
  let subject;
  try {subject = await verifyAccessJwt(request.headers.get('cf-access-jwt-assertion'),{
    teamDomain:env.ACCESS_TEAM_DOMAIN,audience:env.ACCESS_AUDIENCE,fetchJwks,now});}
  catch {return fail('AUTH_REQUIRED',401,origin);}
  try {
    const member=await env.WORKSPACE_DB.prepare('SELECT role FROM tenant_memberships WHERE tenant_id = ? AND subject = ? AND status = ?')
      .bind(tenant,subject,'active').first();
    if(!member || !['owner','editor','viewer'].includes(member.role))return fail('NOT_FOUND',404,origin);
    if(request.method!=='GET' && member.role==='viewer')return fail('FORBIDDEN',403,origin);
    if(request.method==='GET') {
      // Authorize in the same SQLite statement as the read, blocking lookup/revocation races.
      const row=await env.WORKSPACE_DB.prepare("SELECT a.iv, a.ciphertext, a.version FROM tenant_artifacts AS a JOIN tenant_memberships AS m ON m.tenant_id = a.tenant_id AND m.subject = ? AND m.status = 'active' AND m.role IN ('owner','editor','viewer') WHERE a.tenant_id = ? AND a.artifact_id = ?")
        .bind(subject,tenant,artifact).first();
      return row?reply({id:artifact,envelope:{iv:row.iv,ciphertext:row.ciphertext,version:row.version}},200,origin):fail('NOT_FOUND',404,origin);
    }
    if(request.method==='PUT') {
      let envelope;
      try {envelope=await limitedJson(request);}catch{return fail('BAD_ENVELOPE',400,origin);}
      try { if(!validEnvelope(envelope))return fail('BAD_ENVELOPE',400,origin); }
      catch { return fail('BAD_ENVELOPE',400,origin); }
      // D1 batch runs statements transactionally. Recheck membership at SQL execution
      // time; SQLite changes() gates the audit event on an actual ciphertext mutation.
      const result=await env.WORKSPACE_DB.batch([
        env.WORKSPACE_DB.prepare("INSERT INTO tenant_artifacts (tenant_id, artifact_id, iv, ciphertext, version, updated_at) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM tenant_memberships WHERE tenant_id = ? AND subject = ? AND status = 'active' AND role IN ('owner','editor')) ON CONFLICT(tenant_id, artifact_id) DO UPDATE SET iv=excluded.iv, ciphertext=excluded.ciphertext, version=excluded.version, updated_at=excluded.updated_at").bind(tenant,artifact,envelope.iv,envelope.ciphertext,1,now,tenant,subject),
        env.WORKSPACE_DB.prepare('INSERT INTO tenant_audit (tenant_id, artifact_id, subject, event, at) SELECT ?, ?, ?, ?, ? WHERE changes() > 0').bind(tenant,artifact,subject,'put',now)
      ]);
      if(result?.[0]?.meta?.changes !== 1) return fail(result?.[0]?.meta?.changes === 0 ? 'NOT_FOUND' : 'STORE_UNAVAILABLE',result?.[0]?.meta?.changes === 0 ? 404 : 503,origin);
      return reply({id:artifact,stored:true,encryptedOpaque:true},200,origin);
    }
    const result=await env.WORKSPACE_DB.batch([
      env.WORKSPACE_DB.prepare("DELETE FROM tenant_artifacts WHERE tenant_id = ? AND artifact_id = ? AND EXISTS (SELECT 1 FROM tenant_memberships WHERE tenant_id = ? AND subject = ? AND status = 'active' AND role IN ('owner','editor'))").bind(tenant,artifact,tenant,subject),
      env.WORKSPACE_DB.prepare('INSERT INTO tenant_audit (tenant_id, artifact_id, subject, event, at) SELECT ?, ?, ?, ?, ? WHERE changes() > 0').bind(tenant,artifact,subject,'delete',now)
    ]);
    if(result?.[0]?.meta?.changes !== 1) return fail(result?.[0]?.meta?.changes === 0 ? 'NOT_FOUND' : 'STORE_UNAVAILABLE',result?.[0]?.meta?.changes === 0 ? 404 : 503,origin);
    return reply({id:artifact,deleted:true,auditRetained:true},200,origin);
  } catch { return fail('STORE_UNAVAILABLE',503,origin); }
}
