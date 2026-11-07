// Temporary, operator-only actual product-module acceptance. No public product routes.
import {handle} from '../customer-hosted-acceptance-20261107/customer_frontier/customer_control_plane/worker.mjs';
import {handleIdentityBinding,handleIdentityBrowser} from '../customer-hosted-acceptance-20261107/customer_frontier/customer_control_plane/zitadel_session_broker_candidate.mjs';
import {ZITADEL_STAGING} from '../customer-hosted-acceptance-20261107/customer_frontier/customer_control_plane/zitadel_provider_tokens_candidate.mjs';
import {reserve,finishHold,balance} from '../customer-hosted-acceptance-20261107/customer_frontier/customer_control_plane/ledger.mjs';
import {RUN,MARKER,A,B,IA,IB,SA,SB,DISABLE_SQL,DISABLED_SQL,LIMITS} from './acceptance-contract-before-ownership-guard.mjs';
const ORIGIN=new URL(ZITADEL_STAGING.redirect_uri).origin;
const BASE='b2ee9c1eb6c0ed8c0cf8fc1c9d02e5b7ae713c0c2dd292f946bd7d737d764737';
const PLAN_HASH='06cfe6adfed21dc718ce0f0cdd53521a05e8bee8d1f0e95fccd7e823575ed80c';
const CATALOG="SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type IN ('table','index','trigger','view') AND name NOT GLOB 'sqlite_*' ORDER BY type,name";
const assert=(v,c)=>{if(!v)throw Error(c);};
const hash=async s=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const canonical=r=>JSON.stringify(r.map(row=>Object.fromEntries(Object.keys(row).sort().map(k=>[k,row[k]])))).replace(/[\u0080-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
const normalized=s=>s.trim().replace(/;\s*$/,'').replace(/\bIF NOT EXISTS\s*/gi,'').replace(/\s+/g,' ');
const rows=async db=>(await db.prepare(CATALOG).all()).results;
const json=(status,data)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const productEnv=db=>({CUSTOMER_DB:db,CUSTOMER_IDENTITY_ISSUER:ZITADEL_STAGING.issuer,IDENTITY_VERIFIER_QUALIFIED:'qualified_private_binding',IDENTITY_VERIFIER:{fetch:r=>handleIdentityBinding(r,{IDP_SESSION_DB:db,CUSTOMER_DB:db,CUSTOMER_IDP_STAGING_ADMITTED:'qualified_staging',CUSTOMER_IDP_BINDING_ADMITTED:'qualified_private_binding'})}});
async function api(db,raw,path,method='GET',body,extra={}){
 const r=await handle(new Request(ORIGIN+'/v1/customer/'+path,{method,headers:{cookie:'__Host-axiom_customer='+raw,...(method==='POST'?{origin:ORIGIN,'x-axiom-intent':'customer-action','content-type':'application/json'}:{}),...extra},body:body===undefined?undefined:JSON.stringify(body)}),productEnv(db));
 return {status:r.status,data:await r.json()};
}
async function catalogCheck(db,plan){
 const all=await rows(db),map=new Map(all.map(r=>[r.name,r]));
 assert(plan.objects.length===71&&plan.tables.length===20,'plan_invalid');
 for(let i=0;i<plan.objects.length;i++)assert(normalized(map.get(plan.objects[i])?.sql||'')===normalized(plan.statements[i]),'schema_definition_drift');
 const foreign=all.filter(r=>!plan.objects.includes(r.name)&&r.name!=='axiom_cq01_customer_schema_receipt'&&r.name!==MARKER);
 assert(await hash(canonical(foreign))===BASE,'foreign_catalog_drift');
 for(const r of foreign.filter(r=>r.type==='table'&&!['_cf_KV','_cf_METADATA'].includes(r.name))){assert(/^[A-Za-z0-9_]{1,128}$/.test(r.name),'foreign_name');assert((await db.prepare('SELECT count(*) AS n FROM "'+r.name+'"').first()).n===0,'foreign_rows_changed');}
 const receipt=await db.prepare('SELECT * FROM axiom_cq01_customer_schema_receipt').all();
 assert(receipt.results.length===1&&receipt.results[0].run_id==='axiom-customer-d1-20261106-01'&&receipt.results[0].plan_sha256===PLAN_HASH,'prior_receipt_drift');
 return hash(canonical(all));
}
export async function disable(db){await db.batch(DISABLE_SQL.map(s=>db.prepare(s)));assert((await db.prepare(DISABLED_SQL).first()).n===0,'fixture_deactivation_failed');return {fixture_authority_disabled:true,...LIMITS};}
async function start(db,env){
 const plan=globalThis.__AXIOM_CUSTOMER_PLAN;
 const before=await catalogCheck(db,plan);assert(!(await rows(db)).some(r=>r.name===MARKER),'qualification_already_attempted');
 for(const t of plan.tables)assert((await db.prepare('SELECT count(*) AS n FROM '+t).first()).n===0,'customer_data_present');
 assert(/^[A-Za-z0-9_-]{43}$/.test(env.FIXTURE_A||'')&&/^[A-Za-z0-9_-]{43}$/.test(env.FIXTURE_B||'')&&env.FIXTURE_A!==env.FIXTURE_B,'fixture_secret_missing');
 const now=Date.now(),items=[];
 for(const [tenant,identity,subject,raw,cid] of [[A,IA,SA,env.FIXTURE_A,'00000000-0000-4000-8000-0000000000a1'],[B,IB,SB,env.FIXTURE_B,'00000000-0000-4000-8000-0000000000b2']]){
  const flow=await hash(tenant+'-controlled-flow'),session=await hash(raw);
  items.push(db.prepare('INSERT INTO tenants(id,name) VALUES(?,?)').bind(tenant,'CONTROLLED QUALIFICATION FIXTURE - NOT CUSTOMER'),db.prepare('INSERT INTO identities(id,issuer,external_sub) VALUES(?,?,?)').bind(identity,ZITADEL_STAGING.issuer,subject),db.prepare("INSERT INTO memberships(tenant_id,identity_id,role) VALUES(?,?,'owner')").bind(tenant,identity),db.prepare("INSERT INTO canonical_customer_links(identity_id,tenant_id,customer_id,link_kind,proof_id,proof_sha256,consent_id,authority_subject) VALUES(?,?,?,'fresh',?,?,?,?)").bind(identity,tenant,cid,tenant+'-fixture-not-ownership-proof',await hash('controlled-fixture-not-proof'),tenant+'-fixture-consent','CONTROLLED_FIXTURE_NOT_PRODUCTION_ACCOUNT'),db.prepare('INSERT INTO customer_idp_flows_v1(state_hash,browser_hash,sealed_payload,created_at_ms,expires_at_ms) VALUES(?,?,?,?,?)').bind(flow,await hash(tenant+'-browser'),'CONTROLLED_FIXTURE_NOT_PROVIDER_CALLBACK',now-1000,now+240000),db.prepare("UPDATE customer_idp_flows_v1 SET status='processing',used_at_ms=? WHERE state_hash=?").bind(now-1,flow),db.prepare('INSERT INTO customer_idp_sessions_v1(session_hash,flow_hash,issuer,subject,auth_time_ms,created_at_ms,expires_at_ms) VALUES(?,?,?,?,?,?,?)').bind(session,flow,ZITADEL_STAGING.issuer,subject,now-1000,now,now+240000),db.prepare("UPDATE customer_idp_flows_v1 SET status='complete' WHERE state_hash=?").bind(flow),db.prepare('INSERT INTO credit_ledger(id,tenant_id,delta,source_key) VALUES(?,?,10,?)').bind(tenant+'-fixture-grant',tenant,'CONTROLLED_FIXTURE_NOT_PAYMENT'));
 }
 await db.batch([db.prepare('CREATE TABLE '+MARKER+'(run_id TEXT PRIMARY KEY,phase TEXT NOT NULL,baseline_sha256 TEXT NOT NULL,project_a TEXT,project_b TEXT,hold_id TEXT)'),db.prepare('INSERT INTO '+MARKER+"(run_id,phase,baseline_sha256) VALUES(?,'STARTED',?)").bind(RUN,before),...items]);
 const ma=await api(db,env.FIXTURE_A,'me'),mb=await api(db,env.FIXTURE_B,'me');
 assert(ma.status===200&&ma.data.tenant_id===A&&mb.status===200&&mb.data.tenant_id===B,'server_tenant_binding_failed');
 assert((await api(db,'z'.repeat(43),'me')).status===401,'forged_session_admitted');
 const pa=await api(db,env.FIXTURE_A,'projects','POST',{name:'Alpha fixture',objective:'Backend enforcement only',tenant_id:B}),pb=await api(db,env.FIXTURE_B,'projects','POST',{name:'Beta fixture',objective:'Backend enforcement only',tenant_id:A});
 assert(pa.status===201&&pb.status===201,'project_creation_failed');
 const aid=pa.data.project.id,bid=pb.data.project.id;
 for(const [raw,own,other] of [[env.FIXTURE_A,aid,bid],[env.FIXTURE_B,bid,aid]]){
  const list=await api(db,raw,'projects');assert(list.status===200&&list.data.projects.length===1&&list.data.projects[0].id===own,'tenant_project_leak');
  assert((await api(db,raw,'work?project='+other)).status===404,'tenant_read_admitted');
  assert((await api(db,raw,'work','POST',{project_id:other,title:'Forbidden',desired_outcome:'Forbidden'})).status===404,'tenant_write_admitted');
 }
 assert((await api(db,env.FIXTURE_A,'projects','POST',{name:'CSRF',objective:'deny'},{origin:'https://hostile.invalid'})).status===403,'csrf_admitted');
 assert((await api(db,env.FIXTURE_A,'orders','POST',{price_id:'fixture'})).status===503,'payment_authority_admitted');
 const race=await Promise.allSettled([reserve(db,A,RUN+'-reserve-one',7),reserve(db,A,RUN+'-reserve-two',7)]);
 const winners=race.filter(r=>r.status==='fulfilled');assert(winners.length===1,'concurrent_budget_exceeded');
 const loser=race.find(r=>r.status==='rejected');assert(loser?.reason?.message==='insufficient_credits_or_inactive_tenant','unexpected_reservation_failure');
 const hold=winners[0].value;assert((await reserve(db,A,hold.request_key,7)).id===hold.id,'reservation_replay_failed');
 let conflict=false;try{await reserve(db,A,hold.request_key,8);}catch(e){conflict=e.message==='reservation_key_conflict';}assert(conflict,'reservation_collision_admitted');
 assert((await balance(db,A)).available===3&&(await db.prepare("SELECT count(*) AS n FROM holds WHERE tenant_id=? AND state='open'").bind(A).first()).n===1,'budget_accounting_failed');
 let denied=false;try{await finishHold(db,B,hold.id,'released');}catch(e){denied=e.message==='hold_missing';}assert(denied&&(await balance(db,A)).available===3,'tenant_hold_leak');
 const same=await Promise.all([reserve(db,B,RUN+'-same-key',1),reserve(db,B,RUN+'-same-key',1)]);assert(same[0].id===same[1].id,'concurrent_reservation_replay_failed');await finishHold(db,B,same[0].id,'released');
 for(const [index,modes] of [['released','committed'],['committed','released'],['committed','committed'],['released','released']].entries()){
  const booked=(await balance(db,B)).booked,h=await reserve(db,B,RUN+'-finish-'+index,1);
  await Promise.allSettled(modes.map(mode=>finishHold(db,B,h.id,mode)));
  const state=(await db.prepare('SELECT state FROM holds WHERE id=? AND tenant_id=?').bind(h.id,B).first()).state;
  const charges=await db.prepare('SELECT delta FROM credit_ledger WHERE tenant_id=? AND source_key=?').bind(B,'usage:'+h.id).all();
  assert(['committed','released'].includes(state),'hold_not_finished');
  assert(charges.results.length===(state==='committed'?1:0)&&(await balance(db,B)).booked===booked-(state==='committed'?1:0),'hold_finalization_charged_loser');
 }
 await db.prepare('UPDATE '+MARKER+" SET phase='AWAITING_RESTART',project_a=?,project_b=?,hold_id=? WHERE run_id=?").bind(aid,bid,hold.id,RUN).run();
 return {run_id:RUN,controlled_fixture_backend_checks:true,tenant_isolation:true,concurrent_budget_guard:true,reservation_replay:true,hold_finalization_concurrency:true,scope:'controlled principals through actual product modules; not real IdP or ownership',...LIMITS};
}
async function verify(db,env){
 const receipt=await db.prepare('SELECT * FROM '+MARKER+' WHERE run_id=?').bind(RUN).first();assert(receipt?.phase==='AWAITING_RESTART','restart_phase_missing');
 await catalogCheck(db,globalThis.__AXIOM_CUSTOMER_PLAN);
 const a=await api(db,env.FIXTURE_A,'me'),b=await api(db,env.FIXTURE_B,'me');assert(a.status===200&&a.data.tenant_id===A&&a.data.credit.available===3&&b.status===200,'session_budget_not_durable');
 const projects=await api(db,env.FIXTURE_A,'projects');assert(projects.data.projects.length===1&&projects.data.projects[0].id===receipt.project_a,'project_not_durable');
 await finishHold(db,A,receipt.hold_id,'released');assert((await finishHold(db,A,receipt.hold_id,'released')).idempotent===true&&(await balance(db,A)).available===10,'release_replay_failed');
 const logout=await handleIdentityBrowser(new Request(ORIGIN+'/auth/logout',{method:'POST',headers:{origin:ORIGIN,cookie:'__Host-axiom_customer='+env.FIXTURE_A}}),{IDP_SESSION_DB:db,CUSTOMER_IDP_STAGING_ADMITTED:'qualified_staging'});
 assert(logout.status===303&&(await api(db,env.FIXTURE_A,'me')).status===401,'customer_logout_failed');
 await db.prepare("UPDATE memberships SET status='revoked' WHERE tenant_id=? AND identity_id=?").bind(B,IB).run();assert((await api(db,env.FIXTURE_B,'me')).status===401,'membership_revocation_failed');
 await disable(db);
 await db.prepare('UPDATE '+MARKER+" SET phase='PASS_DISABLED' WHERE run_id=?").bind(RUN).run();
 assert((await db.prepare('SELECT count(*) AS n FROM pragma_foreign_key_check').first()).n===0,'foreign_key_violation');
 return {run_id:RUN,epoch:env.EPOCH,session_budget_restart:true,customer_logout_revocation:true,membership_revocation:true,fixture_authority_disabled:true,scope:'conditional backend fixture acceptance only',...LIMITS};
}
export default {async fetch(req,env){
 try{
  if(req.headers.has('origin')||req.headers.has('cookie'))return json(403,{error:'browser_denied'});
  if(!/^[0-9a-f]{64}$/.test(env.TOKEN||'')||req.headers.get('authorization')!=='Bearer '+env.TOKEN)return json(401,{error:'unauthorized'});
  if(env.RUN!==RUN||!Number.isSafeInteger(Number(env.EXPIRES))||Date.now()>Number(env.EXPIRES))return json(403,{error:'expired'});
  const url=new URL(req.url);if(url.search)return json(404,{error:'not_found'});
  if(url.pathname==='/health'&&req.method==='GET')return json(200,{run_id:RUN,epoch:env.EPOCH,...LIMITS});
  if(url.pathname==='/qualify'&&req.method==='POST')return json(200,await start(env.DB,env));
  if(url.pathname==='/verify'&&req.method==='POST')return json(200,await verify(env.DB,env));
  if(url.pathname==='/disable'&&req.method==='POST')return json(200,await disable(env.DB));
  return json(404,{error:'not_found'});
 }catch(error){return json(503,{error:'qualification_failed_requires_cleanup',diagnostic:error.message,...LIMITS});}
}};
