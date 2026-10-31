// Additive S1 candidate only. Payment verification is delegated to an independently
// authenticated provider adapter; this module never treats a browser redirect as settlement.
const okString=(v,min=1,max=150)=>typeof v==='string'&&v.length>=min&&v.length<=max&&/^[\x20-\x7e]+$/.test(v);
const id=()=>crypto.randomUUID();
const one=async (db,sql,...params)=>await db.prepare(sql).bind(...params).first();
const all=async (db,sql,...params)=>(await db.prepare(sql).bind(...params).all()).results;
const execute=async (db,sql,...params)=>await db.prepare(sql).bind(...params).run();
const atomic=async(db,items)=>db.batch(items.map(([sql,...params])=>db.prepare(sql).bind(...params)));
const fail=(message)=>{throw new Error(message)};
const must=(condition,message)=>{if(!condition)fail(message)};
export async function balance(db,tenant){
 const row=await one(db,`SELECT (SELECT COALESCE(SUM(delta),0) FROM credit_ledger WHERE tenant_id=?) AS booked,(SELECT COALESCE(SUM(units),0) FROM holds WHERE tenant_id=? AND state='open') AS reserved`,tenant,tenant);
 return {booked:row.booked,reserved:row.reserved,available:Math.max(0,row.booked-row.reserved),debt:Math.max(0,-row.booked)};
}
export async function createOrder(db,tenant,identity,priceId,key){
 must(okString(key,8,100),'invalid_idempotency_key');
 const previous=await one(db,'SELECT * FROM orders WHERE tenant_id=? AND client_key=?',tenant,key);if(previous){must(previous.price_id===priceId&&previous.identity_id===identity,'order_key_conflict');return previous;}
 const price=await one(db,'SELECT * FROM price_catalog WHERE id=? AND enabled=1',priceId);must(price,'catalog_unavailable');
 const orderId=id();try{await execute(db,'INSERT INTO orders (id,tenant_id,identity_id,price_id,amount_minor,currency,grant_units,client_key) VALUES (?,?,?,?,?,?,?,?)',orderId,tenant,identity,price.id,price.amount_minor,price.currency,price.grant_units,key)}catch(e){const old=await one(db,'SELECT * FROM orders WHERE tenant_id=? AND client_key=?',tenant,key);if(old){must(old.price_id===priceId&&old.identity_id===identity,'order_key_conflict');return old;}throw e}
 return await one(db,'SELECT * FROM orders WHERE id=?',orderId);
}
export async function reconcileSettlement(db,verified){
 // verified is an ATTESTATION from the external payment verifier service,
 // NEVER parsed directly from customer/client/webhook data.
 const {eventId,provider,transactionId,orderId,amountMinor,currency,kind='settlement'}=verified;
 must([eventId,provider,transactionId,orderId,currency].every(x=>okString(x,1,150))&&Number.isSafeInteger(amountMinor)&&amountMinor>0,'invalid_evidence');
 must(kind==='settlement','wrong_event_kind');
 const order=await one(db,'SELECT * FROM orders WHERE id=?',orderId);must(order,'order_missing');
 must(order.amount_minor===amountMinor&&order.currency===currency,'payment_mismatch');
 const existing=await one(db,'SELECT * FROM provider_events WHERE event_id=?',eventId);
 if(existing){must(existing.order_id===orderId&&existing.provider===provider&&existing.provider_transaction_id===transactionId&&existing.kind===kind&&existing.amount_minor===amountMinor&&existing.currency===currency,'event_collision');return {idempotent:true,orderId};}
 must(order.state==='pending','order_not_pending');
 try{
 await atomic(db,[
  ['INSERT INTO provider_events(event_id,provider,provider_transaction_id,order_id,kind,amount_minor,currency) VALUES(?,?,?,?,?,?,?)',eventId,provider,transactionId,orderId,'settlement',amountMinor,currency],
  ["UPDATE orders SET state='settled' WHERE id=? AND state='pending'",orderId],
  ['INSERT INTO credit_ledger(id,tenant_id,delta,source_key,event_id) VALUES(?,?,?,?,?)',id(),order.tenant_id,order.grant_units,`settlement:${orderId}`,eventId],
  ['INSERT INTO invoices(id,tenant_id,order_id,currency,amount_minor) VALUES(?,?,?,?,?)',id(),order.tenant_id,orderId,currency,amountMinor]
 ]);
 }catch(error){const p=await one(db,'SELECT * FROM provider_events WHERE event_id=?',eventId);if(p){must(p.order_id===orderId&&p.provider===provider&&p.provider_transaction_id===transactionId&&p.kind===kind&&p.amount_minor===amountMinor&&p.currency===currency,'event_collision');return {idempotent:true,orderId};}throw error}
 return {idempotent:false,orderId};
}
export async function reserve(db,tenant,requestKey,units,workId=null){
 must(okString(requestKey,8,120)&&Number.isSafeInteger(units)&&units>0,'invalid_reservation');
 const old=await one(db,'SELECT * FROM holds WHERE tenant_id=? AND request_key=?',tenant,requestKey);if(old){must(old.units===units&&old.work_id===workId,'reservation_key_conflict');return old;}
 const holdId=id();
 const result=await execute(db,`INSERT INTO holds(id,tenant_id,request_key,units,work_id,state)
 SELECT ?,?,?,?,?, 'open' WHERE
 (SELECT status FROM tenants WHERE id=?)='active' AND
 (SELECT COALESCE(SUM(delta),0) FROM credit_ledger WHERE tenant_id=?) -
 (SELECT COALESCE(SUM(units),0) FROM holds WHERE tenant_id=? AND state='open') >= ?`,holdId,tenant,requestKey,units,workId,tenant,tenant,tenant,units).catch(async e=>{
  const prior=await one(db,'SELECT * FROM holds WHERE tenant_id=? AND request_key=?',tenant,requestKey);if(prior){must(prior.units===units&&prior.work_id===workId,'reservation_key_conflict');return {prior};}throw e;
 });
 if(result.prior)return result.prior;
 must(result.meta?.changes===1,'insufficient_credits_or_inactive_tenant');
 return await one(db,'SELECT * FROM holds WHERE id=?',holdId);
}
export async function finishHold(db,tenant,holdId,mode){
 must(mode==='committed'||mode==='released','invalid_transition');
 const hold=await one(db,'SELECT * FROM holds WHERE id=? AND tenant_id=?',holdId,tenant);must(hold,'hold_missing');
 if(hold.state===mode)return {idempotent:true};must(hold.state==='open','hold_already_finished');
 const op=['UPDATE holds SET state=? WHERE id=? AND tenant_id=? AND state=\'open\'',mode,holdId,tenant];
 // A SQL transition trigger requires the debit to exist before a hold is committed.
 // db.batch MUST provide a single atomic database transaction; validate real D1 separately.
 const entries=mode==='committed'?[
  ['INSERT INTO credit_ledger(id,tenant_id,delta,source_key) VALUES(?,?,?,?)',id(),tenant,-hold.units,`usage:${hold.id}`],op
 ]:[op];
 try{const result=await atomic(db,entries);must(result[mode==='committed'?1:0].meta?.changes===1,'hold_race');}catch(e){const p=await one(db,'SELECT state FROM holds WHERE id=?',holdId);if(p?.state===mode)return {idempotent:true};throw e}
 return {idempotent:false};
}
export async function requestRefund(db,tenant,identity,orderId,amountMinor,reason,key){
 must(okString(key,8,100)&&okString(reason,8,500)&&Number.isSafeInteger(amountMinor)&&amountMinor>0,'invalid_refund');
 const prior=await one(db,'SELECT * FROM refund_requests WHERE tenant_id=? AND client_key=?',tenant,key);if(prior){must(prior.order_id===orderId&&prior.amount_minor===amountMinor&&prior.identity_id===identity&&prior.reason===reason,'refund_key_conflict');return prior;}
 const order=await one(db,'SELECT * FROM orders WHERE id=? AND tenant_id=? AND state=\'settled\'',orderId,tenant);must(order,'settled_order_missing');
 const refundId=id();
 // Conditional insert performs the outstanding-value check within one serialized D1 write.
 const statement=`INSERT INTO refund_requests(id,tenant_id,order_id,identity_id,amount_minor,reason,client_key)
 SELECT ?,?,?,?,?,?,? WHERE ? <= (
   SELECT o.amount_minor-COALESCE(SUM(r.amount_minor),0) FROM orders o
   LEFT JOIN refund_requests r ON r.order_id=o.id AND r.state!='rejected'
   WHERE o.id=? GROUP BY o.id,o.amount_minor)`;
 try{const created=await execute(db,statement,refundId,tenant,orderId,identity,amountMinor,reason,key,amountMinor,orderId);must(created.meta?.changes===1,'refund_exceeds_outstanding');}
 catch(e){const old=await one(db,'SELECT * FROM refund_requests WHERE tenant_id=? AND client_key=?',tenant,key);if(old){must(old.order_id===orderId&&old.amount_minor===amountMinor&&old.identity_id===identity&&old.reason===reason,'refund_key_conflict');return old;}throw e}
 return await one(db,'SELECT * FROM refund_requests WHERE id=?',refundId);
}
export async function reconcileRefund(db,verified){
 const {eventId,provider,transactionId,refundId,orderId,amountMinor,currency}=verified;
 must([eventId,provider,transactionId,refundId,orderId,currency].every(x=>okString(x,1,150))&&Number.isSafeInteger(amountMinor)&&amountMinor>0,'invalid_refund_evidence');
 const ref=await one(db,'SELECT * FROM refund_requests WHERE id=? AND order_id=?',refundId,orderId);
 must(ref&&ref.amount_minor===amountMinor,'refund_mismatch');
 if(ref.state==='settled'){const prior=await one(db,'SELECT * FROM provider_events WHERE event_id=?',eventId);must(ref.event_id===eventId&&prior&&prior.provider===provider&&prior.provider_transaction_id===transactionId&&prior.order_id===orderId&&prior.amount_minor===amountMinor&&prior.currency===currency,'refund_event_collision');return {idempotent:true};}
 must(ref.state==='provider_pending','refund_not_provider_pending');
 const order=await one(db,'SELECT * FROM orders WHERE id=? AND state=\'settled\'',orderId);must(order&&order.currency===currency,'refund_currency_mismatch');
 const already=await one(db,"SELECT COALESCE(SUM(amount_minor),0) AS amount FROM refund_requests WHERE order_id=? AND state='settled'",orderId);
 // Round credit reversal toward consumer only on final refund; no currency float.
 must([order.grant_units,order.amount_minor,already.amount].every(Number.isSafeInteger),'refund_integer_precision_unverified');
 const cumulative=BigInt(already.amount)+BigInt(amountMinor);
 must(cumulative<=BigInt(order.amount_minor),'refund_exceeds_order_amount');
 const prevUnits=BigInt(order.grant_units)*BigInt(already.amount)/BigInt(order.amount_minor);
 const nextUnits=BigInt(order.grant_units)*cumulative/BigInt(order.amount_minor);
 const delta=Number(nextUnits-prevUnits);must(Number.isSafeInteger(delta)&&delta>0,'refund_requires_manual_credit_adjustment');
 await atomic(db,[
  ['INSERT INTO provider_events(event_id,provider,provider_transaction_id,order_id,kind,amount_minor,currency) VALUES(?,?,?,?,?,?,?)',eventId,provider,transactionId,orderId,'refund',amountMinor,currency],
  ["UPDATE refund_requests SET state='settled',event_id=? WHERE id=? AND state='provider_pending'",eventId,refundId],
  ['INSERT INTO credit_ledger(id,tenant_id,delta,source_key,event_id) VALUES(?,?,?,?,?)',id(),order.tenant_id,-delta,`refund:${refundId}`,eventId]
 ]);
 return {idempotent:false,revokedUnits:delta};
}
export {one,all,execute,atomic};
