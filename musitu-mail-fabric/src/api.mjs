import {createHash,timingSafeEqual} from 'node:crypto';
import {PolicyRejection} from './policy.mjs';
/** Embeddable Fetch API handler. Requires strong bearer token even in simulation. */
export function createHandler({fabric,apiToken,tenantId}){
  if(!fabric||typeof apiToken!=='string'||apiToken.length<32||typeof tenantId!=='string')throw new TypeError('Strong API token and tenant required');
  const expected=createHash('sha256').update(apiToken).digest();
  return async function handle(request){
    const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
    const json=(x,status=200)=>new Response(JSON.stringify(x),{status,headers});
    const token=request.headers.get('authorization')||'';
    if(!token.startsWith('Bearer ')||!timingSafeEqual(expected,createHash('sha256').update(token.slice(7)).digest()))return json({error:'UNAUTHORIZED'},401);
    let url;try{url=new URL(request.url);}catch{return json({error:'INVALID_URL'},400);}
    try{
      if(request.method==='POST'&&url.pathname==='/v1/messages'){
        const payload=await request.text();
        if(Buffer.byteLength(payload,'utf8')>30000)return json({error:'PAYLOAD_TOO_LARGE'},413);
        const obj=JSON.parse(payload),result=await fabric.submit({...obj,tenantId});
        return json(result,result.state==='ACCEPTED_BY_PROVIDER'?202:result.state==='OUTCOME_UNKNOWN'?503:422);
      }
      const match=url.pathname.match(/^\/v1\/messages\/([0-9a-f-]{36})$/);
      if(request.method==='GET'&&match){const result=fabric.get(match[1],tenantId);return result?json(result):json({error:'NOT_FOUND'},404);}
      return json({error:'NOT_FOUND'},404);
    }catch(error){
      if(error instanceof PolicyRejection)return json({error:error.code},422);
      if(error instanceof SyntaxError)return json({error:'INVALID_JSON'},400);
      return json({error:'SERVICE_UNAVAILABLE'},503);
    }
  };
}
