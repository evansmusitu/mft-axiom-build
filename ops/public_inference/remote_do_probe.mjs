/** No customer-facing endpoint. Cloudflare remote-dev ephemeral quota probe ONLY.
 * This is NOT the deployed AXIOM API and requires two distinct ephemeral keys.
 */
import { AxiomGlobalInferenceQuota, reserveQuotaDurable } from './durable_quota.mjs';
/** Probe-only DO subclass. No production routes and synthetic HMAC pre-verified. */
export class ProbeAxiomQuota extends AxiomGlobalInferenceQuota {
 async fetch(request){
   const clone=request.clone();
   const base=await super.fetch(request);
   if(base.status!==429)return base;
   // Never emit internal diagnostic codes to unauthorized requests.
   try{
     const raw=await clone.text();
     const signature=clone.headers.get('x-axiom-internal-signature');
     if(typeof this.env.AXIOM_DO_INTERNAL_QUOTA_KEY!=='string')return new Response(null,{status:537});
     const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(this.env.AXIOM_DO_INTERNAL_QUOTA_KEY),
        {name:'HMAC',hash:'SHA-256'},false,['verify']);
     const bytes=Uint8Array.from((signature||'').match(/../g)||[],v=>parseInt(v,16));
     if(bytes.length!==32||!await crypto.subtle.verify('HMAC',key,bytes,new TextEncoder().encode(raw)))
       return new Response(null,{status:538});
   }catch{return new Response(null,{status:539});}
   try{this.ctx.storage.sql.exec('SELECT COUNT(*) AS n FROM reservations').one();}
   catch{return new Response(null,{status:530});}
   try{this.ctx.storage.transactionSync(()=>this.ctx.storage.sql.exec('SELECT changes() AS n').one());}
   catch{return new Response(null,{status:531});}
   try{
     const count=this.ctx.storage.sql.exec('SELECT COUNT(*) AS n FROM reservations').one()?.n;
     if(typeof count!=='number')return new Response(null,{status:532});
     if(count>0)return new Response(null,{status:533});
   }catch{return new Response(null,{status:534});}
   return new Response(null,{status:535});
 }
}
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
      // Finite, authorized diagnostic: expose only the internal DO HTTP status
      // for synthetic sequence 5, never response bodies, error messages or data.
      if(action==='5'){
        const claims5={nonce:action.padStart(64,'0'),subject:'isolatedSyntheticTenant',
          project:'isolatedSyntheticWork',provider:'cloudflare',
          model:'@cf/zai-org/glm-4.7-flash',max_tokens:60};
        const fields=['nonce','subject','project','provider','model','max_tokens'];
        const data=JSON.stringify(Object.fromEntries(fields.map(f=>[f,claims5[f]])));
        const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.AXIOM_DO_INTERNAL_QUOTA_KEY),
          {name:'HMAC',hash:'SHA-256'},false,['sign']);
        const bytes=await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(data));
        const sig=[...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
        const stub=env.AXIOM_GLOBAL_QUOTA.get(env.AXIOM_GLOBAL_QUOTA.idFromName('axiom-public-inference-global-v1'));
        const r=await stub.fetch('https://quota.internal/reserve',{method:'POST',
          headers:{'content-type':'application/json','x-axiom-internal-signature':sig},body:data});
        return new Response(null,{status:r.status});
      }
      const claims={nonce:action.padStart(64,'0'),subject:'isolatedSyntheticTenant',
        project:'isolatedSyntheticWork',provider:'cloudflare',
        model:'@cf/zai-org/glm-4.7-flash',max_tokens:60};
      await reserveQuotaDurable(env.AXIOM_GLOBAL_QUOTA,env.AXIOM_DO_INTERNAL_QUOTA_KEY,claims);
      return new Response(null,{status:204});
    }catch{return new Response(null,{status:429});}
  }
};