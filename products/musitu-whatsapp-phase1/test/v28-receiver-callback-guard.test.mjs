import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {validateReceiverCallback,assertExpectedReceiverSubscription} from '../deployments/meta-ingress/scripts/receiver-callback-guard.mjs';
const old='https://musitu-whatsapp-meta-receiver-20261015-old1-evansmusitu.vercel.app/api/meta/webhook';
const target='https://musitu-whatsapp-meta-receiver-20261015-new1-evansmusitu.vercel.app/api/meta/webhook';
const subscription=(callback=old,fields=[{name:'messages',version:'v26.0'}])=>({object:'whatsapp_business_account',callback_url:callback,active:true,fields});

test('receiver replacement requires the explicitly expected active messages-only predecessor',()=>{
 assert.equal(assertExpectedReceiverSubscription({subscriptions:[subscription(),{object:'other'}],target,expectedPrevious:old}),true);
 assert.equal(assertExpectedReceiverSubscription({subscriptions:[subscription(target)],target,expectedPrevious:old}),false);
});

test('unexpected, absent, duplicate, inactive or expanded subscriptions cannot be overwritten',()=>{
 for(const subscriptions of [[],[subscription(old.replace('old1','other1'))],[subscription(),subscription()], [{...subscription(),active:false}], [subscription(old,['messages','calls'])], [subscription(old,['messages','messages'])]]){
  assert.throws(()=>assertExpectedReceiverSubscription({subscriptions,target,expectedPrevious:old}),/UNEXPECTED_EXISTING_APP_CALLBACK/);
 }
});

test('receiver destinations reject credentials, alternate projects, ports, queries and fragments',()=>{
 assert.equal(validateReceiverCallback(target),target);
 for(const value of [undefined,target.replace('https:','http:'),target.replace('20261015','20261016'),target.replace('https://','https://user:secret@'),target.replace('.app/', '.app:443/'),target+'?token=anything',target+'#fragment',target.replace('/api/meta/webhook','/other')]){
  assert.throws(()=>validateReceiverCallback(value),/ISOLATED_CALLBACK_REQUIRED/);
 }
});

test('configuration command without an explicit predecessor stops before provider access',()=>{
 const result=spawnSync(process.execPath,[new URL('../deployments/meta-ingress/scripts/configure-meta-app-webhook.mjs',import.meta.url).pathname,target],{env:{PATH:process.env.PATH,META_APP_SECRET:'a'.repeat(32),META_VERIFY_TOKEN:'b'.repeat(40)},encoding:'utf8',timeout:3000});
 assert.equal(result.status,1);assert.equal(result.stdout,'');assert.match(result.stderr,/ISOLATED_CALLBACK_REQUIRED/);
 assert.equal(result.stderr.includes('a'.repeat(32)),false);
});

test('compact replacement command rejects missing, extra or noncanonical deployment suffixes before transport',()=>{
 const script=new URL('../deployments/meta-ingress/scripts/build.mjs',import.meta.url).pathname;
 for(const args of [[],['new1'],['valid1','valid2','extra1'],['https://other.invalid','valid2'],['valid1','BAD/2']]){
  const result=spawnSync(process.execPath,[script,'--replace',...args],{env:{PATH:process.env.PATH},encoding:'utf8',timeout:3000});
  assert.equal(result.status,1);assert.equal(result.stdout,'');assert.match(result.stderr,/RECEIVER_DEPLOYMENT_IDS_REQUIRED/);
 }
});
