import {writeFileSync}from'node:fs';
const API='https://api.cloudflare.com/client/v4/accounts/93f395f5121954671f92fffa453d6b61',RUN='axiom-customer-acceptance-20261107-01',DB='ccc473f1-fbb5-4b8d-8a24-45f3696ac10f',HOST='https://'+RUN+'.fixture-account.workers.dev';
const scenario=process.env.REVIEW_SCENARIO;let exists=scenario==='existing_worker',bindings=[],puts=0,qualifies=0,disabled=false,seeded=false,deleted=false;const trace=[],deploys=[];
const timer=setTimeout;globalThis.setTimeout=(fn,ms,...args)=>timer(fn,ms<=750?0:ms,...args);
const value=name=>bindings.find(x=>x.name===name)?.text;
const settings=()=>({bindings:bindings.filter(x=>x.type!=='secret_text').map(x=>x.type==='d1'?{type:x.type,name:x.name,id:x.database_id}:x)});
const cf=(result,status=200)=>new Response(JSON.stringify({success:status<300,result}),{status});
const pub=(data,status=200)=>new Response(JSON.stringify(data),{status});
process.on('exit',()=>writeFileSync('driver-trace.json',JSON.stringify({scenario,trace,puts,qualifies,disabled,seeded,deleted,exists,deploys})));
globalThis.fetch=async(url,opts={})=>{
 if(opts.redirect!=='error'||!(opts.signal instanceof AbortSignal))throw Error('REVIEW_TRANSPORT_GUARD');const method=opts.method||'GET';
 if(url.startsWith(API)){
  if(opts.headers.authorization!=='Bearer PRIVATE_CONTROL_TOKEN')throw Error('REVIEW_CONTROL_AUTH');const path=url.slice(API.length);trace.push({surface:'control',method,path});
  if(path==='/d1/database/'+DB&&method==='GET')return cf({uuid:scenario==='metadata_drift'?'other':DB,name:'SYNTHETIC_DB_NAME'});
  if(path==='/workers/subdomain'&&method==='GET')return cf({subdomain:scenario==='bad_subdomain'?'foreign.example':'fixture-account'});
  if(path==='/workers/scripts/'+RUN+'/settings'&&method==='GET'){
   if(scenario==='foreign_cleanup'&&qualifies)return cf({bindings:[{name:'OWNERSHIP',type:'plain_text',text:'foreign'}]});
   if(scenario==='cleanup_readback_exists'&&deleted)return cf(settings());return exists?cf(settings()):cf(null,404);
  }
  if(path==='/workers/scripts/'+RUN&&method==='PUT'){
   puts++;const meta=JSON.parse(await opts.body.get('metadata').text());const b=meta.bindings;
   if(meta.main_module!=='customer_frontier/qualification/customer_backend_acceptance_worker.mjs'||meta.compatibility_date!=='2026-07-01'||b.filter(x=>x.type==='d1').length!==1||b.find(x=>x.type==='d1').database_id!==DB)throw Error('REVIEW_MODULE_TARGET');
   if(b.filter(x=>x.type==='secret_text').map(x=>x.name).sort().join(',')!=='FIXTURE_A,FIXTURE_B,TOKEN')throw Error('REVIEW_SECRET_NAMES');
   if(!/^[A-Za-z0-9_-]{43}$/.test(b.find(x=>x.name==='FIXTURE_A').text)||b.find(x=>x.name==='FIXTURE_A').text===b.find(x=>x.name==='FIXTURE_B').text)throw Error('REVIEW_FIXTURE_SECRET');
   const exp=Number(b.find(x=>x.name==='EXPIRES').text);if(exp<Date.now()||exp>Date.now()+181000)throw Error('REVIEW_EXPIRY');
   for(const [name,part]of opts.body){if(name==='metadata')continue;if(!name.startsWith('customer_frontier/')||name.includes('..')||!(await part.text()))throw Error('REVIEW_MODULE_PATH');}
   const snapshot=Object.fromEntries(b.filter(x=>x.text).map(x=>[x.name,x.text]));
   if(deploys.length){const old=deploys[0];if(old.OWNERSHIP!==snapshot.OWNERSHIP||old.FIXTURE_A!==snapshot.FIXTURE_A||old.FIXTURE_B!==snapshot.FIXTURE_B||old.TOKEN===snapshot.TOKEN||old.EPOCH===snapshot.EPOCH)throw Error('REVIEW_RESTART_CREDENTIALS');}
   deploys.push(snapshot);bindings=b;exists=true;
   if(scenario==='create_lost'&&puts===1)throw Error('PRIVATE_CREATE_UNCERTAINTY');
   if(scenario==='rotation_lost'&&puts===2)throw Error('PRIVATE_ROTATION_UNCERTAINTY');return cf({id:RUN});
  }
  if(path==='/workers/scripts/'+RUN+'/subdomain'&&method==='POST'){const b=JSON.parse(opts.body);if(b.enabled!==true||b.previews_enabled!==false)throw Error('REVIEW_ROUTE_CHANGE');return cf({});}
  if(path==='/workers/scripts/'+RUN&&method==='DELETE'){if(scenario==='delete_denied')return cf(null,403);exists=false;deleted=true;return cf({});}
  throw Error('REVIEW_UNADMITTED_CONTROL_CALL');
 }
 if(!url.startsWith(HOST)||opts.headers.authorization==='Bearer PRIVATE_CONTROL_TOKEN')throw Error('REVIEW_CREDENTIAL_OR_ORIGIN');const path=url.slice(HOST.length);trace.push({surface:'qualifier',method,path});
 const valid=opts.headers.authorization==='Bearer '+value('TOKEN');if(!valid&&scenario!=='old_token_valid')return pub({error:'unauthorized'},401);
 if(path==='/health'&&method==='GET')return pub({epoch:value('EPOCH')});
 if(path==='/disable'&&method==='POST'){if(scenario==='disable_denied')return pub({error:'failed'},503);disabled=true;return pub({fixture_authority_disabled:true});}
 if(path==='/qualify'&&method==='POST'){qualifies++;seeded=true;if(scenario==='seed_reply_lost')throw Error('PRIVATE_SEED_REPLY_LOST');if(scenario==='seed_503')return pub({error:'failed'},503);return pub({phase:'SEEDED'});}
 const phases={'/projects':'PROJECTS_DONE','/isolation':'ISOLATION_DONE','/budget':'BUDGET_DONE','/finish/0':'FINISH_DONE_0','/finish/1':'FINISH_DONE_1','/finish/2':'FINISH_DONE_2','/finish/3':'AWAITING_RESTART'};
 if(path in phases&&method==='POST'){if(scenario==='phase_lost'&&path==='/budget')throw Error('PRIVATE_PHASE_REPLY_LOST');return pub({phase:phases[path]});}
 if(path==='/verify'&&method==='POST')return pub({phase:'AWAITING_REVOCATION',epoch:value('EPOCH'),session_budget_restart:true},scenario==='verify_fail'?503:200);
 if(path==='/revoke'&&method==='POST'){disabled=true;return pub({phase:'PASS_DISABLED',fixture_authority_disabled:true});}
 throw Error('REVIEW_UNADMITTED_QUALIFIER_CALL');
};
