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
export async function boundedBytes(input,max=12288,deadlineMs=8000){
 const stream=input.body;
 if(!stream||typeof stream.getReader!=='function')throw Error('body_stream_unavailable');
 const reader=stream.getReader(),chunks=[];let count=0;
 let timer;
 const collect=(async()=>{
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
 })();
 const deadline=new Promise((_,reject)=>{
  timer=setTimeout(()=>{
   reject(Error('provider_body_timeout'));
   // Never wait indefinitely for a hostile upload stream to cancel.
   try{void reader.cancel().catch(()=>{});}catch{}
  },deadlineMs);
 });
 try{return await Promise.race([collect,deadline]);}
 catch(error){try{void reader.cancel().catch(()=>{});}catch{}throw error;}
 finally{clearTimeout(timer);try{reader.releaseLock();}catch{}}
}
async function verifyCustomer(req,db){
 const auth=req.headers.get('authorization')||'';
 if(!auth.startsWith('Bearer ')||auth.length<32||auth.length>600)return null;
 const tokenHash=(await sha(auth.slice(7),'SHA-256')).toLowerCase();
 const row=await db.prepare('SELECT customer_id,status,expires_at FROM store_customer_tokens WHERE token_hash=?1 LIMIT 1').bind(tokenHash).first();
 const expiry=row?.expires_at;
 if(row?.status!=='active'||!row.customer_id||typeof expiry!=='string'||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(expiry))return null;
 const until=Date.parse(expiry);
 return Number.isFinite(until)&&until>Date.now()?row.customer_id:null;
}
export function createStorePaymentRoutes({providerFetch=globalThis.fetch,callbackReadTimeoutMs=8000}={}){
 if(!Number.isSafeInteger(callbackReadTimeoutMs)||callbackReadTimeoutMs<1||callbackReadTimeoutMs>8000)
  throw Error('invalid_store_callback_deadline');
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
     env.STORE_PAYNOW_ID!=='27721'||env.STORE_PAYNOW_MODE!=='testing'||
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
  try{callback=await signedStatus(await boundedBytes(request,12288,callbackReadTimeoutMs),env.STORE_PAYNOW_INTEGRATION_KEY);}
  catch(error){
   if(error?.message==='provider_body_timeout')return reply(408,{ok:false,error:'provider_callback_body_timeout'});
   return reply(400,{ok:false,error:'invalid_provider_callback'});
  }
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
   if(old.paynow_reference===p.paynowreference&&old.callback_digest===callback.digest){
    // A prior immutable review row alone is not evidence that the associated
    // checkout transition committed. Replays must not endorse a torn batch.
    const expected=p.status==='Paid'?'review_required':
      p.status==='Refunded'?'refund_review_required':null;
    if(!expected||old.reference!==p.reference||old.review_status!==expected||intent.status!==expected)
     return reply(409,{ok:false,error:'store_review_replay_state_conflict'});
    return reply(202,{ok:true,processed:true,idempotent:true,payment_status:expected});
   }
   return reply(409,{ok:false,error:'payment_review_requires_manual_resolution'});
  }
  if(intent.status!=='pending')return reply(409,{ok:false,error:'order_not_pending'});
  const deadline=Date.parse(intent.expires_at||'');
  if(!Number.isFinite(deadline)||deadline<=Date.now())
    return reply(409,{ok:false,error:'expired_order_requires_manual_resolution'});
  let polled;
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),8000);
  try{
   const res=await providerFetch(intent.poll_url,{
     method:'POST',body:'',headers:{'content-type':'application/x-www-form-urlencoded','content-length':'0'},
     redirect:'error',signal:controller.signal
   });
   if(res.status!==200||!res.ok)throw Error('provider_not_ok');
   const media=(res.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
   if(media!=='application/x-www-form-urlencoded'&&media!=='text/plain')
     throw Error('provider_content_type_rejected');
   if(Number(res.headers.get('content-length')||0)>12288)throw Error('provider_too_large');
   polled=await signedStatus(await boundedBytes(res),env.STORE_PAYNOW_INTEGRATION_KEY);
  }catch{return reply(502,{ok:false,error:'independent_provider_poll_unverified'});}
  finally{clearTimeout(timeout);}
  const v=polled.map;
  if(v.reference!==p.reference||v.amount!==p.amount||v.pollurl!==p.pollurl||
     v.paynowreference!==p.paynowreference)
   return reply(409,{ok:false,error:'provider_transaction_conflict'});
  // Non-final statuses and disagreements are not refund evidence. Never
  // advance the immutable Store intent until both verified sources agree
  // on the same explicit final paid/refunded state.
  if(p.status!==v.status)
   return reply(409,{ok:false,error:'provider_payment_state_conflict'});
  if(p.status!=='Paid'&&p.status!=='Refunded'){
   // An opt-in private candidate ledger may preserve matching signed callback
   // and independent provider-poll observations. It never changes order status.
   // Until its migration/adapter have been independently admitted, default is
   // disabled and the current pending semantics remain unchanged.
   if(env.STORE_PAYNOW_OBSERVATIONS_ENABLED!=='true')
    return reply(202,{ok:true,processed:false,payment_status:'pending',reason:'provider_status_not_final'});
   const eventId='evt-'+(await sha([
    p.reference,p.paynowreference,callback.digest,polled.digest
   ].join('\n'),'SHA-256')).toLowerCase();
   const existingObservation=()=>db.prepare('SELECT event_id,reference,paynow_reference,provider_status,callback_digest,poll_digest FROM store_paynow_status_observations WHERE event_id=?1 LIMIT 1').bind(eventId).first();
   const observationMatches=prior=>prior?.event_id===eventId&&
    prior.reference===p.reference&&prior.paynow_reference===p.paynowreference&&
    prior.provider_status===p.status&&prior.callback_digest===callback.digest&&
    prior.poll_digest===polled.digest;
   const alreadyRecorded=()=>reply(202,{ok:true,processed:false,idempotent:true,
    observation_recorded:true,payment_status:'pending'});
   let prior;
   try{prior=await existingObservation();}
   catch{return reply(503,{ok:false,error:'store_observation_ledger_unavailable'});}
   if(prior){
    if(!observationMatches(prior))
     return reply(409,{ok:false,error:'store_observation_identity_conflict'});
    return alreadyRecorded();
   }
   try{
    // Single SQLite/D1 statement is atomic; pending-order compare-and-set and
    // immutable provider reference triggers protect against concurrent changes.
    const insert=await db.prepare(
     "INSERT INTO store_paynow_status_observations(event_id,reference,paynow_reference,provider_status,amount_cents,currency,poll_url,callback_digest,poll_digest,observed_at) SELECT ?1,?2,?3,?4,?5,'USD',?6,?7,?8,?9 WHERE EXISTS (SELECT 1 FROM store_checkout_intents WHERE reference=?2 AND status='pending' AND poll_url=?6 AND amount_cents=?5 AND currency='USD')"
    ).bind(eventId,p.reference,p.paynowreference,p.status,intent.amount_cents,
     p.pollurl,callback.digest,polled.digest,new Date().toISOString()).run();
    if(insert?.success!==true||insert?.meta?.changes!==1)
     return reply(409,{ok:false,error:'store_observation_not_atomically_committed'});
   }catch{
    // Two verified callbacks can pass the pre-insert SELECT concurrently.
    // If another worker committed the *same* immutable event, recover only
    // after read-back of every identity and evidence field. Never treat a
    // conflicting row or an unavailable ledger as a successful observation.
    let raced;
    try{raced=await existingObservation();}
    catch{return reply(503,{ok:false,error:'store_observation_persistence_failed'});}
    if(raced&&!observationMatches(raced))
     return reply(409,{ok:false,error:'store_observation_identity_conflict'});
    if(observationMatches(raced))return alreadyRecorded();
    return reply(503,{ok:false,error:'store_observation_persistence_failed'});
   }
   // A successful changes count is only an acknowledgement. Verify that the
   // immutable evidence is actually readable before reporting it as recorded.
   let stored;
   try{stored=await existingObservation();}
   catch{return reply(503,{ok:false,error:'store_observation_readback_unavailable'});}
   if(!stored)return reply(503,{ok:false,error:'store_observation_readback_missing'});
   if(!observationMatches(stored))
    return reply(409,{ok:false,error:'store_observation_identity_conflict'});
   return reply(202,{ok:true,processed:false,observation_recorded:true,
    payment_status:'pending',reason:'provider_status_requires_manual_resolution'});
  }
  const review=p.status==='Paid'?'review_required':'refund_review_required';
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
  // Batch change-count acknowledgements are not authoritative evidence.
  // Independently verify both persisted Store rows before reporting review.
  let savedReview,savedIntent;
  try{
   savedReview=await db.prepare('SELECT reference,paynow_reference,review_status,callback_digest,poll_digest FROM store_checkout_reviews WHERE reference=?1 LIMIT 1').bind(p.reference).first();
   savedIntent=await db.prepare('SELECT reference,status,amount_cents,currency,poll_url FROM store_checkout_intents WHERE reference=?1 LIMIT 1').bind(p.reference).first();
  }catch{return reply(503,{ok:false,error:'store_review_readback_unavailable'});}
  if(!savedReview||!savedIntent)
   return reply(503,{ok:false,error:'store_review_readback_missing'});
  if(savedReview.reference!==p.reference||savedReview.paynow_reference!==p.paynowreference||
     savedReview.review_status!==review||savedReview.callback_digest!==callback.digest||
     savedReview.poll_digest!==polled.digest||savedIntent.reference!==p.reference||
     savedIntent.status!==review||savedIntent.amount_cents!==intent.amount_cents||
     savedIntent.currency!=='USD'||savedIntent.poll_url!==p.pollurl)
   return reply(409,{ok:false,error:'store_review_readback_conflict'});
  return reply(202,{ok:true,processed:true,payment_status:review});
 }};
}
