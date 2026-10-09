/** No customer-facing endpoint. Cloudflare remote-dev ephemeral quota probe ONLY.
 * This is NOT the deployed AXIOM API and requires two distinct ephemeral keys.
 */
import { AxiomGlobalInferenceQuota, reserveQuotaDurable } from './durable_quota.mjs';
export { AxiomGlobalInferenceQuota };
function hexToBytes(s) {
  if(typeof s!=='string'||!/^[a-f0-9]{64}$/.test(s))throw Error('INVALID_SIGNATURE');
  return Uint8Array.from(s.match(/../g),v=>parseInt(v,16));
}
async function authorized(action,signature,secret){
  try {
    if(typeof secret!=='string'||secret.length<48||secret.length>256) return false;
    const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),
      {name:'HMAC',hash:'SHA-256'},false,['verify']);
    return await crypto.subtle.verify('HMAC',key,hexToBytes(signature),new TextEncoder().encode(action));
  }catch{return false;}
}
export default {
  async fetch(request,env){
    if(request.method!=='POST'||new URL(request.url).pathname!=='/__isolated_quota_probe')
      return new Response(null,{status:404});
    let action;
    try{
      const raw=await request.text();
      if(raw.length>64)throw Error('BOUNDED_INPUT');
      const body=JSON.parse(raw);
      if(Object.keys(body).length!==1||!Number.isInteger(body.sequence)||
         body.sequence<1||body.sequence>5)throw Error('BAD_ACTION');
      action=String(body.sequence);
    }catch{return new Response(null,{status:403});}
    if(!await authorized(action,request.headers.get('x-axiom-probe-signature'),
        env.AXIOM_EPHEMERAL_PROBE_KEY))
      return new Response(null,{status:403});
    try{
      const claims={nonce:action.padStart(64,'0'),subject:'isolatedSyntheticTenant',
        project:'isolatedSyntheticWork',provider:'cloudflare',
        model:'@cf/zai-org/glm-4.7-flash',max_tokens:60};
      await reserveQuotaDurable(env.AXIOM_GLOBAL_QUOTA,env.AXIOM_DO_INTERNAL_QUOTA_KEY,claims);
      return new Response(null,{status:204});
    }catch{return new Response(null,{status:429});}
  }
};