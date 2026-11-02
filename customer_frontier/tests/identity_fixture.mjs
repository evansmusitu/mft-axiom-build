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
