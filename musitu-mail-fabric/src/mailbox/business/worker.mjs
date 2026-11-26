import PostalMime from 'postal-mime';
import {createRemoteJWKSet,jwtVerify} from 'jose';
import {configuration,authorizeClaims,validRecipient,validateDraft,canReceive,canMutate,canSend} from './core.mjs';
const json=(data,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
const deny=(s=403)=>json({error:s===401?'AUTH_REQUIRED':'NOT_AVAILABLE'},s);
const row=(db,sql,...args)=>db.prepare(sql).bind(...args);
const now=()=>new Date().toISOString();
const maxRaw=10*1024*1024;
async function readBounded(stream,max){if(!stream)throw Error('EMPTY_BODY');const reader=stream.getReader(),chunks=[];let n=0;try{for(;;){const {value,done}=await reader.read();if(done)break;n+=value.byteLength;if(n>max){await reader.cancel();throw Error('BODY_TOO_LARGE')}chunks.push(value)}}finally{reader.releaseLock()}const out=new Uint8Array(n);let offset=0;for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.byteLength}return out}
let jwksCache;
async function authenticated(req,c){
 const token=req.headers.get('cf-access-jwt-assertion');if(!token||token.length>12000)return false;
 try{if(!jwksCache||jwksCache.issuer!==c.issuer)jwksCache={issuer:c.issuer,keys:createRemoteJWKSet(new URL(c.issuer+'/cdn-cgi/access/certs'))};const {payload}=await jwtVerify(token,jwksCache.keys,{issuer:c.issuer,audience:c.aud,algorithms:['RS256']});return authorizeClaims(payload,c)}catch{return false}
}
async function inbound(message,env){
 const c=configuration(env);
 if(!canReceive(c,message.to)){message.setReject('Mailbox not available');return}
 // Existing addresses must first preserve forwarding; pilot-only storage cannot interrupt existing mail.
 if(c.address!=='mail-pilot@mftintelligence.com')await message.forward(c.forward);
 if(message.rawSize>maxRaw){if(c.address==='mail-pilot@mftintelligence.com')message.setReject('Message exceeds pilot size limit');return}
 const raw=await readBounded(message.raw,maxRaw);
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',raw));
 const id=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
 const parsed=await PostalMime.parse(raw);
 const sender=String(parsed.from?.address||message.from||'').slice(0,254);
 const subject=String(parsed.subject||'').slice(0,300);
 // Render only plain text; HTML and attachments remain in original MIME, not exposed by this pilot.
 const body=String(parsed.text||'[No plain-text body. Original MIME retained.]').slice(0,100000);
 const key=c.address+'/'+id+'.eml';
 await env.MMF_RAW.put(key,raw,{httpMetadata:{contentType:'message/rfc822'}});
 await row(env.MMF_DB,'INSERT OR IGNORE INTO mailbox_message(mailbox,id,folder,sender,recipient,subject,body,raw_key,received_at) VALUES(?,?,\'inbox\',?,?,?,?,?,?)',c.address,id,sender,c.address,subject,body,key,now()).run();
}
const fields='id,folder,sender AS "from",recipient AS "to",subject,received_at AS date,is_read AS read,starred,send_status';
async function api(req,env,c,u){
 const db=env.MMF_DB, m=c.address;
 if(req.method==='GET'&&u.pathname==='/api/mailbox')return json({address:m,sendEnabled:c.send});
 if(req.method==='GET'&&u.pathname==='/api/messages'){
  const folder=u.searchParams.get('folder')||'inbox',q=(u.searchParams.get('q')||'').slice(0,300);
  if(!['inbox','starred','archive','trash','drafts','sent','unknown','sending'].includes(folder))return json({error:'INVALID_FOLDER'},400);
  const condition=folder==='starred'?"starred=1 AND folder NOT IN ('trash','drafts','unknown','sending')":'folder=?';
  const a=folder==='starred'?[m]:[m,folder];
  const like='%'+q.replace(/[\\%_]/g,x=>'\\'+x)+'%';
  const result=await row(db,'SELECT '+fields+' FROM mailbox_message WHERE mailbox=? AND '+condition+" AND (subject LIKE ? ESCAPE '\\' OR sender LIKE ? ESCAPE '\\' OR recipient LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\') ORDER BY received_at DESC,id LIMIT 50",...a,like,like,like,like).all();
  return json({messages:result.results});
 }
 const id=u.pathname.match(/^\/api\/messages\/([a-f0-9-]{36,64})$/)?.[1];
 if(req.method==='GET'&&id){const result=await row(db,'SELECT '+fields+',body FROM mailbox_message WHERE mailbox=? AND id=?',m,id).first();return result?json(result):deny(404)}
 if(req.method!=='POST'||!canMutate(req,c))return deny();
 let data;try{data=JSON.parse(new TextDecoder().decode(await readBounded(req.body,450000)))}catch{return json({error:'INVALID_BODY'},400)}
 if(u.pathname==='/api/drafts'){
  let d;try{d=validateDraft(data)}catch{return json({error:'INVALID_DRAFT'},400)}
  if(data.id!==undefined){if(typeof data.id!=='string'||!(/^[a-f0-9-]{36,64}$/).test(data.id))return deny(404);const r=await row(db,"UPDATE mailbox_message SET recipient=?,subject=?,body=?,received_at=? WHERE mailbox=? AND id=? AND folder='drafts'",d.to,d.subject,d.body,now(),m,data.id).run();return r.meta.changes===1?json({id:data.id}):deny(404)}
  const newId=crypto.randomUUID();await row(db,"INSERT INTO mailbox_message(mailbox,id,folder,sender,recipient,subject,body,received_at,is_read) VALUES(?,?,'drafts',?,?,?,?,?,1)",m,newId,m,d.to,d.subject,d.body,now()).run();return json({id:newId},201)
 }
 if(!id)return deny(404);
 if(data.action==='send'){
  const d=await row(db,"SELECT recipient AS \"to\",subject,body FROM mailbox_message WHERE mailbox=? AND id=? AND folder='drafts'",m,id).first();
  if(!d||!canSend(c,d)||!env.RESEND_API_KEY)return json({error:'SEND_UNAVAILABLE'},409);
  // One atomic claim. Never automatically retry an uncertain provider outcome.
  const claim=await row(db,"UPDATE mailbox_message SET folder='sending',send_status='PENDING' WHERE mailbox=? AND id=? AND folder='drafts' AND recipient=? AND subject=? AND body=?",m,id,d.to,d.subject,d.body).run();
  if(claim.meta.changes!==1)return json({error:'ALREADY_CLAIMED'},409);
  let providerId=null;
  try{const res=await fetch('https://api.resend.com/emails',{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'mft-mailbox/'+id},body:JSON.stringify({from:m,to:[d.to],subject:d.subject,text:d.body}),signal:AbortSignal.timeout(12000)});if(res.ok){const v=await res.json();if(typeof v.id==='string'&&v.id.length<=128)providerId=v.id}}catch{}
  if(providerId){await row(db,"UPDATE mailbox_message SET folder='sent',provider_id=?,send_status='ACCEPTED_BY_PROVIDER',received_at=? WHERE mailbox=? AND id=? AND folder='sending'",providerId,now(),m,id).run();return json({status:'ACCEPTED_BY_PROVIDER'})}
  await row(db,"UPDATE mailbox_message SET folder='unknown',send_status='OUTCOME_UNKNOWN' WHERE mailbox=? AND id=? AND folder='sending'",m,id).run();return json({error:'OUTCOME_UNKNOWN_DO_NOT_RETRY'},502)
 }
 let sql,params=[];
 switch(data.action){
 case 'star':sql="UPDATE mailbox_message SET starred=1-starred WHERE mailbox=? AND id=? AND folder NOT IN ('sending','unknown')";break;
 case 'read':if(typeof data.value!=='boolean')return json({error:'INVALID_READ'},400);sql="UPDATE mailbox_message SET is_read=? WHERE mailbox=? AND id=? AND folder NOT IN ('sending','unknown')";params=[Number(data.value)];break;
 case 'archive':sql="UPDATE mailbox_message SET folder='archive' WHERE mailbox=? AND id=? AND folder='inbox'";break;
 case 'inbox':sql="UPDATE mailbox_message SET folder='inbox' WHERE mailbox=? AND id=? AND folder='archive'";break;
 case 'trash':sql="UPDATE mailbox_message SET previous_folder=folder,folder='trash' WHERE mailbox=? AND id=? AND folder IN ('inbox','archive','sent','drafts')";break;
 case 'restore':sql="UPDATE mailbox_message SET folder=previous_folder,previous_folder=NULL WHERE mailbox=? AND id=? AND folder='trash' AND previous_folder IN ('inbox','archive','sent','drafts')";break;
 default:return json({error:'INVALID_ACTION'},400)}
 const r=await row(db,sql,...params,m,id).run();return r.meta.changes===1?json({ok:true}):deny(404)
}
export default {
 async email(message,env){await inbound(message,env)},
 async fetch(req,env){try{const c=configuration(env),u=new URL(req.url);if(u.origin!==c.origin)return deny();if(!(await authenticated(req,c)))return deny(401);
 if(u.pathname.startsWith('/api/'))return await api(req,env,c,u);
 if(req.method!=='GET'||!['/','/index.html','/mail.css','/app.mjs'].includes(u.pathname))return deny(404);
 const res=await env.ASSETS.fetch(req);const h=new Headers(res.headers);h.set('cache-control','no-store');h.set('content-security-policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");h.set('x-content-type-options','nosniff');h.set('referrer-policy','no-referrer');return new Response(res.body,{status:res.status,headers:h});
 }catch{return json({error:'MAILBOX_UNAVAILABLE'},503)}}
};
