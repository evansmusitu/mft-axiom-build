import {createRemoteJWKSet,jwtVerify} from 'jose';

/**
 * Require a cryptographically verified Cloudflare Access app JWT for any
 * interactive Studio resource (including static HTML/CSS/JS).
 * Bypass is limited to explicit local development on loopback, never remote.
 * Modal callbacks are authenticated with a separate strong bearer secret.
 */
const jwksCache=new Map();
export function isExplicitLocalTest(request,env) {
  const url=new URL(request.url);
  return env.STUDIO_LOCAL_TEST_ONLY==='true' &&
    (url.hostname==='127.0.0.1'||url.hostname==='localhost') &&
    (url.protocol==='http:');
}
export function validatedAccessSettings(env){
  const domain=env.STUDIO_ACCESS_TEAM_DOMAIN;
  const audience=env.STUDIO_ACCESS_POLICY_AUD;
  if(typeof domain!=='string'||!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(domain))return null;
  if(typeof audience!=='string'||!(/^[0-9a-f]{64}$/i).test(audience))return null;
  return {domain,audience};
}
export async function validateAccess(request,env,options={}){
  if(isExplicitLocalTest(request,env))return true;
  const config=validatedAccessSettings(env);
  const token=request.headers.get('cf-access-jwt-assertion');
  if(!config||typeof token!=='string'||token.length>8192||token.length<100)return false;
  try{
    let keys=options.keySet;
    if(!keys){
      keys=jwksCache.get(config.domain);
      if(!keys){
        keys=createRemoteJWKSet(new URL(config.domain+'/cdn-cgi/access/certs'),{timeoutDuration:3000});
        jwksCache.set(config.domain,keys);
      }
    }
    const {payload}=await jwtVerify(token,keys,{
      issuer:config.domain,audience:config.audience,algorithms:['RS256'],clockTolerance:5
    });
    return payload.type==='app' && typeof payload.sub==='string' && payload.sub.length>0;
  }catch{return false;}
}
