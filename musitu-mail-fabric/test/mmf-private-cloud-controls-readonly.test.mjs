import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {inspectMmfPrivateCloudControls} from '../src/staging/mmf-private-cloud-controls-readonly.mjs';
import {MMF_LEGACY_BINDING_BASELINE} from '../src/staging/mmf-shared-binding-drift-readonly.mjs';

const account='93f395f5121954671f92fffa453d6b61';
const token='SYNTHETIC_READ_ONLY_CLOUDFLARE_TOKEN_VALUE';
const base='https://api.cloudflare.com/client/v4/accounts/'+account+'/workers/scripts/';
const shared=Object.keys(MMF_LEGACY_BINDING_BASELINE);
const state={
 'mmf-commercial-private-sqlite-stage-20261012':{
   settings:{bindings:[
    ...['MMF_STAGE_ONLY','MMF_REAL_SEND_ENABLED','MMF_COMMERCE_ENABLED','MMF_CUSTOMER_API_ENABLED','MMF_MAIL_SENDING_ENABLED'].map(name=>({name,type:'plain_text',text:'false'})),
    {name:'MMF_COMMERCIAL_PRIVATE_STAGE',type:'durable_object_namespace',class_name:'MmfCommercialPrivateStageDO'}]},
   subdomain:{enabled:false,previews_enabled:false},secrets:[]},
 'mmf-paynow-isolated-deny-canary-20261012':{
   settings:{bindings:[{name:'MMF_PAYNOW_AUTHORITY',type:'service',service:shared[0]},{name:'MMF_PAYNOW_TRANSPORT',type:'service',service:shared[1]}]},
   subdomain:{enabled:false,previews_enabled:false}},
};
function fixture(mutator=()=>{}){
 const s=structuredClone(state);for(const name of shared)s[name]={settings:{bindings:[{name:'BINDING',type:'secret_text'}]}};
 const expected=Object.fromEntries(shared.map(name=>[name,{count:1,sha256:createHash('sha256').update(JSON.stringify([{name:'BINDING',type:'secret_text'}])).digest('hex')}]));
 mutator(s,expected);
 const calls=[];
 const fetchImpl=async (url,opts)=>{
  calls.push({url,method:opts.method,cache:opts.cache,redirect:opts.redirect,auth:opts.headers.authorization});
  const suffix=url.startsWith(base)?url.slice(base.length):null;
  const slash=suffix?.lastIndexOf('/');const name=suffix?.slice(0,slash),endpoint=suffix?.slice(slash+1);
  const entry=s[name]?.[endpoint];
  if(entry===undefined)return new Response(JSON.stringify({success:false,errors:[{message:'SECRET_PROVIDER_ERROR'}]}),{status:404,headers:{'content-type':'application/json'}});
  return new Response(JSON.stringify({success:true,result:entry}),{headers:{'content-type':'application/json'}});
 };
 return {fetchImpl,calls,expected};
}
test('GET-only inspection confirms private disabled MMF stage, deny canary and unchanged shared workers',async()=>{
 const x=fixture();
 const result=await inspectMmfPrivateCloudControls({accountId:account,token,fetchImpl:x.fetchImpl,sharedBaselines:x.expected});
 assert.equal(result.gate,'MMF_PRIVATE_GETONLY_CONTROL_BASELINE_MATCH');
 assert.equal(result.stageDisabled,true);assert.equal(result.canaryDisabled,true);
 assert.equal(result.sharedBindingsMatch,true);assert.equal(result.cloudflareMutationCount,0);
 assert.equal(result.productionReleaseAuthorized,false);assert.equal(result.publicRoutesIndependentlyInspected,false);
 assert.equal(result.cloudflareGetCount,9);
 assert.equal(x.calls.length,9);
 assert.ok(x.calls.every(c=>c.method==='GET'&&c.cache==='no-store'&&c.redirect==='error'&&c.auth==='Bearer '+token));
 assert.ok(!JSON.stringify(result).includes(token));
 assert.ok(!JSON.stringify(result).includes('BINDING'));
});
test('any stage commercial flag or private subdomain drift blocks the gate',async()=>{
 for(const edit of [s=>{s['mmf-commercial-private-sqlite-stage-20261012'].settings.bindings[1].text='true'},
  s=>{s['mmf-commercial-private-sqlite-stage-20261012'].subdomain.enabled=true},
  s=>{s['mmf-commercial-private-sqlite-stage-20261012'].secrets.push({name:'SHOULD_NEVER_EXIST'})},
  s=>{s['mmf-paynow-isolated-deny-canary-20261012'].settings.bindings[0].service='evil-worker'},
  s=>{s['mmf-paynow-isolated-deny-canary-20261012'].subdomain.previews_enabled=true},
  s=>{s[shared[1]].settings.bindings.push({name:'EXTRA',type:'secret_text'})}]){
  const x=fixture(edit);
  const result=await inspectMmfPrivateCloudControls({accountId:account,token,fetchImpl:x.fetchImpl,sharedBaselines:x.expected});
  assert.equal(result.gate,'MMF_PRIVATE_GETONLY_CONTROL_DRIFT_BLOCKED');
  assert.equal(result.productionReleaseAuthorized,false);
 }
});
test('provider failure, invalid token, forged account and unexpected API content fail closed',async()=>{
 const x=fixture();
 await assert.rejects(inspectMmfPrivateCloudControls({accountId:'different',token,fetchImpl:x.fetchImpl,sharedBaselines:x.expected}),/MMF_PRIVATE_GETONLY_CONTROL_DENIED/);
 await assert.rejects(inspectMmfPrivateCloudControls({accountId:account,token:'short',fetchImpl:x.fetchImpl,sharedBaselines:x.expected}),/MMF_PRIVATE_GETONLY_CONTROL_DENIED/);
 const failing=async()=>new Response('sensitive api failure',{status:403});
 await assert.rejects(inspectMmfPrivateCloudControls({accountId:account,token,fetchImpl:failing,sharedBaselines:x.expected}),e=>e.message==='MMF_PRIVATE_GETONLY_CONTROL_DENIED');
 assert.equal(x.calls.length,0);
});
