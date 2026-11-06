import {writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const scenario=process.env.REVIEW_SCENARIO;
const API='https://api.cloudflare.com/client/v4/accounts/93f395f5121954671f92fffa453d6b61';
const RUN='axiom-customer-d1-20261106-01',DB='ccc473f1-fbb5-4b8d-8a24-45f3696ac10f';
const host='https://'+RUN+'.fixture-account.workers.dev';
const trace=[];let exists=scenario==='existing_worker',bindings=[],putCount=0,qualifyCount=0,applied=false,deleted=false;
const originalTimeout=globalThis.setTimeout;globalThis.setTimeout=(fn,ms,...args)=>originalTimeout(fn,ms<=750?0:ms,...args);
const response=(result,status=200)=>new Response(JSON.stringify({success:status>=200&&status<300,result}),{status});
const settings=()=>({bindings:bindings.filter(v=>v.type!=='secret_text').map(v=>v.type==='d1'?{type:'d1',name:v.name,id:v.database_id}:v)});
const textBinding=name=>bindings.find(b=>b.name===name)?.text;
process.on('exit',()=>writeFileSync('driver-trace.json',JSON.stringify({scenario,trace,putCount,qualifyCount,applied,exists,deleted},null,2)));
globalThis.fetch=async(url,opts={})=>{
 const method=opts.method||'GET';if(opts.redirect!=='error'||!(opts.signal instanceof AbortSignal))throw Error('REVIEW_BOUNDARY_ERROR');
 if(url.startsWith(API)){
  if(opts.headers.Authorization!=='Bearer PRIVATE_CONTROL_TOKEN')throw Error('REVIEW_CONTROL_TOKEN_ERROR');
  const path=url.slice(API.length);trace.push({surface:'control',path,method});
  if(path==='/d1/database/'+DB&&method==='GET')return response({uuid:scenario==='metadata_drift'?'another':DB,name:'SYNTHETIC_DB_NAME'});
  if(path==='/workers/subdomain'&&method==='GET')return response({subdomain:scenario==='invalid_subdomain'?'evil.example/path':'fixture-account'});
  if(path==='/workers/scripts/'+RUN+'/settings'&&method==='GET'){
   if(scenario==='cleanup_disappeared'&&qualifyCount){exists=false;return response(null,404);}
   if(scenario==='cleanup_foreign_replaced'&&qualifyCount){exists=true;return response({bindings:[{type:'plain_text',name:'OWNERSHIP',text:'foreign'}]});}
   if(scenario==='cleanup_readback_still_exists'&&deleted)return response(settings());
   return exists?response(settings()):response(null,404);
  }
  if(path==='/workers/scripts/'+RUN&&method==='PUT'){
   putCount++;if(!(opts.body instanceof FormData))throw Error('REVIEW_MULTIPART_REQUIRED');
   const meta=JSON.parse(await opts.body.get('metadata').text());
   if(meta.main_module!=='worker.mjs'||meta.compatibility_date!=='2026-07-01'||meta.bindings.filter(x=>x.type==='d1').length!==1||meta.bindings.find(x=>x.type==='d1').database_id!==DB)throw Error('REVIEW_BINDING_ERROR');
   const code=await opts.body.get('worker.mjs').text();if(!code.startsWith('globalThis.__AXIOM_CUSTOMER_PLAN=')||!code.includes('axiom_cq01_customer_schema_receipt'))throw Error('REVIEW_WORKER_SOURCE_ERROR');
   bindings=meta.bindings;exists=true;
   if(scenario==='create_uncertain_owned'&&putCount===1)throw Error('PRIVATE_UNCERTAIN_CREATE');
   if(scenario==='create_uncertain_foreign'&&putCount===1){bindings=[{name:'OWNERSHIP',type:'plain_text',text:'foreign'}];throw Error('PRIVATE_UNCERTAIN_CREATE');}
   if(scenario==='rotation_lost'&&putCount===2)throw Error('PRIVATE_UNCERTAIN_ROTATION');
   return response({id:RUN});
  }
  if(path==='/workers/scripts/'+RUN+'/subdomain'&&method==='POST'){
   const body=JSON.parse(opts.body);if(body.enabled!==true||body.previews_enabled!==false)throw Error('REVIEW_SUBDOMAIN_ERROR');return response({enabled:true});
  }
  if(path==='/workers/scripts/'+RUN&&method==='DELETE'){
   if(scenario==='cleanup_delete_rejected')return response(null,403);exists=false;deleted=true;return response({});
  }
  throw Error('REVIEW_UNADMITTED_CONTROL_PATH');
 }
 if(!url.startsWith(host))throw Error('REVIEW_FOREIGN_URL');
 if(opts.headers.Authorization==='Bearer PRIVATE_CONTROL_TOKEN')throw Error('REVIEW_CONTROL_CREDENTIAL_LEAK');
 const path=url.slice(host.length);trace.push({surface:'qualifier',path,method});
 const valid=opts.headers.Authorization==='Bearer '+textBinding('TOKEN');
 if(!valid&&scenario!=='old_token_still_valid')return new Response(JSON.stringify({error:'unauthorized'}),{status:401});
 if(path==='/health'&&method==='GET')return new Response(JSON.stringify({epoch:scenario==='health_never_ready'?'stale':textBinding('EPOCH'),run_id:RUN}));
 if(path==='/qualify'&&method==='POST'){
  qualifyCount++;applied=true;if(scenario==='qualify_lost_after_apply')throw Error('PRIVATE_LOST_AFTER_COMMIT');
  if(scenario==='qualify_503')return new Response(JSON.stringify({error:'qualification_failed_outcome_requires_readback'}),{status:503});
  return new Response(JSON.stringify({atomic_customer_ddl_rollback:true,customer_schema_applied:true,customer_tables:20,foreign_user_tables_preserved:3,foreign_user_rows:0,customer_rows_seeded:0,hosted_restore_qualified:false,customer_acceptance_qualified:false,oauth_upgrade_qualified:false,release_authority:false}));
 }
 if(path==='/verify'&&method==='GET')return new Response(JSON.stringify({epoch:textBinding('EPOCH'),schema_survived_redeployment:scenario!=='verify_fails'}),{status:scenario==='verify_fails'?503:200});
 throw Error('REVIEW_UNADMITTED_QUALIFIER_PATH');
};
