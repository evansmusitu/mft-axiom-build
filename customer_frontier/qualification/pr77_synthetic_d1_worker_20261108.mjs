// Exactly one owner-alternate D1, synthetic-only fixed SQL; no caller-supplied SQL.
const RUN='axiom-pr77-synthetic-20261108-01';
const EXPECTED_PLAN='6946e796539e6787033e20f1d0afdcb5259a130ca77be6e3c5afb60b5dc9888a';
const CATALOG_SQL="SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type IN ('table','index','trigger','view') AND name NOT GLOB 'sqlite_*' ORDER BY type,name";
const COUNTS_SQL='SELECT count(*) AS n FROM customers';
const FK_SQL='SELECT count(*) AS n FROM pragma_foreign_key_check';
const GUARD_SQL="SELECT count(*) AS n FROM sqlite_master WHERE name='oauth_identity_upgrade_v2_guard'";
const VERSION_SQL='SELECT count(*) AS n FROM oauth_identity_schema_versions';
const FAIL_TABLE='CREATE TABLE axiom_pr77_abort_probe(ok INTEGER NOT NULL CONSTRAINT axiom_pr77_expected_abort CHECK(ok=1))';
const FAIL_INSERT='INSERT INTO axiom_pr77_abort_probe VALUES(0)';
const check=(ok,code)=>{if(!ok)throw Error(code)};
const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});
const sha=async v=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)))].map(n=>n.toString(16).padStart(2,'0')).join('');
async function readCatalog(db){
 const r=await db.prepare(CATALOG_SQL).all();
 check(Array.isArray(r?.results),'CATALOG_UNAVAILABLE');
 return r.results.filter(x=>!['_cf_KV','_cf_METADATA'].includes(x.name));
}
async function observed(db){
 const rows=await readCatalog(db);
 const canonical=JSON.stringify(rows.map(x=>Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]]))));
 const customers=await db.prepare(COUNTS_SQL).first();
 const fk=await db.prepare(FK_SQL).first();
 const g=await db.prepare(GUARD_SQL).first();
 let v=0;
 try{v=Number((await db.prepare(VERSION_SQL).first()).n)}catch{v=0}
 return {schema_sha256:await sha(canonical),user_tables:rows.filter(x=>x.type==='table').length,indexes:rows.filter(x=>x.type==='index').length,triggers:rows.filter(x=>x.type==='trigger').length,customers:Number(customers.n),foreign_key_violations:Number(fk.n),guard_tables:Number(g.n),v2_version_rows:v};
}
export async function handle(req,env,fixed=globalThis.__AXIOM_PR77_SYNTHETIC__){
 if(req.headers.has('origin')||req.headers.has('cookie'))return reply(403,{error:'browser_or_cookie_denied',release_authority:false});
 const secret=env?.TOKEN,auth=req.headers.get('authorization');
 if(typeof secret!=='string'||secret.length!==64||auth!=='Bearer '+secret)return reply(401,{error:'unauthorized',release_authority:false});
 if(env.RUN!==RUN||!Number.isSafeInteger(Number(env.EXPIRES))||Date.now()>Number(env.EXPIRES))return reply(403,{error:'expired_or_wrong_run',release_authority:false});
 const path=new URL(req.url).pathname;
 if(!fixed||!Array.isArray(fixed.seed)||!Array.isArray(fixed.plan)||fixed.seed.length!==41||fixed.plan.length!==89||fixed.plan_sha256!==EXPECTED_PLAN)return reply(503,{error:'fixture_not_pinned',release_authority:false});
 try{
  if(req.method==='GET'&&path==='/health')return reply(200,{run_id:RUN,epoch:env.EPOCH,origin:'SYNTHETIC_ONLY',release_authority:false});
  if(req.method==='POST'&&path==='/seed'){
   const before=await readCatalog(env.DB);
   check(before.length===0,'TARGET_NOT_EMPTY');
   await env.DB.batch(fixed.seed.map(sql=>env.DB.prepare(sql)));
   return reply(200,{status:'SYNTHETIC_SEED_BATCH_ACCEPTED',statements:fixed.seed.length,origin:'SYNTHETIC_ONLY',release_authority:false});
  }
  if(req.method==='GET'&&path==='/observe')return reply(200,{status:'SYNTHETIC_OBSERVATION',...(await observed(env.DB)),release_authority:false});
  if(req.method==='POST'&&path==='/bounded-rollback'){
   let failureKind='none';
   try{
    await env.DB.batch([...fixed.plan.slice(0,46),FAIL_TABLE,FAIL_INSERT].map(sql=>env.DB.prepare(sql)));
   }catch(error){
    const msg=String(error?.message||'');
    failureKind=/CHECK constraint failed:\s*axiom_pr77_expected_abort\b/.test(msg)?'intended_constraint_abort':/too many|subrequest|query limit/i.test(msg)?'free_plan_query_limit':'other_d1_error';
   }
   return reply(200,{status:failureKind==='intended_constraint_abort'?'PR77_PREFIX_INTENTIONAL_CHECK_ABORT':'PR77_PREFIX_NOT_QUALIFIED',tested_actual_pr77_prefix_statements:46,total_batched_statements:48,failure_kind:failureKind,release_authority:false});
  }
  if(req.method==='POST'&&path==='/full-89'){
   try{
    const result=await env.DB.batch(fixed.plan.map(sql=>env.DB.prepare(sql)));
    check(Array.isArray(result)&&result.length===89,'D1_RESULTS_NOT_COMPLETE');
    return reply(200,{status:'FULL_89_SYNTHETIC_BATCH_ACCEPTED',statements:result.length,release_authority:false});
   }catch(error){
    const msg=String(error?.message||'');
    const kind=/too many|subrequest|query limit|resource limit|limit exceeded/i.test(msg)?'provider_query_limit':'other_d1_error';
    return reply(200,{status:'FULL_89_BATCH_NOT_QUALIFIED',failure_kind:kind,release_authority:false});
   }
  }
  return reply(404,{error:'route_denied',release_authority:false});
 }catch{return reply(503,{error:'unexpected_provider_or_synthetic_fixture_failure',release_authority:false});}
}
export default {fetch:(request,env)=>handle(request,env)};
