import {createStorePaymentRoutes,boundedBytes} from './store-axiom-payment-routes.mjs';

/**
 * MUSITU Store — isolated Axiom-inspired Paynow checkout initiation.
 * Architecture copied from existing Axiom design: authenticated customer,
 * server-owned catalog/amount, durable pre-initiation intent, Paynow signed
 * initiate, independently hash-verified Paynow redirect, pending status.
 *
 * The existing Axiom authority MUST NOT be called unmodified: it signs
 * AXIOM-specific return/result routes and its D1 subscription entitlements.
 * Store credentials and Store D1 bindings are separate. No deployment,
 * Store payments, download entitlements, publisher payouts or refunds here.
 */
const BASE='https://payments.mftintelligence.com/store/billing';
const PAYNOW='https://www.paynow.co.zw/interface/initiatetransaction';
const FIELDS=['id','reference','amount','additionalinfo','returnurl','resulturl','status'];
const HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
const noPower={entitlement_granted:false,publisher_payout_authorized:false,live_money_certified:false};
// A bearer remaining marked active is not evidence of an unexpired session.
// Fail closed for old or incomplete token rows until Store-only credentials
// are rotated with a verified UTC expiration.
function activeCustomer(row){
  const expiry=row?.expires_at;
  if(row?.status!=='active'||!row.customer_id||typeof expiry!=='string'||
     !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(expiry))
    return false;
  const until=Date.parse(expiry);
  return Number.isFinite(until)&&until>Date.now();
}

const reply=(status,body)=>new Response(JSON.stringify({...body,...noPower}),{status,headers:HEADERS});
const enc=new TextEncoder();
async function hexSha(input,algorithm='SHA-512'){
  const bytes=new Uint8Array(await globalThis.crypto.subtle.digest(algorithm,enc.encode(input)));
  return Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('').toUpperCase();
}
function safePaynowUrl(value,type){
  try{
    const url=new URL(value);
    if(url.protocol!=='https:'||!['www.paynow.co.zw','paynow.co.zw'].includes(url.hostname)||
      url.username||url.password||url.port||url.hash||url.href!==value)return false;
    if(type==='browser')return url.pathname.startsWith('/Payment/')&&url.search==='';
    return url.hostname==='www.paynow.co.zw'&&url.pathname==='/Interface/CheckPayment/'&&
      url.searchParams.size===1&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(url.searchParams.get('guid')||'');
  }catch{return false;}
}
async function readBounded(response,limit=8192){
  if(!response.body||typeof response.body.getReader!=='function')
    throw Error('provider_response_unstreamable');
  const reader=response.body.getReader();const chunks=[];let size=0;
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      const bytes=value instanceof Uint8Array?value:new Uint8Array(value);
      size+=bytes.byteLength;
      if(size>limit)throw Error('provider_response_too_large');
      chunks.push(bytes);
    }
    const out=new Uint8Array(size);let offset=0;
    for(const bytes of chunks){out.set(bytes,offset);offset+=bytes.byteLength;}
    return out;
  }catch(error){try{await reader.cancel();}catch{}throw error;}
  finally{try{reader.releaseLock();}catch{}}
}
function formOf(bytes){
  if(bytes.length>8192)throw Error('provider_response_too_large');
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  const fields=[];const seen=new Set();
  for(const [key,val] of new URLSearchParams(text)){
    const lower=key.toLowerCase();
    if(seen.has(lower)||!['status','browserurl','pollurl','paynowreference','hash'].includes(lower))
      throw Error('provider_fields_invalid');
    seen.add(lower);fields.push([lower,val]);
  }
  if(!seen.has('hash'))throw Error('provider_hash_absent');
  return fields;
}
async function signedReply(providerText,key){
  const fields=formOf(enc.encode(providerText));
  const map=Object.fromEntries(fields);
  if(!/^[a-fA-F0-9]{128}$/.test(map.hash))throw Error('provider_hash_malformed');
  const expected=await hexSha(fields.filter(([k])=>k!=='hash').map(([,v])=>v).join('')+key);
  // Compare fixed-length hex without exiting early on different bytes.
  let mismatch=0;for(let i=0;i<128;i++)mismatch|=expected.charCodeAt(i)^map.hash.toUpperCase().charCodeAt(i);
  if(mismatch)throw Error('provider_hash_invalid');
  if(map.status!=='Ok'||!safePaynowUrl(map.browserurl,'browser')||!safePaynowUrl(map.pollurl,'poll'))
    throw Error('provider_checkout_invalid');
  return map;
}
function onlyAllowedBody(value){
  return value&&typeof value==='object'&&!Array.isArray(value)&&
   Object.keys(value).length===1&&typeof value.sku==='string'&&
   /^[A-Z][A-Z0-9_]{3,79}$/.test(value.sku);
}
export function createStoreBillingWorker({paynowFetch=globalThis.fetch,newReference=()=>`STORE-${globalThis.crypto.randomUUID().replaceAll('-','').slice(0,20).toUpperCase()}`}={}){
  const paymentRoutes=createStorePaymentRoutes({providerFetch:paynowFetch});
  return {async fetch(request,env){
    const url=new URL(request.url);
    // Even a correctly signed merchant response must not let a workers.dev
    // or unrelated vanity host impersonate this Store billing authority.
    if(url.origin!==new URL(BASE).origin)
      return reply(404,{ok:false,error:'store_billing_origin_rejected'});
    const routed=await paymentRoutes.handle(request,env);
    if(routed!==null)return routed;
    if(url.pathname!=='/store/billing/checkout'||request.method!=='POST')
      return reply(404,{ok:false,error:'not_found'});
    // Refuse all new Store charges until isolated app, route, keys, D1 and
    // product catalog have been separately approved and configured.
    if(env?.STORE_CHECKOUT_ENABLED!=='true'||env?.STORE_FIRST_PARTY_ONLY!=='true'||
       env?.STORE_CALLBACKS_CERTIFIED!=='true'||
       !env.STORE_DB||env.STORE_PAYNOW_ID!=='27721'||env.STORE_PAYNOW_MODE!=='testing'||
       typeof env.STORE_PAYNOW_INTEGRATION_KEY!=='string'||env.STORE_PAYNOW_INTEGRATION_KEY.length<16)
      return reply(503,{ok:false,error:'store_checkout_not_configured'});
    const header=request.headers.get('authorization')||'';
    if(!header.startsWith('Bearer ')||header.length<32||header.length>600)
      return reply(401,{ok:false,error:'not_authorized'});
    let customer;
    try{
      const tokenHash=(await hexSha(header.slice(7),'SHA-256')).toLowerCase();
      customer=await env.STORE_DB.prepare('SELECT customer_id,status,expires_at FROM store_customer_tokens WHERE token_hash=?1 LIMIT 1').bind(tokenHash).first();
    }catch{return reply(503,{ok:false,error:'store_db_unavailable'});}
    if(!activeCustomer(customer))
      return reply(401,{ok:false,error:'not_authorized'});
    if(!(request.headers.get('content-type')||'').startsWith('application/json'))
      return reply(415,{ok:false,error:'unsupported_media_type'});
    let body;
    try{
      const declared=Number(request.headers.get('content-length')||0);
      if(!Number.isSafeInteger(declared)||declared<0||declared>2048)
       return reply(413,{ok:false,error:'checkout_request_too_large'});
      // A client can omit Content-Length or stream forever; never buffer
      // untrusted checkout JSON with Request.text() before enforcing limits.
      const raw=new TextDecoder('utf-8',{fatal:true}).decode(await boundedBytes(request,2048));
      body=JSON.parse(raw);
    }catch(error){
      if(error?.message==='provider_body_too_large')
       return reply(413,{ok:false,error:'checkout_request_too_large'});
      if(error?.message==='provider_body_timeout')
       return reply(408,{ok:false,error:'checkout_request_timeout'});
      return reply(400,{ok:false,error:'invalid_json'});
    }
    if(!onlyAllowedBody(body))return reply(400,{ok:false,error:'server_owned_pricing_required'});
    let item;
    try{item=await env.STORE_DB.prepare('SELECT sku,amount_cents,currency,status,publisher_type FROM store_products WHERE sku=?1 LIMIT 1').bind(body.sku).first();}
    catch{return reply(503,{ok:false,error:'store_db_unavailable'});}
    if(!item||item.sku!==body.sku||item.status!=='approved'||item.publisher_type!=='first_party'||
       item.currency!=='USD'||!Number.isSafeInteger(item.amount_cents)||item.amount_cents<1||item.amount_cents>100000000)
      return reply(400,{ok:false,error:'product_not_approved'});
    const reference=newReference();
    if(!/^STORE-[A-Z0-9]{16,48}$/.test(reference))return reply(503,{ok:false,error:'checkout_reference_unavailable'});
    const amount=(item.amount_cents/100).toFixed(2);
    const now=new Date().toISOString();
    const expires=new Date(Date.now()+30*60*1000).toISOString();
    // Store D1, never the Axiom subscription database.
    try{
      const inserted=await env.STORE_DB.prepare("INSERT INTO store_checkout_intents(reference,customer_id,sku,amount_cents,currency,status,created_at,expires_at) VALUES(?1,?2,?3,?4,?5,'initiating',?6,?7)")
        .bind(reference,customer.customer_id,item.sku,item.amount_cents,item.currency,now,expires).run();
      // Cloudflare D1 reports the affected-row count. If this cannot be
      // verified, it is unsafe to initiate a real Paynow transaction.
      if(inserted?.success!==true||inserted?.meta?.changes!==1)
        return reply(503,{ok:false,error:'store_order_not_durably_recorded'});
    }catch{return reply(503,{ok:false,error:'store_order_persistence_failed'});}
    const values={id:env.STORE_PAYNOW_ID,reference,amount,
      additionalinfo:'MUSITU Store '+item.sku,
      returnurl:BASE+'/return?reference='+encodeURIComponent(reference),
      resulturl:BASE+'/webhooks/paynow',status:'Message'};
    const hash=await hexSha(FIELDS.map(k=>values[k]).join('')+env.STORE_PAYNOW_INTEGRATION_KEY);
    const form=new URLSearchParams([...FIELDS.map(k=>[k,values[k]]),['hash',hash]]);
    let state='provider_failed';
    try{
      const controller=new AbortController();
      const timeout=setTimeout(()=>controller.abort(),8000);
      let parsed;
      try{
        const response=await paynowFetch(PAYNOW,{method:'POST',body:form.toString(),headers:{'content-type':'application/x-www-form-urlencoded'},redirect:'error',signal:controller.signal});
        if(!response.ok||response.status!==200)throw Error('provider_unavailable');
        const size=Number(response.headers.get('content-length')||0);
        if(size>8192)throw Error('provider_response_too_large');
        // Keep the absolute deadline alive through response streaming,
        // not merely until the provider responds with HTTP headers.
        const data=await readBounded(response);
        if(data.length>8192)throw Error('provider_response_too_large');
        parsed=await signedReply(new TextDecoder().decode(data),env.STORE_PAYNOW_INTEGRATION_KEY);
      }finally{clearTimeout(timeout);}
      const persisted=await env.STORE_DB.prepare("UPDATE store_checkout_intents SET status='pending',browser_url=?2,poll_url=?3 WHERE reference=?1 AND status='initiating'")
         .bind(reference,parsed.browserurl,parsed.pollurl).run();
      if(persisted?.success!==true||persisted?.meta?.changes!==1)
        throw Error('store_pending_transition_not_persisted');
      return reply(201,{ok:true,reference,sku:item.sku,amount_cents:item.amount_cents,currency:item.currency,
       browser_url:parsed.browserurl,expires_at:expires,payment_status:'pending'});
    }catch{
      try{await env.STORE_DB.prepare('UPDATE store_checkout_intents SET status=?2 WHERE reference=?1 AND status=\'initiating\'').bind(reference,state).run();}catch{}
      return reply(502,{ok:false,error:'provider_checkout_unverified',reference});
    }
  }};
}
export default createStoreBillingWorker();
