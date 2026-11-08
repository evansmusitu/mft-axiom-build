/** Fixed-source 2026-11-08 synthetic D1 rollback probe.
 * Only a deliberately failing atomic batch using a NEW synthetic table.
 * Zero customer row read, no production OAuth, no successful DDL migration.
 */
export const DB_ID='ccc473f1-fbb5-4b8d-8a24-45f3696ac10f';
export const CATALOG_SHA='e0a8f47429b1479d7dd2037633e8ca309645fb65fe345335801fc8653b49b7a1';
export const RUN='axiom-ccc-rollback-20261108-01';
export const PROBE='axiom_ccc_rollback_20261108_01';
export const CHECK='axiom_ccc_rollback_20261108_expected_check';
export const SQL="SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type IN ('table','index','trigger','view') AND name NOT GLOB 'sqlite_*' ORDER BY type,name";
const hash=async v=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)))).map(x=>x.toString(16).padStart(2,'0')).join('');
export const canonical=rows=>JSON.stringify(rows.map(row=>Object.fromEntries(Object.keys(row).sort().map(k=>[k,row[k]])))).replace(/[\u0080-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
const invariant=(ok,code)=>{if(!ok)throw Error(code);};
async function catalog(db){
 const r=await db.prepare(SQL).all();
 invariant(r&&r.success!==false&&Array.isArray(r.results)&&r.results.length===78,'current_catalog_unavailable');
 return r.results;
}
export async function qualify(db){
 const before=await catalog(db);
 invariant(await hash(canonical(before))===CATALOG_SHA,'current_catalog_drift');
 invariant(!before.some(x=>x.name===PROBE||x.tbl_name===PROBE),'probe_name_already_present');
 const foreignKeys=await db.prepare('SELECT foreign_keys AS n FROM pragma_foreign_keys').first();
 invariant(Number(foreignKeys?.n)===1,'foreign_keys_not_enabled');
 let intendedFailure=false;
 try{
  await db.batch([
   db.prepare('CREATE TABLE '+PROBE+' (id INTEGER PRIMARY KEY, val INTEGER NOT NULL CONSTRAINT '+CHECK+' CHECK(val=1))'),
   db.prepare('INSERT INTO '+PROBE+'(id,val) VALUES(1,1)'),
   db.prepare('INSERT INTO '+PROBE+'(id,val) VALUES(2,0)')
  ]);
 }catch(error){
  intendedFailure=[error?.message,error?.cause?.message].some(msg=>typeof msg==='string'&&new RegExp('\\bCHECK constraint failed:\\s*'+CHECK+'\\b').test(msg));
 }
 invariant(intendedFailure,'intentional_constraint_failure_not_observed');
 const after=await catalog(db);
 invariant(await hash(canonical(after))===CATALOG_SHA,'database_catalog_changed_after_batch');
 invariant(!after.some(x=>x.name===PROBE||x.tbl_name===PROBE),'synthetic_table_persisted');
 const foreignRows=await db.prepare('SELECT count(*) AS n FROM pragma_foreign_key_check').first();
 invariant(Number(foreignRows?.n)===0,'foreign_keys_invalid_after_batch');
 return {schema:'musitu.axiom.ccc_hosted_synthetic_rollback.v1',run_id:RUN,rolled_back:true,
  schema_catalog_sha256:CATALOG_SHA,catalog_objects:78,foreign_keys_check_passed:true,
  customer_rows_read:0,production_oauth_changed:false,hosted_full_restore_qualified:false,
  release_authority:false};
}
const json=(status,value)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
export default {async fetch(req,env){
 try{
  if(req.headers.has('origin')||req.headers.has('cookie'))return json(403,{error:'browser_denied'});
  if(!/^[0-9a-f]{64}$/.test(env.TOKEN||'')||req.headers.get('authorization')!=='Bearer '+env.TOKEN)return json(401,{error:'unauthorized'});
  if(env.RUN!==RUN||!Number.isSafeInteger(Number(env.EXPIRES))||Date.now()>Number(env.EXPIRES))return json(403,{error:'expired'});
  const path=new URL(req.url).pathname;
  if(req.method==='GET'&&path==='/health')return json(200,{run_id:RUN,epoch:env.EPOCH});
  if(req.method==='POST'&&path==='/qualify')return json(200,await qualify(env.DB));
  return json(404,{error:'not_found'});
 }catch{return json(409,{error:'synthetic_rollback_not_verified'});}
}};
