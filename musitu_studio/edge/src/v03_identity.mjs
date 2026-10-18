import {createRemoteJWKSet,jwtVerify} from 'jose';
import {validSubject} from './v03_policy.mjs';

const jwks=new Map();
/** Only cryptographically verified human Cloudflare Access app sessions. */
export async function verifiedV03Identity(request,env,options={}){
  const domain=env.STUDIO_ACCESS_TEAM_DOMAIN;
  const audience=env.STUDIO_ACCESS_POLICY_AUD;
  const token=request.headers.get('cf-access-jwt-assertion');
  if(typeof domain!=='string'||!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(domain)||
     typeof audience!=='string'||!/^[0-9a-f]{64}$/i.test(audience)||
     typeof token!=='string'||token.length<100||token.length>8192)return null;
  try{
    let keyset=options.keySet??jwks.get(domain);
    if(!keyset){
      keyset=createRemoteJWKSet(new URL(domain+'/cdn-cgi/access/certs'),{timeoutDuration:3000});
      jwks.set(domain,keyset);
    }
    const {payload}=await jwtVerify(token,keyset,{
      issuer:domain,audience,algorithms:['RS256'],clockTolerance:5
    });
    // Service-token sessions must never be treated as named staff.
    if(payload.type!=='app'||!validSubject(payload.sub)||typeof payload.email!=='string'||
       !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)||payload.email.length>254)return null;
    return {sub:payload.sub,email:payload.email.toLowerCase()};
  }catch{return null}
}
