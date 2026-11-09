import test from 'node:test';
import assert from 'node:assert/strict';
import {operatorReadOnlyPreflight} from './authority2-provider-readonly-check.mjs';

const key='AXIOM_AUTHORITY2_CLOUDFLARE_R2_READ_TOKEN',secret='SYNTHETIC_NEVER_LOG_THIS_SECRET';
const good={account_id:'67469478aa9349fa0a57fe3a72da200a',
  bucket_name:'musitu-axiom-authority2-worm',rule_id:'sensitive-provider-rule-label',
  scope:'b27/',retention:'Indefinite',admin_removable:true};
async function invoke({env={},verify=async()=>good,argv=['node','operator-script']}={}){
  const stdout=[],stderr=[];
  const status=await operatorReadOnlyPreflight({env:{[key]:secret,...env},
    argv,verify,output:s=>stdout.push(s),error:s=>stderr.push(s)});
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
