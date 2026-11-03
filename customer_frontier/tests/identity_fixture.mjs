// OFFLINE TEST TRANSPORT ONLY. These assertions do not authenticate real users.
export class SessionRequest extends globalThis.Request {
 constructor(input,options={}){
  const headers=new Headers(options.headers|| (input instanceof globalThis.Request?input.headers:undefined));
  if(!headers.has('cookie')&&!headers.has('authorization'))headers.set('cookie','__Host-axiom_session=offline-fixture');
  super(input,{...options,headers});
 }
}
export async function sessionFixture(request,principal){
 const {challenge,request_sha256,audience}=await request.json(),now=Date.now();
 return {...principal,verified:true,session_id:'offline-fixture-session-123456789',session_version:1,
  audience:principal.audience??audience,email_verified:true,mfa_verified:true,revoked:false,
  state_verified:true,nonce_verified:true,pkce_method:'S256',issued_at_ms:now-1000,
  auth_time_ms:now-2000,verified_at_ms:now,expires_at_ms:now+60000,challenge,request_sha256};
}
export async function oauthProofFixture(request,principal){
 const baseline=await sessionFixture(request,principal);
 const auth=principal.auth_at_ms??baseline.auth_time_ms;
 return {...baseline,...principal,auth_time_ms:auth,issued_at_ms:Math.max(baseline.issued_at_ms,auth)};
}
export function seedCanonicalFixture(db,{issuer,subject,tenant,customer,witness='a'.repeat(64)}){
 const identity=tenant+'-identity';
 db._sqlite.prepare('INSERT INTO tenants(id,name) VALUES(?,?)').run(tenant,'Offline fixture');
 db._sqlite.prepare('INSERT INTO identities(id,issuer,external_sub) VALUES(?,?,?)').run(identity,issuer,subject);
 db._sqlite.prepare("INSERT INTO memberships(tenant_id,identity_id,role) VALUES(?,?,'viewer')").run(tenant,identity);
 db._sqlite.prepare("INSERT INTO canonical_customer_links(identity_id,tenant_id,customer_id,link_kind,proof_id,proof_sha256,consent_id,authority_subject) VALUES(?,?,?,'legacy',?,?,?,?)")
  .run(identity,tenant,customer,'proof-'+identity,witness,'consent-'+identity,'authority-offline');
}
