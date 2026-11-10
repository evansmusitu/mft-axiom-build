import test from 'node:test';
import assert from 'node:assert/strict';
import {operatorReadOnlyPreflight} from './authority2-provider-readonly-check.mjs';

const key='AXIOM_AUTHORITY2_CLOUDFLARE_R2_READ_TOKEN',secret='SYNTHETIC_NEVER_LOG_THIS_SECRET';
const good={account_id:'67469478aa9349fa0a57fe3a72da200a',
  bucket_name:'musitu-axiom-authority2-worm',rule_id:'sensitive-provider-rule-label',
  scope:'b27/',retention:'Indefinite',admin_removable:true};
const goodWorker={status:'WORKER_METADATA_READBACK_NOT_RELEASE',
  account_id:good.account_id,script_name:'axiom-security-authority2-highwater',
  bucket_name:good.bucket_name,checked_binding_count:5,secret_values_exposed:false,
  active_deployment_verified:false,signer_custody_verified:false,release_eligible:false};
const goodDeployment={status:'ACTIVE_DEPLOYMENT_METADATA_NOT_SOURCE_ATTESTATION',
 account_id:good.account_id,script_name:goodWorker.script_name,
 active_version_id_sha256:'a'.repeat(64),deployment_id_sha256:'b'.repeat(64),
 active_deployment_metadata_observed:true,
 active_deployment_source_qualified:false,release_eligible:false};
async function invoke({env={},verify=async()=>good,verifyWorker=async()=>goodWorker,
 verifyDeployment=async()=>goodDeployment,
  argv=['node','operator-script']}={}){
  const stdout=[],stderr=[];
  const status=await operatorReadOnlyPreflight({env:{[key]:secret,...env},
    argv,verify,verifyWorker,verifyDeployment,output:s=>stdout.push(s),error:s=>stderr.push(s)});
  return {status,stdout,stderr};
}
test('operator-only policy proof emits only redacted nonrelease evidence',async()=>{
  const r=await invoke();
  assert.equal(r.status,0);
  const obj=JSON.parse(r.stdout[0]);
  assert.equal(obj.status,'PROVIDER_POLICY_READBACK_ONLY_NOT_RELEASE');
  assert.equal(obj.release_eligible,false);
  assert.equal(obj.independently_verified,false);
  assert.equal(obj.credential_exposed,false);
  assert.equal(obj.rule_id_sha256.length,64);
  assert.doesNotMatch(JSON.stringify(r),/SYNTHETIC_NEVER_LOG_THIS_SECRET|sensitive-provider-rule-label/);
});
test('operator token missing denies before provider contact',async()=>{
 let calls=0;
 const r=await invoke({env:{[key]:''},verify:async()=>{calls++;return good;}});
 assert.equal(r.status,2);assert.equal(calls,0);
 assert.deepEqual(r.stderr,['AUTHORITY2_READ_ONLY_CREDENTIAL_MISSING_HOLD']);
});
test('builder or GitHub Actions environment denies provider contact even with token',async()=>{
 for(const key of ['CI','GITHUB_ACTIONS','AXIOM_BUILDER_RUNTIME']){
  let calls=0;
  const r=await invoke({env:{[key]:'true'},verify:async()=>{calls++;return good;}});
  assert.equal(r.status,2);assert.equal(calls,0);
  assert.deepEqual(r.stderr,['AUTHORITY2_OPERATOR_ENVIRONMENT_REQUIRED_HOLD']);
 }
});
test('credential CLI arguments forbidden',async()=>{
 let calls=0;
 const r=await invoke({argv:['node','script','--token',secret],verify:async()=>{calls++;return good;}});
 assert.equal(r.status,2);assert.equal(calls,0);
 assert.deepEqual(r.stderr,['AUTHORITY2_NO_CREDENTIAL_ARGUMENTS_ALLOWED_HOLD']);
});
test('provider errors never echo sensitive response text, token or stack',async()=>{
 const r=await invoke({verify:async()=>{throw Error('secret='+secret+' wrong account')}});
 assert.equal(r.status,2);
 assert.deepEqual(r.stderr,['PROVIDER_POLICY_VERIFICATION_UNAVAILABLE_HOLD']);
 assert.doesNotMatch(JSON.stringify(r),/SYNTHETIC_NEVER_LOG_THIS_SECRET/);
});
test('synthetic provider evidence cannot claim independent custody or suppress block',async()=>{
 for(const bad of [{...good,admin_removable:false},{...good,retention:'Age'},
    {...good,account_id:'a'.repeat(32)},{...good,bucket_name:'other'}]){
  const r=await invoke({verify:async()=>bad});
  assert.equal(r.status,2);
  assert.deepEqual(r.stderr,['AUTHORITY2_POLICY_EVIDENCE_INCONSISTENT_HOLD']);
 }
});

test('B27 operator readback includes pinned Worker binding proof before returning evidence',async()=>{
 const r=await invoke();
 assert.equal(r.status,0);
 const record=JSON.parse(r.stdout[0]);
 assert.equal(record.worker_script_name,'axiom-security-authority2-highwater');
 assert.equal(record.worker_binding_count,5);
 assert.equal(record.active_deployment_verified,false);
 assert.equal(record.signer_custody_verified,false);
 assert.equal(record.release_eligible,false);
});


test('B27 operator must reject substituted Worker metadata before emitting evidence',async()=>{
 for(const bad of [
   {...goodWorker,script_name:'untrusted-worker'},
   {...goodWorker,account_id:'f'.repeat(32)},
   {...goodWorker,bucket_name:'other'},
   {...goodWorker,checked_binding_count:4},
   {...goodWorker,active_deployment_verified:true},
   {...goodWorker,release_eligible:true}
 ]){
   const r=await invoke({verifyWorker:async()=>bad});
   assert.equal(r.status,2);
   assert.deepEqual(r.stdout,[]);
   assert.deepEqual(r.stderr,['AUTHORITY2_WORKER_EVIDENCE_INCONSISTENT_HOLD']);
 }
});
test('B27 operator cannot leak Worker-provider errors or invoke Workers in builder CI',async()=>{
 const fail=await invoke({verifyWorker:async()=>{throw Error('Bearer '+secret)}});
 assert.equal(fail.status,2);
 assert.deepEqual(fail.stdout,[]);
 assert.doesNotMatch(JSON.stringify(fail),/SYNTHETIC_NEVER_LOG_THIS_SECRET/);
 let calls=0;
 const noCall=await invoke({env:{GITHUB_ACTIONS:'true'},verifyWorker:async()=>{calls++;return goodWorker;}});
 assert.equal(noCall.status,2);
 assert.equal(calls,0);
});


test('B27 operator must check currently active deployment before producing evidence',async()=>{
 const r=await invoke();
 assert.equal(r.status,0);
 const record=JSON.parse(r.stdout[0]);
 assert.equal(record.active_deployment_metadata_observed,true);
 assert.equal(record.active_version_id_sha256,'a'.repeat(64));
 assert.equal(record.active_deployment_source_qualified,false);
 assert.equal(record.release_eligible,false);
});
