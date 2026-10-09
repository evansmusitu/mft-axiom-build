import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {validateWebhookEndpoint} from '../global_ops.js';
import {D1CaseStore} from '../d1_case_store.js';
import {deliverSupportWebhook,handleOperatorRequest} from '../worker.js';

test('native webhook endpoint validation is HTTPS-only and blocks local/private destinations',()=>{
  const good=validateWebhookEndpoint('https://hooks.example.com/musitu');
  assert.equal(good.ok,true);
  assert.equal(good.value,'https://hooks.example.com/musitu');

  for(const value of [
    'http://hooks.example.com/musitu',
    'https://localhost/hook',
    'https://api.localhost/hook',
    'https://127.0.0.1/hook',
    'https://10.0.0.1/hook',
    'https://100.64.0.1/hook',
    'https://169.254.169.254/latest',
    'https://172.16.1.1/hook',
    'https://172.31.255.254/hook',
    'https://192.168.1.1/hook',
    'https://224.0.0.1/hook',
    'https://[::1]/hook',
    'https://[fc00::1]/hook',
    'https://[fe80::1]/hook',
    'https://service.internal/hook',
    'https://service.local/hook',
    'https://user:pass@hooks.example.com/hook',
    'https://hooks.example.com:8443/hook'
  ]) assert.equal(validateWebhookEndpoint(value).ok,false,value);
});

test('schema stores native webhook delivery configuration only as encrypted payload',async()=>{
  const schema=await readFile(new URL('../schema.sql',import.meta.url),'utf8');
  assert.match(schema,/CREATE TABLE IF NOT EXISTS support_webhook_delivery_configs/);
  assert.match(schema,/config_encrypted TEXT NOT NULL/);
  const start=schema.indexOf('CREATE TABLE IF NOT EXISTS support_webhook_delivery_configs');
  const end=schema.indexOf('CREATE TABLE IF NOT EXISTS support_webhook_outbox',start);
  const slice=schema.slice(start,end);
  assert.doesNotMatch(slice,/endpoint_url\s+TEXT|signing_secret\s+TEXT/i);
});

test('D1 store exposes encrypted native webhook delivery configuration',()=>{
  assert.equal(typeof D1CaseStore.prototype.configureWebhookDelivery,'function');
});

test('native webhook sender HMAC-signs metadata payload without external provider',async()=>{
  const calls=[];
  const delivery={
    delivery_id:'AXW-0123456789ABCDEF',
    webhook_ref:'webhook:acme001',
    case_id:'AX-0123456789AB',
    event_type:'case.updated',
    payload:{
      schema:'musitu.axiom.support-webhook-event.v1',
      type:'case.updated',
      case_id:'AX-0123456789AB',
      state:'IN_PROGRESS',
      priority:'P1',
      event_hash:'a'.repeat(64),
      created_at:'2026-10-08T10:00:00.000Z'
    },
    delivery_config:{
      endpoint_url:'https://hooks.example.com/musitu',
      signing_secret:'0123456789abcdef0123456789abcdef'
    }
  };
  const result=await deliverSupportWebhook(delivery,{
    SUPPORT_WEBHOOK_FETCH:async(url,init)=>{
      calls.push({url,init});
      return new Response(null,{status:204,headers:{'x-request-id':'hook-receipt-1'}});
    },
    SUPPORT_WEBHOOK_NOW:()=>1760000000
  });
  assert.equal(result.delivered,true);
  assert.equal(result.status,204);
  assert.equal(result.receipt_id,'hook-receipt-1');
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'https://hooks.example.com/musitu');
  assert.equal(calls[0].init.method,'POST');
  assert.equal(calls[0].init.redirect,'error');
  assert.equal(calls[0].init.headers['content-type'],'application/json');
  assert.equal(calls[0].init.headers['x-musitu-timestamp'],'1760000000');
  assert.equal(calls[0].init.headers['x-musitu-delivery'],delivery.delivery_id);
  assert.equal(calls[0].init.headers['x-musitu-event'],'case.updated');
  assert.match(calls[0].init.headers['x-musitu-signature'],/^v1=[a-f0-9]{64}$/);
  assert.equal(calls[0].init.body,JSON.stringify(delivery.payload));
  assert.doesNotMatch(JSON.stringify(calls[0].init.headers),/0123456789abcdef/);
});

test('native webhook sender fails closed without delivery configuration',async()=>{
  let calls=0;
  const delivery={delivery_id:'AXW-0123456789ABCDEF',event_type:'case.updated',payload:{case_id:'AX-0123456789AB'}};
  const result=await deliverSupportWebhook(delivery,{SUPPORT_WEBHOOK_FETCH:async()=>{calls++;throw new Error('must not fetch');}});
  assert.equal(result.delivered,false);
  assert.equal(result.reason,'PROVIDER_UNAVAILABLE');
  assert.equal(calls,0);
});


test('authenticated operator can configure or rotate native webhook delivery without secret echo',async()=>{
  const calls=[];
  const store={
    async configureWebhookDelivery(ref,input,principal){
      calls.push({ref,input,principal});
      return {webhook_ref:ref,native_delivery_configured:true,updated_at:'2026-10-09T00:00:00.000Z'};
    }
  };
  const env={
    ENVIRONMENT:'test',
    SUPPORT_STORE:store,
    SUPPORT_OPERATOR_VERIFY:async()=>({actor_ref:'support_agent:owner',role:'support_agent'})
  };
  const response=await handleOperatorRequest(new Request(
    'https://ops.example/api/v1/operator/webhooks/webhook%3Aacme001/delivery',
    {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
      endpoint_url:'https://hooks.example.com/musitu',
      signing_secret:'0123456789abcdef0123456789abcdef'
    })}
  ),env);
  assert.equal(response.status,200);
  assert.equal(calls.length,1);
  assert.equal(calls[0].ref,'webhook:acme001');
  assert.equal(calls[0].principal.actor_ref,'support_agent:owner');
  const body=await response.json();
  assert.equal(body.native_delivery_configured,true);
  assert.equal(JSON.stringify(body).includes('0123456789abcdef'),false);
  assert.equal(JSON.stringify(body).includes('hooks.example.com'),false);
});
