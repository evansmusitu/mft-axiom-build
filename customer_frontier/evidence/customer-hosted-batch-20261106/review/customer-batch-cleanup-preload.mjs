import {writeFileSync} from 'node:fs';
const scenario=process.env.REVIEW_SCENARIO,base='https://api.cloudflare.com/client/v4/accounts/93f395f5121954671f92fffa453d6b61/workers/scripts/axiom-customer-d1-20261106-01';
let exists=scenario!=='absent',calls=[];
process.on('exit',()=>writeFileSync('cleanup-trace.json',JSON.stringify({scenario,exists,calls})));
globalThis.fetch=async(url,opts)=>{
 if(opts.redirect!=='error'||!(opts.signal instanceof AbortSignal)||opts.headers.Authorization!=='Bearer PRIVATE_CONTROL_TOKEN')throw Error('REVIEW_TRANSPORT_GUARD');
 if(![base,base+'/settings'].includes(url))throw Error('REVIEW_UNADMITTED_PATH');
 calls.push({path:url.slice(base.length),method:opts.method});
 const response=(result,status=200)=>new Response(JSON.stringify({success:status<300,result}),{status});
 if(url===base+'/settings'&&opts.method==='GET'){
  if(scenario==='denied')return response(null,403);
  if(scenario==='readback_not_absent'&&calls.length===3)exists=true;
  if(!exists)return response(null,404);
  return response({bindings:[{type:'d1',name:'DB',id:scenario==='wrong_db'?'504029cc-f9a5-495e-818f-63c6144b4ea4':'ccc473f1-fbb5-4b8d-8a24-45f3696ac10f'},{type:'plain_text',name:'RUN',text:scenario==='wrong_run'?'other':'axiom-customer-d1-20261106-01'},{type:'plain_text',name:'OWNERSHIP',text:scenario==='wrong_owner'?'foreign':'PRIVATE_OWNERSHIP_SENTINEL'}]});
 }
 if(url===base&&opts.method==='DELETE'){
  if(scenario==='delete_denied')return response(null,403);
  exists=false;if(scenario==='delete_lost')throw Error('PRIVATE_DELETE_UNCERTAINTY');return response({});
 }
 throw Error('REVIEW_UNADMITTED_MUTATION');
};
