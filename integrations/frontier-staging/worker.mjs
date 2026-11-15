/** Isolated fixture D1 bridge candidate. No Cloudflare REST credential, arbitrary
 * SQL, database provisioning, schema migration, customer creation or OAuth write.
 * The legacy Frontier adapter remains disabled and does not import this bridge.
 */
import {SCHEMA,H64,StagingHold,hold,exact,fixtureId,validateScope,canonical,sha} from './protocol.mjs';
const HEADERS={'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'};
const reply=(status,value)=>new Response(JSON.stringify(value),{status,headers:HEADERS});
const ROUTES=new Map([['/v1/staging/put','write'],['/v1/staging/read','read'],['/v1/staging/revoke','admin']]);
function config(env){
 let pin,registry;
 try{
  if(typeof env.FRONTIER_STAGE_SCOPE_JSON!=='string'||env.FRONTIER_STAGE_SCOPE_JSON.length>2048||
   typeof env.FRONTIER_STAGE_PRINCIPALS_JSON!=='string'||env.FRONTIER_STAGE_PRINCIPALS_JSON.length>16384)
   hold('FRONTIER_STAGE_CONFIGURATION_HOLD');
  pin=validateScope(JSON.parse(env.FRONTIER_STAGE_SCOPE_JSON));
  registry=JSON.parse(env.FRONTIER_STAGE_PRINCIPALS_JSON);
 }catch{hold('FRONTIER_STAGE_CONFIGURATION_HOLD');}
 if(!env.FRONTIER_STAGE_DB||typeof env.FRONTIER_STAGE_DB.prepare!=='function'||
  !Array.isArray(registry)||registry.length<3||registry.length>24)hold('FRONTIER_STAGE_CONFIGURATION_HOLD');
 const principals=new Map();
 for(const p of registry){
  exact(p,['token_sha256','tenant_id','role']);fixtureId(p.tenant_id);
  if(typeof p.token_sha256!=='string'||!H64.test(p.token_sha256)||principals.has(p.token_sha256)||
   !['write','read','admin'].includes(p.role))hold('FRONTIER_STAGE_PRINCIPALS_HOLD');
  principals.set(p.token_sha256,Object.freeze({...p}));
 }
 return {pin,principals};
}
async function body(request){
 if(request.headers.get('origin')||request.headers.get('cookie')||request.headers.get('sec-fetch-site'))
  hold('FRONTIER_STAGE_SERVER_CHANNEL_REQUIRED',403);
 if(request.headers.get('content-type')!=='application/json')hold('FRONTIER_STAGE_JSON_REQUIRED',415);
 const reader=request.body?.getReader();if(!reader)hold('FRONTIER_STAGE_BODY_REQUIRED',400);
 let timer,text='',size=0;const decoder=new TextDecoder('utf-8',{fatal:true});
 const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new StagingHold(
  'FRONTIER_STAGE_BODY_TIMEOUT_HOLD')),2000);});
 try{
  for(;;){const next=await Promise.race([reader.read(),deadline]);if(next.done)break;
   size+=next.value.byteLength;if(size>8192)hold('FRONTIER_STAGE_BODY_SIZE_HOLD',413);
   text+=decoder.decode(next.value,{stream:true});}
  text+=decoder.decode();let value;try{value=JSON.parse(text);}catch{hold('FRONTIER_STAGE_JSON_INVALID',400);}
  return value;
 }finally{clearTimeout(timer);void reader.cancel().catch(()=>{});reader.releaseLock();}
}
const MARKER='EXISTS (SELECT 1 FROM frontier_stage_identity WHERE singleton=1 AND account_id=? AND database_id=? AND scope_nonce=?)';
const NOT_REVOKED='NOT EXISTS (SELECT 1 FROM frontier_stage_revocations WHERE scope_nonce=? AND tenant_id=? AND token_sha256=?)';
const guardValues=(pin,p)=>[pin.account_id,pin.database_id,pin.scope_nonce,pin.scope_nonce,p.tenant_id,p.token_sha256];
async function first(db,sql,values){return db.prepare(sql).bind(...values).first();}
export default {async fetch(request,env){
 try{
  const path=new URL(request.url).pathname,role=ROUTES.get(path);
  if(request.method!=='POST'||!role)return reply(404,{error:'FRONTIER_STAGE_ROUTE_NOT_FOUND',dispatch_allowed:false});
  const {pin,principals}=config(env);
  const bearer=request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{32,200})$/)?.[1];
  if(!bearer)hold('FRONTIER_STAGE_AUTH_REQUIRED',401);
  const digest=await sha(bearer),principal=principals.get(digest);
  if(!principal||principal.role!==role)hold('FRONTIER_STAGE_ROLE_DENIED',403);
  const input=await body(request);
  const common=['schema','scope_nonce','tenant_id'];
  exact(input,role==='admin'?[...common,'token_sha256']:role==='write'?
   [...common,'record_id','expected_version','payload']:[...common,'record_id']);
  if(input.schema!==SCHEMA||input.scope_nonce!==pin.scope_nonce)hold('FRONTIER_STAGE_SCOPE_MISMATCH',403);
  fixtureId(input.tenant_id);
  if(input.tenant_id!==principal.tenant_id)hold('FRONTIER_STAGE_TENANT_DENIED',403);
  if(role!=='admin')fixtureId(input.record_id);
  const db=env.FRONTIER_STAGE_DB;
  // No request can create this marker or any table. Wrong/empty bindings fail
  // on this read before any possible mutation. SQL guards repeat the identity
  // and revocation decisions at the actual mutation/read linearization point.
  const marker=await first(db,'SELECT account_id,database_id,scope_nonce FROM frontier_stage_identity WHERE singleton=1',[]);
  if(!marker||marker.account_id!==pin.account_id||marker.database_id!==pin.database_id||marker.scope_nonce!==pin.scope_nonce)
   hold('FRONTIER_STAGE_DATABASE_MARKER_HOLD');
  if(await first(db,'SELECT token_sha256 FROM frontier_stage_revocations WHERE scope_nonce=? AND tenant_id=? AND token_sha256=?',
   [pin.scope_nonce,principal.tenant_id,digest]))hold('FRONTIER_STAGE_TOKEN_REVOKED',403);
  const guard=guardValues(pin,principal),base={schema:SCHEMA,scope_nonce:pin.scope_nonce,tenant_id:principal.tenant_id};
  if(role==='admin'){
   if(typeof input.token_sha256!=='string'||!H64.test(input.token_sha256))hold('FRONTIER_STAGE_REVOKE_TARGET_HOLD',400);
   const target=principals.get(input.token_sha256);
   if(!target||target.tenant_id!==principal.tenant_id||target.role==='admin')hold('FRONTIER_STAGE_REVOKE_TARGET_HOLD',403);
   await db.prepare('INSERT INTO frontier_stage_revocations(scope_nonce,tenant_id,token_sha256) SELECT ?,?,? WHERE '+
    MARKER+' AND '+NOT_REVOKED+' ON CONFLICT DO NOTHING').bind(
     pin.scope_nonce,principal.tenant_id,input.token_sha256,...guard).run();
   const retained=await first(db,'SELECT token_sha256 FROM frontier_stage_revocations WHERE scope_nonce=? AND tenant_id=? AND token_sha256=?',
    [pin.scope_nonce,principal.tenant_id,input.token_sha256]);
   if(!retained)hold('FRONTIER_STAGE_REVOCATION_UNCONFIRMED_HOLD');
   return reply(200,{...base,operation:'revoke',revoked_token_sha256:input.token_sha256,revoked:true});
  }
  if(role==='write'){
   if(!Number.isSafeInteger(input.expected_version)||input.expected_version<0||input.expected_version>1000000)
    hold('FRONTIER_STAGE_VERSION_HOLD',400);
   const payload=canonical(input.payload);
   if(new TextEncoder().encode(payload).length>4096)hold('FRONTIER_STAGE_PAYLOAD_SIZE_HOLD',413);
   const payloadSha=await sha(payload);let result;
   if(input.expected_version===0){
    result=await db.prepare('INSERT INTO frontier_stage_records(scope_nonce,tenant_id,record_id,version,payload_json,payload_sha256) '+
     'SELECT ?,?,?,1,?,? WHERE '+MARKER+' AND '+NOT_REVOKED+' ON CONFLICT DO NOTHING').bind(
      pin.scope_nonce,principal.tenant_id,input.record_id,payload,payloadSha,...guard).run();
   }else{
    result=await db.prepare('UPDATE frontier_stage_records SET version=version+1,payload_json=?,payload_sha256=? '+
     'WHERE scope_nonce=? AND tenant_id=? AND record_id=? AND version=? AND '+MARKER+' AND '+NOT_REVOKED).bind(
      payload,payloadSha,pin.scope_nonce,principal.tenant_id,input.record_id,input.expected_version,...guard).run();
   }
   if(result.success!==true||result.meta?.changes!==1)hold('FRONTIER_STAGE_CAS_OR_AUTHORITY_HOLD',409);
   return reply(200,{...base,operation:'put',record_id:input.record_id,version:input.expected_version+1,payload_sha256:payloadSha});
  }
  const row=await first(db,'SELECT version,payload_json,payload_sha256 FROM frontier_stage_records '+
   'WHERE scope_nonce=? AND tenant_id=? AND record_id=? AND '+MARKER+' AND '+NOT_REVOKED,
   [pin.scope_nonce,principal.tenant_id,input.record_id,...guard]);
  if(!row)hold('FRONTIER_STAGE_RECORD_NOT_FOUND_OR_DENIED',404);
  if(!Number.isSafeInteger(row.version)||row.version<1||!H64.test(row.payload_sha256)||
   await sha(row.payload_json)!==row.payload_sha256)hold('FRONTIER_STAGE_RECORDED_DATA_INTEGRITY_HOLD');
  return reply(200,{...base,operation:'read',record_id:input.record_id,version:row.version,
   payload:JSON.parse(row.payload_json),payload_sha256:row.payload_sha256});
 }catch(error){
  return reply(error instanceof StagingHold?error.status:503,{error:error instanceof StagingHold?error.code:
   'FRONTIER_STAGE_UNAVAILABLE_HOLD',dispatch_allowed:false});
 }
}};
