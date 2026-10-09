import assert from 'node:assert/strict';
import test from 'node:test';
import {deliverSupportNotification} from '../worker.js';

const base={notification_id:'AXN-0123456789ABCDEF',case_id:'AX-0123456789AB',kind:'SLA_ACK_BREACH'};

test('operator notifications use restricted Cloudflare send_email binding with metadata-only content',async()=>{
  const sent=[];
  const result=await deliverSupportNotification({...base,audience:'operator'},{
    SUPPORT_OPS_EMAIL:{send:async message=>{sent.push(message);return {messageId:'msg-operator-1'};}},
    SUPPORT_OPS_FROM:'support@mftintelligence.com',
    SUPPORT_OPS_EMAIL_READY:'true'
  });
  assert.equal(result.delivered,true);
  assert.equal(result.receipt_id,'msg-operator-1');
  assert.equal(sent.length,1);
  const message=sent[0];
  assert.equal(message.to,null);
  assert.equal(message.from.email,'support@mftintelligence.com');
  assert.equal(message.from.name,'MUSITU Axiom Support');
  assert.match(message.subject,/SLA ACK BREACH/);
  assert.match(message.text,/AX-0123456789AB/);
  assert.match(message.text,/support-ops\.mftintelligence\.com/);
  assert.doesNotMatch(JSON.stringify(message),/description|summary|recovery|customer message|narrative/i);
});

test('customer notification never falls back to operator send_email destination',async()=>{
  let opsCalls=0;
  const unavailable=await deliverSupportNotification({...base,audience:'customer'},{
    SUPPORT_OPS_EMAIL:{send:async()=>{opsCalls++;return {messageId:'wrong'};}}
  });
  assert.equal(unavailable.delivered,false);
  assert.equal(unavailable.reason,'PROVIDER_UNAVAILABLE');
  assert.equal(opsCalls,0);

  let providerPayload=null;
  const delivered=await deliverSupportNotification({...base,audience:'customer'},{
    SUPPORT_OPS_EMAIL:{send:async()=>{throw new Error('must not be used');}},
    SUPPORT_NOTIFICATION_SEND:async payload=>{providerPayload=payload;return {id:'customer-provider-1'};}
  });
  assert.equal(delivered.delivered,true);
  assert.equal(delivered.receipt_id,'customer-provider-1');
  assert.equal(providerPayload.case_id,base.case_id);
  assert.equal(providerPayload.kind,base.kind);
});

test('operator send_email failure is reported as delivery failure, not silent success',async()=>{
  await assert.rejects(
    ()=>deliverSupportNotification({...base,audience:'operator'},{
      SUPPORT_OPS_EMAIL:{send:async()=>{throw new Error('simulated send failure');}}
    }),
    /simulated send failure/
  );
});


test('operator email binding remains fail-closed until sending domain readiness is explicitly enabled',async()=>{
  let calls=0;
  const result=await deliverSupportNotification({...base,audience:'operator'},{
    SUPPORT_OPS_EMAIL:{send:async()=>{calls++;return {messageId:'must-not-send'};}},
    SUPPORT_OPS_FROM:'support@mftintelligence.com',
    SUPPORT_OPS_EMAIL_READY:'false'
  });
  assert.equal(result.delivered,false);
  assert.equal(result.reason,'PROVIDER_UNAVAILABLE');
  assert.equal(calls,0);
});
