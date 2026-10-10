/** Least-privilege SQL RPC for an independently deployed, authenticated
 * provider-feedback ingress Worker. Does not expose customer send/queue APIs,
 * allow edits to mail_messages, or grant the general SQL storage capability.
 */
import {createHash,timingSafeEqual} from 'node:crypto';
import {readBoundedWebhookBody} from '../webhooks/bounded-body.mjs';
const normalize=s=>String(s||'').trim().replace(/\s+/g,' ');
const statementTypes=new Map([
 ["SELECT recipient_hmac FROM mail_messages WHERE tenant_id=? AND provider_id=? AND state='ACCEPTED_BY_PROVIDER'",{count:2,mode:'read'}],
 ['SELECT * FROM mail_provider_events WHERE tenant_id=? AND svix_id=?',{count:2,mode:'read'}],
 ["SELECT message_id FROM mail_messages WHERE tenant_id=? AND provider_id=? AND state='ACCEPTED_BY_PROVIDER'",{count:2,mode:'read'}],
 ['INSERT OR IGNORE INTO mail_provider_events(tenant_id,svix_id,message_id,provider_id,kind,raw_sha256,created_ms) VALUES(?,?,?,?,?,?,?)',{count:7,mode:'event'}],
 ['INSERT OR IGNORE INTO mail_suppressions(tenant_id,recipient_hmac,created_ms) VALUES(?,?,?)',{count:3,mode:'suppress'}]
]);
const respond=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
function authorized(value,secret){
 if(typeof secret!=='string'||secret.length<32||typeof value!=='string')return false;
 const a=createHash('sha256').update(value).digest(),b=createHash('sha256').update(secret).digest();
 return timingSafeEqual(a,b);
}
export async function handleFeedbackRpc(request,sql,env){
 if(request.method!=='POST'||new URL(request.url).pathname!=='/feedback-rpc')return respond({error:'NOT_FOUND'},404);
 if(env?.MMF_FEEDBACK_RPC_ENABLED!=='true'||env?.MMF_FEEDBACK_RPC_SECRET===env?.MMF_STORAGE_RPC_SECRET||
    typeof env?.MMF_TENANT_ID!=='string'||!/^[-a-z0-9_]{3,64}$/.test(env.MMF_TENANT_ID))
    return respond({error:'FEEDBACK_BRIDGE_DISABLED'},503);
 if(!authorized(request.headers.get('x-mmf-feedback'),env.MMF_FEEDBACK_RPC_SECRET))
    return respond({error:'UNAUTHORIZED'},401);
 try{
  // Internal bearer authentication happens first. Stream at most 15 KiB
  // even when the caller lies about Content-Length or sends chunked input.
  const bounded=await readBoundedWebhookBody(request,{maxBytes:15000});
  if(bounded.error)return respond({error:bounded.error},bounded.status);
  const body=JSON.parse(bounded.raw),sqlText=body?.sql,params=body?.params;
  const normalized=normalize(sqlText),spec=statementTypes.get(normalized);
  if(!spec||!Array.isArray(params)||params.length!==spec.count||params[0]!==env.MMF_TENANT_ID||
     params.some(p=>p===undefined||p!==null&&!['string','number'].includes(typeof p)))
   return respond({error:'FORBIDDEN_FEEDBACK_SQL'},403);
  // Prevent the feedback key from fabricating a receipt for an unrelated
  // message/provider pair, even if that key is exposed.
  if(spec.mode==='event'){
   const [tenant,svixId,messageId,providerId,kind,rawSha256,createdMs]=params;
   if(typeof svixId!=='string'||!/^[A-Za-z0-9._:-]{4,200}$/.test(svixId)||
      !['email.delivered','email.bounced','email.complained','email.delivery_delayed'].includes(kind)||
      typeof rawSha256!=='string'||!/^[a-f0-9]{64}$/.test(rawSha256)||
      !Number.isSafeInteger(createdMs)||createdMs<=0)
     return respond({error:'INVALID_FEEDBACK_RECORD'},422);
   const found=sql.exec("SELECT message_id FROM mail_messages WHERE tenant_id=? AND message_id=? AND provider_id=? AND state='ACCEPTED_BY_PROVIDER'",
      tenant,messageId,providerId).toArray();
   if(found.length!==1)return respond({error:'UNATTRIBUTABLE_EVENT'},422);
  }
  if(spec.mode==='suppress'){
   const [tenant,recipientHmac,createdMs]=params;
   if(typeof recipientHmac!=='string'||!/^([a-f0-9]{64}|[A-Za-z0-9_-]{43})$/.test(recipientHmac)||
      !Number.isSafeInteger(createdMs)||createdMs<=0)
     return respond({error:'INVALID_SUPPRESSION_RECORD'},422);
   // Suppression may only follow a durable bounce/complaint for this exact
   // recipient and tenant; the token cannot suppress arbitrary addresses.
   const found=sql.exec(`SELECT 1 AS ok FROM mail_provider_events e
    JOIN mail_messages m ON e.message_id=m.message_id AND e.tenant_id=m.tenant_id
    WHERE e.tenant_id=? AND m.recipient_hmac=? AND e.kind IN ('email.bounced','email.complained') LIMIT 1`,
    tenant,recipientHmac).toArray();
   if(found.length===0)return respond({error:'SUPPRESSION_EVIDENCE_REQUIRED'},422);
  }
  const result=sql.exec(sqlText,...params);
  const rows=result.toArray();
  const count=sql.exec('SELECT changes() AS n').toArray();
  const changes=Number(count[0]?.n);
  if(!Number.isSafeInteger(changes)||changes<0)return respond({error:'STORAGE_UNAVAILABLE'},503);
  return respond({success:true,rows,changes});
 }catch{return respond({error:'STORAGE_UNAVAILABLE'},503);}
}
export function createFeedbackSqlAdapter(namespace,secret){
 if(!namespace?.idFromName||!namespace?.get||typeof secret!=='string'||secret.length<32)
  throw TypeError('SCOPED_FEEDBACK_BRIDGE_UNAVAILABLE');
 const object=namespace.get(namespace.idFromName('mmf-stage-tenant'));
 if(!object?.fetch)throw TypeError('SCOPED_FEEDBACK_BRIDGE_UNAVAILABLE');
 async function execute(sql,params){
  const response=await object.fetch(new Request('https://mmf-internal.invalid/feedback-rpc',{
   method:'POST',headers:{'content-type':'application/json','x-mmf-feedback':secret},
   body:JSON.stringify({sql,params})
  }));
  if(!response.ok)throw Error('SCOPED_FEEDBACK_BRIDGE_REJECTED');
  const result=await response.json();
  if(result.success!==true||!Array.isArray(result.rows)||!Number.isSafeInteger(result.changes))
   throw Error('SCOPED_FEEDBACK_BRIDGE_RESPONSE_INVALID');
  return result;
 }
 return Object.freeze({prepare(sql){
  if(!statementTypes.has(normalize(sql)))throw TypeError('FORBIDDEN_FEEDBACK_SQL');
  const bound=params=>Object.freeze({
   async run(){const r=await execute(sql,params);return{success:true,meta:{changes:r.changes}};},
   async first(){const r=await execute(sql,params);return r.rows[0]??null;},
   async all(){const r=await execute(sql,params);return{success:true,results:r.rows};}
  });
  return Object.freeze({...bound([]),bind(...params){return bound(params);}});
 }});
}
