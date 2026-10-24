/** A safe status read; it never returns an identity, token or session handle. */
const denied=new Set(['SESSION_REQUIRED','SESSION_REVOKED','SESSION_MFA_REQUIRED','TOKEN_SUBJECT_REJECTED','TOKEN_CLIENT_REJECTED','OIDC_NONCE_OR_SUBJECT_REJECTED','OIDC_MFA_REQUIRED','OIDC_AUTH_TIME_REJECTED','ERR_JWT_EXPIRED','ERR_JWT_CLAIM_VALIDATION_FAILED','ERR_JWS_SIGNATURE_VERIFICATION_FAILED','ERR_JWE_INVALID','ERR_JWE_DECRYPTION_FAILED']);
export function createSessionStatusHandler({authenticate}){
 return async function GET(request){
  const headers={'cache-control':'no-store','referrer-policy':'no-referrer'};
  try{
   const actor=await authenticate(request);
   if(typeof actor?.subject!=='string'||!actor.subject)throw Error('SESSION_REQUIRED');
   return Response.json({signedIn:true},{headers});
  }catch(error){
   const rejected=denied.has(error?.code)||denied.has(error?.message);
   return Response.json({signedIn:rejected?false:null},{status:rejected?401:503,headers});
  }
 };
}
