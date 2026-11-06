/** Read-only actual OAuth component discovery. Never applies a migration. */
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {encryptBackup,RECIPIENT_SHA} from '../recovery/export_existing_d1_backup.mjs';
const ACCOUNT='https://api.cloudflare.com/client/v4/accounts/93f395f5121954671f92fffa453d6b61';
export const DATABASE='504029cc-f9a5-495e-818f-63c6144b4ea4';
export const CATALOG="SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type IN ('table','index','trigger','view') AND name NOT GLOB 'sqlite_*' ORDER BY type,name";
export const CHECKS=`SELECT
 (SELECT count(*) FROM pragma_foreign_key_check) AS foreign_key_violations,
 (SELECT count(*) FROM customers WHERE id IS NULL OR id='' OR status IS NULL) AS invalid_customers,
 (SELECT count(*) FROM api_keys k WHERE k.id IS NULL OR k.id='' OR NOT EXISTS(SELECT 1 FROM customers c WHERE c.id=k.customer_id) OR (k.status='active' AND NOT EXISTS(SELECT 1 FROM customers c WHERE c.id=k.customer_id AND c.status='active'))) AS invalid_keys,
 (SELECT count(*) FROM oauth_authorization_codes a WHERE a.code_hash IS NULL OR NOT EXISTS(SELECT 1 FROM customers c WHERE c.id=a.customer_id)) AS invalid_codes,
 (SELECT count(*) FROM oauth_access_tokens a WHERE NOT EXISTS(SELECT 1 FROM api_keys k WHERE k.id=a.api_key_id AND k.customer_id=a.customer_id) OR NOT EXISTS(SELECT 1 FROM customers c WHERE c.id=a.customer_id) OR (a.revoked_at IS NULL AND (NOT EXISTS(SELECT 1 FROM customers c WHERE c.id=a.customer_id AND c.status='active') OR NOT EXISTS(SELECT 1 FROM api_keys k WHERE k.id=a.api_key_id AND k.status='active')))) AS invalid_access,
 (SELECT count(*) FROM oauth_refresh_tokens a WHERE NOT EXISTS(SELECT 1 FROM api_keys k WHERE k.id=a.api_key_id AND k.customer_id=a.customer_id) OR NOT EXISTS(SELECT 1 FROM customers c WHERE c.id=a.customer_id) OR (a.revoked_at IS NULL AND (NOT EXISTS(SELECT 1 FROM customers c WHERE c.id=a.customer_id AND c.status='active') OR NOT EXISTS(SELECT 1 FROM api_keys k WHERE k.id=a.api_key_id AND k.status='active')))) AS invalid_refresh`;
const sha=value=>createHash('sha256').update(value).digest('hex');
const required=['customers','api_keys','oauth_authorization_codes','oauth_access_tokens','oauth_refresh_tokens'];
const columns=['foreign_key_violations','invalid_customers','invalid_keys','invalid_codes','invalid_access','invalid_refresh'];
export async function observe({token,publicKey,sourceSha,fetcher=fetch}={}){
 const out={schema:'musitu.axiom.actual_oauth_preflight.v1',source_sha:sourceSha,database_id:DATABASE,status:'UNKNOWN',transport:[],catalog_observed:false,base_consistency_observed:false,queries:0,zero_write_queries:0,provider_query_mutations:null,required_tables_present:[],counts:null,target_admitted:false,migration_qualified:false,release_authority:false};
 const deadline=Date.now()+90000;let encrypted;
 const fail=code=>{throw Error(code);};
 try{
  if(!token||/[\r\n]/.test(token)||!/^[0-9a-f]{40}$/.test(sourceSha||'')||sha(publicKey||'')!==RECIPIENT_SHA)fail('INVALID_FIXED_INPUT');
  async function request(kind){
   if(Date.now()>=deadline||out.transport.length>=4)fail('REQUEST_BUDGET_EXCEEDED');
   const sql=kind==='catalog'?CATALOG:kind==='consistency'?CHECKS:null;
   const path=kind==='binding'?'/workers/scripts/musitu-axiom-oauth/settings':'/d1/database/'+DATABASE+(sql?'/query':'');
   if(!['binding','metadata','catalog','consistency'].includes(kind))fail('UNADMITTED_REQUEST');
   const trace={kind,http_status:null,provider_error_codes:[]};out.transport.push(trace);if(sql)out.queries++;
   const r=await fetcher(ACCOUNT+path,{method:sql?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(Math.min(20000,deadline-Date.now())),headers:{Authorization:'Bearer '+token,Accept:'application/json',...(sql?{'Content-Type':'application/json'}:{})},...(sql?{body:JSON.stringify({sql,params:[]})}:{})});trace.http_status=r.status;
   const reader=r.body?.getReader();if(!reader)fail('INVALID_RESPONSE_BODY');let size=0;const chunks=[];
   try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>2_000_000)fail('RESPONSE_TOO_LARGE');chunks.push(Buffer.from(part.value));}}finally{await reader.cancel().catch(()=>{});}
   const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   if(Array.isArray(data?.errors))trace.provider_error_codes=data.errors.filter(x=>x&&Number.isSafeInteger(x.code)&&x.code>=1000&&x.code<=2147483647).slice(0,20).map(x=>x.code);
   if(r.status!==200||data?.success!==true)fail('PROVIDER_REJECTED');
   if(!sql)return data.result;
   const rows=data.result;if(!Array.isArray(rows)||rows.length!==1||rows[0]?.success!==true)fail('INVALID_QUERY_ENVELOPE');
   const m=rows[0].meta;if(m?.changed_db!==false||m.changes!==0||m.rows_written!==0)fail('ZERO_WRITES_NOT_CONFIRMED');out.zero_write_queries++;
   if(!Array.isArray(rows[0].results))fail('INVALID_QUERY_ROWS');return rows[0].results;
  }
  const settings=await request('binding');const matches=settings?.bindings?.filter(b=>b?.type==='d1'&&b.name==='AXIOM_DB');
  if(!Array.isArray(matches)||matches.length!==1||matches[0].id!==DATABASE)fail('LIVE_OAUTH_BINDING_DRIFT');
  const metadata=await request('metadata');if(metadata?.uuid!==DATABASE||metadata.name!=='musitu-axiom-prod')fail('DATABASE_IDENTITY_DRIFT');
  const catalog=await request('catalog');
  if(catalog.length<1||catalog.length>2000||catalog.some(r=>!r||Object.keys(r).sort().join(',')!=='name,sql,tbl_name,type'||!['table','index','trigger','view'].includes(r.type)||typeof r.name!=='string'||typeof r.tbl_name!=='string'||!(typeof r.sql==='string'||r.sql===null&&r.type==='index')))fail('INVALID_CATALOG');
  if(new Set(catalog.map(r=>r.name)).size!==catalog.length)fail('DUPLICATE_CATALOG_OBJECT');
  const bytes=Buffer.from(JSON.stringify(catalog));out.catalog_observed=true;out.catalog_sha256=sha(bytes);out.catalog_objects=catalog.length;
  out.required_tables_present=required.filter(name=>catalog.some(r=>r.type==='table'&&r.name===name));
  encrypted=encryptBackup(bytes,publicKey,{schema:'musitu.axiom.private_oauth_catalog.v1',database_id:DATABASE,source_sha:sourceSha,catalog_bytes:bytes.length,catalog_sha256:sha(bytes),recipient_public_sha256:RECIPIENT_SHA});bytes.fill(0);
  out.encrypted_catalog_sha256=sha(encrypted);out.encrypted_catalog_bytes=encrypted.length;
  if(out.required_tables_present.length!==required.length)fail('REAL_OAUTH_PARENT_TABLES_MISSING');
  const checks=await request('consistency');if(checks.length!==1||!checks[0]||Object.keys(checks[0]).sort().join(',')!==[...columns].sort().join(',')||columns.some(k=>!Number.isSafeInteger(checks[0][k])||checks[0][k]<0))fail('INVALID_CONSISTENCY_COUNTERS');
  out.counts=checks[0];out.base_consistency_observed=true;out.status=columns.some(k=>checks[0][k]!==0)?'INCONSISTENT_BASE_ROWS_REJECTED':'BASE_CONSISTENCY_OBSERVED_NOT_MIGRATION';
 }catch(e){out.error=['INVALID_FIXED_INPUT','REQUEST_BUDGET_EXCEEDED','UNADMITTED_REQUEST','INVALID_RESPONSE_BODY','RESPONSE_TOO_LARGE','PROVIDER_REJECTED','INVALID_QUERY_ENVELOPE','ZERO_WRITES_NOT_CONFIRMED','INVALID_QUERY_ROWS','LIVE_OAUTH_BINDING_DRIFT','DATABASE_IDENTITY_DRIFT','INVALID_CATALOG','DUPLICATE_CATALOG_OBJECT','REAL_OAUTH_PARENT_TABLES_MISSING','INVALID_CONSISTENCY_COUNTERS'].includes(e.message)?e.message:'OBSERVATION_UNAVAILABLE';}
 if(out.queries===out.zero_write_queries)out.provider_query_mutations=0;
 out.limitations=['Base-row checks do not qualify identity-link consistency or unknown trigger bodies.','No backup, hosted rollback, actual D1 batch, target admission or migration is performed.'];
 return {out,encrypted};
}
async function main(){
 const {out,encrypted}=await observe({token:process.env.CLOUDFLARE_API_TOKEN,sourceSha:process.env.AXIOM_CHECKOUT_SHA,publicKey:await readFile(new URL('../recovery/recipient-20261106.pem',import.meta.url))});
 if(encrypted)await writeFile('actual-oauth-catalog.json.enc',encrypted,{mode:0o600,flag:'wx'});
 await writeFile('actual-oauth-preflight.json',JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify(out));
 if(out.status!=='BASE_CONSISTENCY_OBSERVED_NOT_MIGRATION')process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
