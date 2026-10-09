import assert from 'node:assert/strict';
import test from 'node:test';
import {deliverSupportNotification} from '../worker.js';
import {deliverResendOperatorAlert} from '../resend_notifier.js';
const item={notification_id:'AXN-0123456789ABCDEF',case_id:'AX-0123456789AB',kind:'SLA_ACK_BREACH',audience:'operator'};
const env={
  SUPPORT_RESEND_OPERATOR_READY:'true',
  SUPPORT_RESEND_API_KEY:'re_test_0123456789abcdefghijklmnopqrstuvwxyz',
  SUPPORT_RESEND_FROM:'support@mftintelligence.com',
  SUPPORT_RESEND_OPERATOR_TO:'tallyvans410@gmail.com',
  SUPPORT_OPERATOR_BINDINGS_JSON:JSON.stringify({'tallyvans410@gmail.com':{actor_ref:'support_agent:tally',role:'support_agent'}})
};

test('Resend alerts are opt-in metadata only and idempotent',async()=>{
  const calls=[];
  const result=await deliverSupportNotification(item,{...env,SUPPORT_RESEND_FETCH:async(url,opts)=>{
    calls.push({url,opts});
    return {status:201,json:async()=>({id:'99aabbcc-1122-3344-5566-778899aabbcc'})};
  }});
  assert.equal(result.delivered,true);
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'https://api.resend.com/emails');
  assert.equal(calls[0].opts.headers['Idempotency-Key'],'axiom-support-'+item.notification_id);
  const payload=JSON.parse(calls[0].opts.body);
  assert.deepEqual(payload.to,['tallyvans410@gmail.com']);
  assert.match(payload.text,/Case AX-0123456789AB/);
  assert.doesNotMatch(payload.text,/description|customer message|password|recovery code/i);
});

test('disabled and missing-key states never send',async()=>{
  let count=0;
  const call=async()=>{count++};
  const a=await deliverSupportNotification(item,{...env,SUPPORT_RESEND_OPERATOR_READY:'false',SUPPORT_RESEND_FETCH:call});
  const b=await deliverSupportNotification(item,{...env,SUPPORT_RESEND_API_KEY:'',SUPPORT_RESEND_FETCH:call});
  const c=await deliverSupportNotification(item,{...env,SUPPORT_RESEND_OPERATOR_TO:'unbound@example.com',SUPPORT_RESEND_FETCH:call});
  assert.equal(a.reason,'PROVIDER_UNAVAILABLE');assert.equal(b.reason,'PROVIDER_UNAVAILABLE');assert.equal(c.reason,'PROVIDER_UNAVAILABLE');assert.equal(count,0);
});

test('provider error is not false delivery',async()=>{
  const a=await deliverResendOperatorAlert(item,{...env,SUPPORT_RESEND_FETCH:async()=>({status:429,json:async()=>({message:'rate limited'})})});
  const b=await deliverResendOperatorAlert(item,{...env,SUPPORT_RESEND_FETCH:async()=>{throw new Error('hidden credential')}}); 
  assert.deepEqual(a,{delivered:false,reason:'DELIVERY_FAILED'});
  assert.deepEqual(b,{delivered:false,reason:'DELIVERY_FAILED'});
});

test('customer notifications cannot use operator Resend email',async()=>{
  let count=0;
  const result=await deliverSupportNotification({...item,audience:'customer'},{...env,SUPPORT_RESEND_FETCH:async()=>{count++}});
  assert.equal(result.delivered,false);assert.equal(count,0);
});
