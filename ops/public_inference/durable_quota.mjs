/** Axiom native SQLite Durable Object alternative to exhausted D1 Free database slots.
 * Requires a separate SQLite-class migration, secret/binding scope and independent
 * nonproduction deployment approval. This source does not deploy or publish.
 */
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/;
const HEX64=/^[0-9a-f]{64}$/;
const MODELS={cloudflare:'@cf/zai-org/glm-4.7-flash',groq:'openai/gpt-oss-120b'};
const INTFIELDS=['nonce','subject','project','provider','model','max_tokens'];
const SQL=`INSERT INTO reservations (nonce,subject,project,provider,day_utc,minute_utc,max_tokens)
 SELECT ?,?,?,?,?,?,?
 WHERE (SELECT count(*) FROM reservations WHERE day_utc=?)<40
 AND (SELECT count(*) FROM reservations WHERE day_utc=? AND subject=?)<4
 AND (SELECT count(*) FROM reservations WHERE minute_utc=?)<3
 AND coalesce((SELECT sum(max_tokens) FROM reservations WHERE day_utc=?),0)+?<=7500
 AND coalesce((SELECT sum(max_tokens) FROM reservations WHERE day_utc=? AND provider=?),0)+?<=?`;
const text=(s)=>new TextEncoder().encode(s);
function hex(b){return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function mac(key,msg) {
 if(typeof key!=='string'||key.length<48||key.length>256)throw Error('SCOPE_DENIED');
 const k=await crypto.subtle.importKey('raw',text(key),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return hex(await crypto.subtle.sign('HMAC',k,text(msg)));
}
function validate(c){
 if(!c||typeof c!=='object'||Array.isArray(c)||Object.keys(c).sort().join(',')!==INTFIELDS.slice().sort().join(','))throw Error('SCOPE_DENIED');
 if(typeof c.nonce!=='string'||!HEX64.test(c.nonce)||typeof c.subject!=='string'||!ID.test(c.subject)||typeof c.project!=='string'||!ID.test(c.project)||!Object.hasOwn(MODELS,c.provider)||c.model!==MODELS[c.provider]||!Number.isInteger(c.max_tokens)||c.max_tokens<1||c.max_tokens>256)throw Error('SCOPE_DENIED');
}
export async function reserveQuotaDurable(binding, key, permit) {
 validate(permit);
 if(!binding||typeof binding.idFromName!=='function'||typeof binding.get!=='function')throw Error('QUOTA_DURABLE_BINDING_REQUIRED');
 const data=JSON.stringify(Object.fromEntries(INTFIELDS.map(k=>[k,permit[k]])));
 const signature=await mac(key,data);
 let response;
 try{
   const stub=binding.get(binding.idFromName('axiom-public-inference-global-v1'));
   response=await stub.fetch('https://quota.internal/reserve',{method:'POST',
     headers:{'content-type':'application/json','x-axiom-internal-signature':signature},body:data});
 }catch{throw Error('DURABLE_QUOTA_UNAVAILABLE')}
 if(response?.status!==204)throw Error('DURABLE_QUOTA_REJECTED');
 return {nonce:permit.nonce,committed:true};
}
export class AxiomGlobalInferenceQuota {
 constructor(ctx,env){
   this.ctx=ctx;this.env=env;
   this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS reservations(
     nonce TEXT PRIMARY KEY NOT NULL,subject TEXT NOT NULL,project TEXT NOT NULL,
     provider TEXT NOT NULL,day_utc TEXT NOT NULL,minute_utc TEXT NOT NULL,
     max_tokens INTEGER NOT NULL CHECK(max_tokens BETWEEN 1 AND 256))`);
   this.ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS rq_day ON reservations(day_utc)');
   this.ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS rq_subday ON reservations(day_utc,subject)');
   this.ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS rq_minute ON reservations(minute_utc)');
 }
 async fetch(request){
   if(request.method!=='POST'||new URL(request.url).pathname!=='/reserve'||request.headers.get('content-type')!=='application/json')return new Response(null,{status:403});
   try{
     const key=this.env.AXIOM_DO_INTERNAL_QUOTA_KEY;
     if(typeof key!=='string'||key.length<48)throw Error('INTERNAL_GATE_MISSING');
     const raw=await request.text();
     if(raw.length<30||raw.length>1100)throw Error('BOUNDED_BODY_REQUIRED');
     const sig=request.headers.get('x-axiom-internal-signature');
     if(typeof sig!=='string'||!HEX64.test(sig))throw Error('AUTH_MISSING');
     const expected=await mac(key,raw);
     const same=await crypto.subtle.timingSafeEqual?.(Uint8Array.from(sig.match(/../g),s=>parseInt(s,16)),Uint8Array.from(expected.match(/../g),s=>parseInt(s,16)));
     // timingSafeEqual is optional in Workers; fallback to independent HMAC verify.
     if(same!==true){
       const k=await crypto.subtle.importKey('raw',text(key),{name:'HMAC',hash:'SHA-256'},false,['verify']);
       if(!await crypto.subtle.verify('HMAC',k,Uint8Array.from(sig.match(/../g),s=>parseInt(s,16)),text(raw)))throw Error('BAD_INTERNAL_SIGNATURE');
     }
     const claims=JSON.parse(raw);validate(claims);
     const iso=new Date().toISOString();const day=iso.slice(0,10),minute=iso.slice(0,16);
     const maxProvider=claims.provider==='cloudflare'?5000:2500;
     const params=[claims.nonce,claims.subject,claims.project,claims.provider,day,minute,claims.max_tokens,
       day,day,claims.subject,minute,day,claims.max_tokens,
       day,claims.provider,claims.max_tokens,maxProvider];
     const approved=this.ctx.storage.transactionSync(()=>{
       this.ctx.storage.sql.exec(SQL,...params);
       const changed=this.ctx.storage.sql.exec('SELECT changes() AS n').one();
       return changed?.n===1;
     });
     if(!approved)throw Error('NO_ADMISSION');
     return new Response(null,{status:204});
   }catch{return new Response(null,{status:429});}
 }
}
