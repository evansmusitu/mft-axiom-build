import {writeFileSync}from'node:fs';import{DB,RUN,MARKER,CANCEL_SQL,DISABLE_SQL,DISABLED_SQL}from'../customer-hosted-acceptance-20261107/customer_frontier/qualification/customer_acceptance_contract.mjs';
const base='https://api.cloudflare.com/client/v4/accounts/93f395f5121954671f92fffa453d6b61',scenario=process.env.REVIEW_SCENARIO,owner=process.env.REVIEW_OWNER_SHA;const calls=[];let present=!['absent','cancel_lost'].includes(scenario),phase='SEEDED',rowMutations=0,exists=true,deleted=false;
const reply=(result,status=200)=>new Response(JSON.stringify({success:status<300,result}),{status});const rows=result=>reply([{success:true,meta:{changed_db:false,changes:0,rows_written:0},results:result}]);
process.on('exit',()=>writeFileSync('cleanup-trace.json',JSON.stringify({scenario,calls,present,phase,rowMutations,exists,deleted})));
globalThis.fetch=async(url,opts)=>{
 if(opts.redirect!=='error'||!(opts.signal instanceof AbortSignal)||opts.headers.authorization!=='Bearer PRIVATE_CONTROL_TOKEN')throw Error('REVIEW_TRANSPORT');
 if(!url.startsWith(base))throw Error('REVIEW_FOREIGN_ORIGIN');const path=url.slice(base.length);calls.push({path,method:opts.method});
 if(path==='/d1/database/'+DB+'/query'&&opts.method==='POST'){
  const body=JSON.parse(opts.body),sql=body.sql;if(Object.keys(body).some(k=>!['sql','params'].includes(k)))throw Error('REVIEW_BODY_FIELDS');
  if(scenario==='d1_denied')return reply(null,403);
  if(sql==="SELECT name FROM sqlite_master WHERE type='table' AND name='"+MARKER+"'")return rows(present?[{name:MARKER}]:[]);
  if(sql===CANCEL_SQL){if(body.params?.length!==1||body.params[0]!==owner)throw Error('REVIEW_CANCEL_BIND');if(scenario==='cancel_lost')throw Error('PRIVATE_CANCELLATION_UNCERTAINTY');present=true;phase='CANCELLED';return rows([]);}
  if(sql==='SELECT run_id,ownership_sha256,phase FROM '+MARKER){if(!present)return reply(null,400);return rows([{run_id:scenario==='wrong_run'?'foreign':RUN,ownership_sha256:scenario==='wrong_owner'?'f'.repeat(64):owner,phase}]);}
  if(DISABLE_SQL.includes(sql)){rowMutations++;if(scenario==='mutation_denied'&&rowMutations===2)return reply(null,403);return rows([]);}
  if(sql.startsWith('UPDATE '+MARKER+" SET phase=CASE WHEN phase='PASS_DISABLED'")){phase='DISABLED';return rows([]);}
  if(sql===DISABLED_SQL)return rows([{n:scenario==='still_active'?1:0}]);
  throw Error('REVIEW_UNADMITTED_SQL');
 }
 if(path==='/workers/scripts/'+RUN+'/settings'&&opts.method==='GET'){
  if(scenario==='foreign_worker')return reply({bindings:[{name:'OWNERSHIP',text:'foreign'}]});
  if(!exists)return reply(null,404);return reply({bindings:[{name:'DB',type:'d1',id:DB},{name:'RUN',type:'plain_text',text:RUN},{name:'OWNERSHIP',type:'plain_text',text:'PRIVATE_OWNERSHIP_SENTINEL'}]});
 }
 if(path==='/workers/scripts/'+RUN&&opts.method==='DELETE'){if(scenario==='worker_delete_denied')return reply(null,403);exists=false;deleted=true;return reply({});}
 throw Error('REVIEW_UNADMITTED_API');
};
