// Temporary fixed-plan qualifier. No caller SQL, provider or production binding.
const BASE='b2ee9c1eb6c0ed8c0cf8fc1c9d02e5b7ae713c0c2dd292f946bd7d737d764737';
const MARKER='axiom_cq01_customer_schema_receipt';
const RUN='axiom-customer-d1-20261106-01';
const SQL="SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type IN ('table','index','trigger','view') AND name NOT GLOB 'sqlite_*' ORDER BY type,name";
const hash=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(n=>n.toString(16).padStart(2,'0')).join('');
const canonical=rows=>JSON.stringify(rows.map(row=>Object.fromEntries(Object.keys(row).sort().map(k=>[k,row[k]])))).replace(/[\u0080-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
const catalog=async db=>(await db.prepare(SQL).all()).results;
const assert=(ok,code)=>{if(!ok)throw Error(code);};
async function foreignRows(db,rows){
 let n=0;for(const r of rows.filter(r=>r.type==='table'&&r.name!=='_cf_KV')){assert(/^[A-Za-z0-9_]{1,128}$/.test(r.name),'invalid_foreign_name');n+=Number((await db.prepare('SELECT count(*) AS n FROM "'+r.name+'"').first()).n);}return n;
}
export async function qualify(db,plan,planHash){
 const before=await catalog(db);assert(await hash(canonical(before))===BASE,'catalog_drift');assert(await foreignRows(db,before)===0,'foreign_data_changed');
 assert((await db.prepare('SELECT foreign_keys AS n FROM pragma_foreign_keys').first()).n===1,'foreign_keys_required');
 assert(plan.tables.length===20&&plan.statements.length<100&&plan.objects.length===plan.statements.length,'invalid_fixed_plan');
 let rolledBack=false;
 try{await db.batch([...plan.statements.map(s=>db.prepare(s)),db.prepare('CREATE TABLE axiom_cq01_forced_failure(ok INTEGER NOT NULL CONSTRAINT axiom_cq01_intended_failure CHECK(ok=1))'),db.prepare('INSERT INTO axiom_cq01_forced_failure VALUES(0)')]);}catch(error){rolledBack=[error?.message,error?.cause?.message].some(message=>typeof message==='string'&&/\bCHECK constraint failed:\s*axiom_cq01_intended_failure\b/.test(message));}
 assert(rolledBack,'intended_constraint_failure_not_observed');assert(await hash(canonical(await catalog(db)))===BASE,'ddl_rollback_failed');assert(await foreignRows(db,before)===0,'foreign_rows_changed');
 await db.batch([...plan.statements.map(s=>db.prepare(s)),db.prepare('CREATE TABLE '+MARKER+'(run_id TEXT PRIMARY KEY NOT NULL,plan_sha256 TEXT NOT NULL)'),db.prepare('INSERT INTO '+MARKER+' VALUES(?1,?2)').bind(RUN,planHash)]);
 const after=await catalog(db),byName=new Map(after.map(r=>[r.name,r]));
 for(const r of before)assert(JSON.stringify(byName.get(r.name))===JSON.stringify(r),'foreign_object_changed');
 assert(await foreignRows(db,before)===0,'foreign_data_changed');assert(plan.objects.every(n=>byName.has(n)),'schema_missing');
 assert((await db.prepare('SELECT count(*) AS n FROM pragma_foreign_key_check').first()).n===0,'foreign_key_check_failed');
 return {atomic_customer_ddl_rollback:true,customer_schema_applied:true,customer_tables:20,foreign_user_tables_preserved:3,foreign_user_rows:0,customer_rows_seeded:0,scope:'actual customer/IdP schema only; no production OAuth migration',hosted_restore_qualified:false,customer_acceptance_qualified:false,oauth_upgrade_qualified:false,release_authority:false};
}
function json(status,value){return new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});}
export default {async fetch(req,env){
 try{
  if(req.headers.has('origin')||req.headers.has('cookie'))return json(403,{error:'browser_denied'});
  if(!/^[0-9a-f]{64}$/.test(env.TOKEN||'')||req.headers.get('authorization')!=='Bearer '+env.TOKEN)return json(401,{error:'unauthorized'});
  if(env.RUN!==RUN||!Number.isSafeInteger(Number(env.EXPIRES))||Date.now()>Number(env.EXPIRES))return json(403,{error:'expired'});
  const path=new URL(req.url).pathname;
  if(path==='/health'&&req.method==='GET')return json(200,{run_id:RUN,epoch:env.EPOCH});
  const plan=globalThis.__AXIOM_CUSTOMER_PLAN;
  if(path==='/qualify'&&req.method==='POST')return json(200,await qualify(env.DB,plan,env.PLAN_HASH));
  if(path==='/verify'&&req.method==='GET'){
   const r=await env.DB.prepare('SELECT run_id,plan_sha256 FROM '+MARKER).all();
   assert(r.results.length===1&&r.results[0].run_id===RUN&&r.results[0].plan_sha256===env.PLAN_HASH,'receipt_mismatch');
   const rows=await catalog(env.DB);assert(plan.objects.every(n=>rows.some(r=>r.name===n)),'schema_missing');
   return json(200,{run_id:RUN,epoch:env.EPOCH,schema_survived_redeployment:true,customer_acceptance_qualified:false,release_authority:false});
  }
  return json(404,{error:'not_found'});
 }catch{return json(503,{error:'qualification_failed_outcome_requires_readback',release_authority:false});}
}};
