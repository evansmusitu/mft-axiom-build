// MFT EDUCATION NEXUS | WhatsApp 0781572008
// Isolated WhatsApp test integration; no templates or payment operations.
const json=(value,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store'}});
const DAY=86400000,RETENTION=7*DAY;
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
const recipients=env=>String(env.WHATSAPP_TEST_RECIPIENTS||'').split(',').map(x=>x.trim()).filter(x=>/^\d{8,15}$/.test(x));
export function whatsappEnabled(env){
 const mode=env.WHATSAPP_MODE;
 return env.ENABLE_WHATSAPP_MESSAGES==='true'&&Boolean(env.WHATSAPP_APP_SECRET&&env.WHATSAPP_VERIFY_TOKEN&&env.WHATSAPP_PHONE_NUMBER_ID&&env.WHATSAPP_ACCESS_TOKEN&&env.AI_BUDGET)&&
  ((mode==='test'&&recipients(env).length>0)||(mode==='production'&&env.ENABLE_WHATSAPP_PRODUCTION==='true'));
}
const allowedRecipient=(env,to)=>whatsappEnabled(env)&&(env.WHATSAPP_MODE==='production'||recipients(env).includes(to));
export async function receiveWhatsApp(obj,env,answer){
 if(obj?.object!=='whatsapp_business_account')return;
 if(!Array.isArray(obj.entry))throw Error('Invalid webhook shape');
 const bucket=env.AI_BUDGET.get(env.AI_BUDGET.idFromName('mft-education-nexus-global'));
 for(const entry of obj.entry)for(const change of entry.changes||[]){
  const value=change.value;
  if(change.field!=='messages'||String(value?.metadata?.phone_number_id||'')!==String(env.WHATSAPP_PHONE_NUMBER_ID))continue;
  for(const status of value.statuses||[]){
   if(typeof status?.id!=='string'||!['sent','delivered','read','failed'].includes(status.status))continue;
   const r=await bucket.fetch('https://internal/whatsapp-status',{method:'POST',body:JSON.stringify({id:status.id,status:status.status,timestamp:status.timestamp})});
   if(!r.ok)throw Error('Status storage unavailable');
  }
  for(const msg of value.messages||[]){
   if(typeof msg?.id!=='string'||msg.id.length<4||msg.id.length>200||msg.type!=='text'||typeof msg.text?.body!=='string'||!/^\d{8,15}$/.test(msg.from||'')||!allowedRecipient(env,msg.from))continue;
   const timestamp=Number(msg.timestamp)*1000;
   if(!Number.isFinite(timestamp)||timestamp<Date.now()-DAY||timestamp>Date.now()+300000)continue;
   const r=await bucket.fetch('https://internal/whatsapp-event',{method:'POST',body:JSON.stringify({id:msg.id,to:msg.from,body:await answer(msg.text.body,env),timestamp})});
   if(!r.ok)throw Error('Reply persistence unavailable');
  }
 }
}
async function send(env,to,body){
 const version=/^v\d+\.\d+$/.test(env.GRAPH_API_VERSION||'')?env.GRAPH_API_VERSION:'v23.0';
 try{
  const response=await fetch('https://graph.facebook.com/'+version+'/'+encodeURIComponent(env.WHATSAPP_PHONE_NUMBER_ID)+'/messages',{
   method:'POST',headers:{authorization:'Bearer '+env.WHATSAPP_ACCESS_TOKEN,'content-type':'application/json'},
   body:JSON.stringify({messaging_product:'whatsapp',to,type:'text',text:{body:body.slice(0,3800)}}),signal:AbortSignal.timeout(10000)
  });
  let result;try{result=await response.json();}catch{}
  if(response.ok){const id=result?.messages?.[0]?.id;return typeof id==='string'?{state:'accepted',digest:await hash(id),http:response.status}:{state:'unknown',http:response.status};}
  if(response.status===429||response.status>=500){const header=response.headers.get('retry-after');const retry=Number(header);const date=Date.parse(header||'');return {state:'retry',http:response.status,delay:Math.min(900000,Math.max(1000,Number.isFinite(retry)&&retry>0?retry*1000:Number.isFinite(date)?date-Date.now():30000))};}
  return {state:'failed',http:response.status};
 }catch{return {state:'unknown',http:0};}
}
export class MftAiDailyQuota{
 constructor(state,env){this.state=state;this.env=env;this.draining=null;}
 tables(){
  const sql=this.state.storage.sql;
  sql.exec('CREATE TABLE IF NOT EXISTS wa_seen (digest TEXT PRIMARY KEY, received_at INTEGER NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS wa_outbox (digest TEXT PRIMARY KEY, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, recipient TEXT, body TEXT, state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL, provider_digest TEXT, delivery_status TEXT, last_http INTEGER NOT NULL DEFAULT 0)');
  sql.exec('CREATE TABLE IF NOT EXISTS wa_status (digest TEXT PRIMARY KEY, status TEXT NOT NULL, updated_at INTEGER NOT NULL)');
  return sql;
 }
 cleanup(sql){const now=Date.now();sql.exec('DELETE FROM wa_seen WHERE received_at < ?1',now-RETENTION);sql.exec('DELETE FROM wa_outbox WHERE created_at < ?1',now-RETENTION);sql.exec('DELETE FROM wa_status WHERE updated_at < ?1',now-RETENTION);}
 async schedule(){
  const sql=this.tables();this.cleanup(sql);
  const next=[...sql.exec("SELECT MIN(next_attempt) AS n FROM wa_outbox WHERE state IN ('pending','retry','sending')")][0]?.n;
  // Keep a cleanup alarm while retained receipts exist, even with an empty outbox.
  const retained=[...sql.exec('SELECT COUNT(*) AS n FROM wa_outbox')][0]?.n;
  const statusCount=[...sql.exec('SELECT COUNT(*) AS n FROM wa_status')][0]?.n;
  if(next!==null&&next!==undefined||retained||statusCount)await this.state.storage.setAlarm(Math.max(Date.now()+1000,next??Date.now()+DAY));
  else await this.state.storage.deleteAlarm();
 }
 async fetch(req){
  const path=new URL(req.url).pathname;
  try{
   if(path==='/claim'){
    const sql=this.state.storage.sql,today=new Date().toISOString().slice(0,10);
    sql.exec('CREATE TABLE IF NOT EXISTS daily (day TEXT PRIMARY KEY, used INTEGER NOT NULL)');
    const rows=[...sql.exec('INSERT INTO daily(day,used) VALUES (?1,1) ON CONFLICT(day) DO UPDATE SET used=used+1 WHERE used<20 RETURNING used',today)];
    return json({allowed:rows.length===1,used:rows[0]?.used||20});
   }
   if(path==='/whatsapp-drain'&&req.method==='POST'){await this.drain();return json({ok:true});}
   if(!['/whatsapp-event','/whatsapp-status'].includes(path))return json({error:'Not found'},404);
   if(req.method!=='POST')return json({error:'Method not allowed'},405);
   const data=await req.json();
   if(typeof data?.id!=='string'||data.id.length<4||data.id.length>200)return json({error:'Invalid ID'},400);
   const digest=await hash(data.id),sql=this.tables(),now=Date.now();this.cleanup(sql);
   if(path==='/whatsapp-status'){
    if(!['sent','delivered','read','failed'].includes(data.status))return json({error:'Invalid status'},400);
    const rank={sent:1,failed:2,delivered:3,read:4};
    const old=[...sql.exec('SELECT status FROM wa_status WHERE digest=?1',digest)][0]?.status;
    const count=[...sql.exec('SELECT COUNT(*) AS n FROM wa_status')][0]?.n||0;
    if(!old&&count>=1000)return json({ok:true,ignored:true});
    const status=rank[old]>rank[data.status]?old:data.status;
    sql.exec('INSERT INTO wa_status (digest,status,updated_at) VALUES (?1,?2,?3) ON CONFLICT(digest) DO UPDATE SET status=?2,updated_at=?3',digest,status,now);
    sql.exec('UPDATE wa_outbox SET delivery_status=?1 WHERE provider_digest=?2',status,digest);
    await this.schedule();return json({ok:true});
   }
   if(!allowedRecipient(this.env,data.to)||typeof data.body!=='string'||data.body.length>3800||!Number.isFinite(data.timestamp))return json({error:'Invalid reply'},400);
   const existing=[...sql.exec('SELECT digest FROM wa_seen WHERE digest=?1',digest)];
   if(existing.length){await this.schedule();return json({allowed:false,reason:'duplicate'});}
   const total=[...sql.exec('SELECT COUNT(*) AS n FROM wa_seen WHERE received_at >= ?1',now-DAY)][0]?.n||0;
   if(total>=100)return json({allowed:false,reason:'whatsapp_daily_limit'});
   // Synchronous transaction: receipt and pending reply are committed together.
   this.state.storage.transactionSync(()=>{
    sql.exec('INSERT INTO wa_seen (digest,received_at) VALUES (?1,?2)',digest,now);
    sql.exec("INSERT INTO wa_outbox (digest,created_at,expires_at,recipient,body,state,next_attempt) VALUES (?1,?2,?3,?4,?5,'pending',?2)",digest,now,data.timestamp+DAY,data.to,data.body);
   });
   await this.schedule();return json({allowed:true});
  }catch{return json({error:'Storage unavailable'},503);}
 }
 async drain(){
  if(this.draining)return this.draining;
  this.draining=this.process();try{await this.draining;}finally{this.draining=null;}
 }
 async process(){
  const sql=this.tables();this.cleanup(sql);
  if(!whatsappEnabled(this.env)){
   // Resolve crash ambiguity, then keep pending work resumable without sending.
   sql.exec("UPDATE wa_outbox SET state='unknown',recipient=NULL,body=NULL WHERE state='sending'");
   sql.exec("UPDATE wa_outbox SET next_attempt=?1 WHERE state IN ('pending','retry')",Date.now()+300000);
   await this.schedule();return;
  }
  const rows=[...sql.exec("SELECT * FROM wa_outbox WHERE state IN ('pending','retry','sending') AND next_attempt <= ?1 LIMIT 3",Date.now())];
  for(const row of rows){
   if(row.state==='sending'){
    // A restart after submission has an ambiguous outcome; never blindly resend.
    sql.exec("UPDATE wa_outbox SET state='unknown',recipient=NULL,body=NULL WHERE digest=?1",row.digest);continue;
   }
   if(row.expires_at<=Date.now()||!allowedRecipient(this.env,row.recipient)){
    sql.exec("UPDATE wa_outbox SET state='failed',recipient=NULL,body=NULL WHERE digest=?1",row.digest);continue;
   }
   const attempts=row.attempts+1;
   sql.exec("UPDATE wa_outbox SET state='sending',attempts=?1,next_attempt=?2 WHERE digest=?3",attempts,Date.now()+30000,row.digest);
   // Persist recovery alarm before making the external request.
   await this.schedule();
   const result=await send(this.env,row.recipient,row.body);
   if(result.state==='retry'&&attempts<5){
    sql.exec("UPDATE wa_outbox SET state='retry',last_http=?1,next_attempt=?2 WHERE digest=?3",result.http,Date.now()+Math.max(result.delay,1000*2**attempts),row.digest);
   }else{
    const state=result.state==='retry'?'failed':result.state;
    const delivered=result.digest?[...sql.exec('SELECT status FROM wa_status WHERE digest=?1',result.digest)][0]?.status:null;
    sql.exec('UPDATE wa_outbox SET state=?1,last_http=?2,provider_digest=?3,delivery_status=?4,recipient=NULL,body=NULL WHERE digest=?5',state,result.http,result.digest||null,delivered||null,row.digest);
   }
  }
  await this.schedule();
 }
 async alarm(){await this.drain();}
}
