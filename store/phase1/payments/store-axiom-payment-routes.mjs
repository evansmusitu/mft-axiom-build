/**
 * MUSITU Store V2: isolated, review-only Paynow callback + customer status.
 * Mirrors Axiom verified callback/independent poll topology WITHOUT ever
 * writing Axiom DB, granting Store entitlements, or sending publisher payouts.
 * This module is not deployed or authorized for real-money operation.
 */
const ROOT='https://payments.mftintelligence.com';
const JSON_HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
const DENIED={entitlement_granted:false,publisher_payout_authorized:false,refund_finalized:false,live_money_certified:false};
const reply=(status,body)=>new Response(JSON.stringify({...body,...DENIED}),{status,headers:JSON_HEADERS});
const fields=new Set(['reference','amount','pollurl','paynowreference','status','hash']);
const statuses=new Set(['Paid','Refunded','Disputed','Cancelled','Created','Sent','Delivered','Awaiting Delivery']);
const encoder=new TextEncoder();
async function sha(value,algo='SHA-512'){
 const result=new Uint8Array(await crypto.subtle.digest(algo,encoder.encode(value)));
 return Array.from(result,x=>x.toString(16).padStart(2,'0')).join('').toUpperCase();
}
function fail(){throw Error('signed_provider_status_rejected');}
function form(bytes){
 if(bytes.byteLength>12288||bytes.byteLength<32)fail();
 let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{fail();}
 if(text.includes('\0')||/%(?![0-9A-Fa-f]{2})/.test(text))fail();
 const parts=[],seen=new Set();
 for(const token of text.split('&')){
  const eq=token.indexOf('=');
  if(eq<1||token.indexOf('=',eq+1)!==-1)fail();
  let key,value;
  try{key=decodeURIComponent(token.slice(0,eq).replaceAll('+',' ')).toLowerCase();
      value=decodeURIComponent(token.slice(eq+1).replaceAll('+',' '));}
  catch{fail();}
  if(!fields.has(key)||seen.has(key)||value.length<1||value.length>2048)fail();
  seen.add(key);parts.push([key,value]);
 }
 if(seen.size!==fields.size)fail();
 return {parts,map:Object.fromEntries(parts)};
}
function safePoll(s){
 try{
  if(typeof s!=='string'||s.length>300)return false;
  const u=new URL(s);
  return u.href===s&&u.protocol==='https:'&&u.hostname==='www.paynow.co.zw'&&
   !u.port&&!u.username&&!u.password&&!u.hash&&u.pathname==='/Interface/CheckPayment/'&&
   u.searchParams.size===1&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(u.searchParams.get('guid')||'');
 }catch{return false;}
}
async function signedStatus(bytes,key){
 if(typeof key!=='string'||key.length<16||key.length>512)fail();
 const {parts,map}=form(bytes);
 if(!/^[0-9A-Fa-f]{128}$/.test(map.hash))fail();
 const expected=await sha(parts.filter(([k])=>k!=='hash').map(([,v])=>v).join('')+key);
 let diff=0;for(let i=0;i<128;i++)diff|=expected.charCodeAt(i)^map.hash.toUpperCase().charCodeAt(i);
 if(diff||!/^STORE-[A-Z0-9]{16,48}$/.test(map.reference)||
    !/^(?:[1-9][0-9]{0,8}|0)\.[0-9]{2}$/.test(map.amount)||
    !/^[A-Za-z0-9_-]{3,80}$/.test(map.paynowreference)||
    !statuses.has(map.status)||!safePoll(map.pollurl))fail();
 return {map,digest:(await sha(new TextDecoder().decode(bytes),'SHA-256')).toLowerCase()};
}
async function boundedBytes(input,max=12288){
 const stream=input.body;
 if(!stream||typeof stream.getReader!=='function')throw Error('body_stream_unavailable');
 const reader=stream.getReader(),chunks=[];let count=0;
 try{
  for(;;){
   const {done,value}=await reader.read();
   if(done)break;
   const b=value instanceof Uint8Array?value:new Uint8Array(value);
   count+=b.length;if(count>max)throw Error('provider_body_too_large');
   chunks.push(b);
  }
  const all=new Uint8Array(count);let position=0;
  for(const b of chunks){all.set(b,position);position+=b.length;}
  return all;
 }catch(error){try{await reader.cancel();}catch{}throw error;}
 finally{try{reader.releaseLock();}catch{}}
}
async function verifyCustomer(req,db){
 const auth=req.headers.get('authorization')||'';
 if(!auth.startsWith('Bearer ')||auth.length<32||auth.length>600)return null;
 const tokenHash=(await sha(auth.slice(7),'SHA-256')).toLowerCase();
 const row=await db.prepare('SELECT customer_id,status FROM store_customer_tokens WHERE token_hash=?1 LIMIT 1').bind(tokenHash).first();
 return row?.status==='active'&&row.customer_id?row.customer_id:null;
}
export function createStorePaymentRoutes({providerFetch=globalThis.fetch}={}){
 return {async handle(request,env){
  const u=new URL(request.url),path=u.pathname;
  if(path==='/store/billing/return'&&request.method==='GET')
   return reply(200,{ok:true,payment_status:'unverified',message:'Return does not prove payment. Check authenticated order status.'});
  const webhook=path==='/store/billing/webhooks/paynow'&&request.method==='POST';
  const match=/^\/store\/billing\/checkout\/(STORE-[A-Z0-9]{16,48})$/.exec(path);
  const status=Boolean(match)&&request.method==='GET';
  if(!webhook&&!status)return null;
  if(u.origin!==ROOT)return reply(404,{ok:false,error:'route_origin_rejected'});
  if(env?.STORE_CALLBACKS_CERTIFIED!=='true'||!env.STORE_DB||
     typeof env.STORE_PAYNOW_INTEGRATION_KEY!=='string'||env.STORE_PAYNOW_INTEGRATION_KEY.length<16)
   return reply(503,{ok:false,error:'store_callbacks_not_configured'});
  const db=env.STORE_DB;
  if(status){
   let customer;try{customer=await verifyCustomer(request,db);}catch{return reply(503,{ok:false,error:'store_db_unavailable'});}
   if(!customer)return reply(401,{ok:false,error:'not_authorized'});
   let intent;
   try{intent=await db.prepare('SELECT reference,sku,status,amount_cents,currency FROM store_checkout_intents WHERE reference=?1 AND customer_id=?2 LIMIT 1').bind(match[1],customer).first();}
   catch{return reply(503,{ok:false,error:'store_db_unavailable'});}
   if(!intent)return reply(404,{ok:false,error:'checkout_not_found'});
   return reply(200,{ok:true,reference:intent.reference,sku:intent.sku,payment_status:intent.status});
  }
  if(!(request.headers.get('content-type')||'').toLowerCase().startsWith('application/x-www-form-urlencoded'))
   return reply(415,{ok:false,error:'unsupported_media_type'});
  const declared=Number(request.headers.get('content-length')||0);
  if(declared>12288)return reply(413,{ok:false,error:'callback_too_large'});
  let callback;
  try{callback=await signedStatus(await boundedBytes(request),env.STORE_PAYNOW_INTEGRATION_KEY);}
  catch{return reply(400,{ok:false,error:'invalid_provider_callback'});}
  const p=callback.map;
  let intent;
  try{intent=await db.prepare('SELECT reference,customer_id,sku,amount_cents,currency,status,poll_url,expires_at FROM store_checkout_intents WHERE reference=?1 LIMIT 1').bind(p.reference).first();}
  catch{return reply(503,{ok:false,error:'store_db_unavailable'});}
  if(!intent)return reply(202,{ok:true,processed:false,reason:'unmatched_store_order'});
  if(intent.reference!==p.reference||intent.currency!=='USD'||!Number.isSafeInteger(intent.amount_cents)||
     (intent.amount_cents/100).toFixed(2)!==p.amount||intent.poll_url!==p.pollurl||
     !safePoll(intent.poll_url))
   return reply(409,{ok:false,error:'order_provider_mismatch'});
  let old;
  try{old=await db.prepare('SELECT reference,paynow_reference,callback_digest,review_status FROM store_checkout_reviews WHERE reference=?1 LIMIT 1').bind(p.reference).first();}
  catch{return reply(503,{ok:false,error:'store_db_unavailable'});}
  if(old){
   if(old.paynow_reference===p.paynowreference&&old.callback_digest===callback.digest)
    return reply(202,{ok:true,processed:true,idempotent:true,payment_status:old.review_status});
   return reply(409,{ok:false,error:'payment_review_requires_manual_resolution'});
  }
  if(intent.status!=='pending')return reply(409,{ok:false,error:'order_not_pending'});
  let polled;
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),8000);
  try{
   const res=await providerFetch(intent.poll_url,{
     method:'POST',body:'',headers:{'content-type':'application/x-www-form-urlencoded','content-length':'0'},
     redirect:'error',signal:controller.signal
   });
   if(res.status!==200||!res.ok)throw Error('provider_not_ok');
   if(Number(res.headers.get('content-length')||0)>12288)throw Error('provider_too_large');
   polled=await signedStatus(await boundedBytes(res),env.STORE_PAYNOW_INTEGRATION_KEY);
  }catch{return reply(502,{ok:false,error:'independent_provider_poll_unverified'});}
  finally{clearTimeout(timeout);}
  const v=polled.map;
  if(v.reference!==p.reference||v.amount!==p.amount||v.pollurl!==p.pollurl||
     v.paynowreference!==p.paynowreference)
   return reply(409,{ok:false,error:'provider_transaction_conflict'});
  const review=(p.status==='Paid'&&v.status==='Paid')?'review_required':'refund_review_required';
  try{
   const at=new Date().toISOString();
   const committed=await db.batch([
     // Compare-and-set in the database: a concurrent cancellation cannot
     // acquire a new paid review, even with valid Paynow signatures.
     db.prepare("INSERT INTO store_checkout_reviews(reference,paynow_reference,review_status,callback_digest,poll_digest,reviewed_at) SELECT ?1,?2,?3,?4,?5,?6 WHERE EXISTS (SELECT 1 FROM store_checkout_intents WHERE reference=?1 AND status='pending' AND poll_url=?7 AND amount_cents=?8 AND currency='USD')").bind(p.reference,p.paynowreference,review,callback.digest,polled.digest,at,p.pollurl,intent.amount_cents),
     db.prepare("UPDATE store_checkout_intents SET status=?2 WHERE reference=?1 AND status='pending'").bind(p.reference,review)
   ]);
   if(!Array.isArray(committed)||committed.length!==2||
      committed.some(item=>item?.success!==true||item?.meta?.changes!==1))
     return reply(409,{ok:false,error:'store_review_not_atomically_committed'});
  }catch{return reply(503,{ok:false,error:'store_review_persistence_failed'});}
  return reply(202,{ok:true,processed:true,payment_status:review});
 }};
}
