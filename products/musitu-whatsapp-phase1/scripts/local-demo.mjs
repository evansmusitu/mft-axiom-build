/** Runs a synthetic two-merchant, no-provider, no-charge Phase 1 journey. */
import {PrivateStageStore} from '../src/private-stage/store.mjs';
import {createPrivateWebhookServer} from '../src/private-stage/webhook-server.mjs';
import {createHmac} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const root=mkdtempSync(join(tmpdir(),'musitu-whatsapp-demo-'));
const key=Buffer.alloc(32,41); // explicitly synthetic test data
const db=new PrivateStageStore(join(root,'synthetic.sqlite'),{identityKey:key});
const secret='synthetic-meta-app-secret',token='synthetic-local-verification-token';
const server=createPrivateWebhookServer({store:db,appSecret:secret,verifyToken:token});
try {
  db.seedTenant({tenantId:'salon-1',legalName:'Example Salon One',ownerId:'owner-1',wabaId:'demo-waba-1',phoneNumberId:'demo-phone-1'});
  db.seedTenant({tenantId:'salon-2',legalName:'Example Salon Two',ownerId:'owner-2',wabaId:'demo-waba-2',phoneNumberId:'demo-phone-2'});
  db.putFaq('salon-1','owner-1','hours','What time do you open?','We open at 09:00.');
  db.putFaq('salon-2','owner-2','hours','What time do you open?','We open at 11:00.');
  db.addResource('salon-1','owner-1','stylist-1','Stylist One');
  const address=await server.start();
  const payload={object:'whatsapp_business_account',entry:[{id:'demo-waba-1',changes:[{field:'messages',value:{metadata:{phone_number_id:'demo-phone-1'},messages:[{id:'wamid.synthetic.001',from:'263771111111',type:'text',text:{body:'What time do you open?'}}]}}]}]};
  const body=Buffer.from(JSON.stringify(payload));
  const signature='sha256='+createHmac('sha256',secret).update(body).digest('hex');
  const response=await fetch(`${address}/webhook`,{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':signature},body});
  if(!response.ok)throw new Error(`private webhook refused: ${response.status}`);
  const webhook=await response.json();
  const approvedAnswer=db.answerFaq('salon-1','What time do you open?');
  const booking=db.reserveBooking({tenantId:'salon-1',actorId:'owner-1',resourceId:'stylist-1',startAt:'2026-10-15T10:00:00.000Z',endAt:'2026-10-15T10:30:00.000Z',effectKey:'demo-booking-1'});
  const salonOne=db.snapshot('salon-1','owner-1'),salonTwo=db.snapshot('salon-2','owner-2');
  console.log(JSON.stringify({simulation:'PRIVATE_LOCAL_ONLY',externalMessagesSent:0,amountCharged:0,providerQualification:'NOT_ESTABLISHED',webhook,approvedAnswer,bookingStatus:booking.status,tenant1:salonOne,tenant2:salonTwo},null,2));
} finally {
  await server.stop().catch(()=>{}); db.close();rmSync(root,{recursive:true,force:true});
}
