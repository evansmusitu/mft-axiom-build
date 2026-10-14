/** Offline signed-inbound → draft → JWT read-only dashboard demo. No egress. */
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHmac,generateKeyPairSync,sign as signRsa} from 'node:crypto';
import {PrivateStageStore} from '../src/private-stage/store.mjs';
import {createPrivateWebhookServer} from '../src/private-stage/webhook-server.mjs';
import {createPrivateAdminServer} from '../src/private-stage/admin-server.mjs';

const dir=mkdtempSync(join(tmpdir(),'musitu-private-demo-'));
const store=new PrivateStageStore(join(dir,'stage.sqlite'),{identityKey:Buffer.alloc(32,13)});
const SECRET='not-a-provider-app-secret';
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),alg:'RS256',use:'sig',kid:'stage-ephemeral'};
const issuer='https://local.example.invalid/stage-issuer',audience='stage-musitu';
const b64=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const signWebhook=value=>{const rawBody=Buffer.from(JSON.stringify(value));return {rawBody,signature:'sha256='+createHmac('sha256',SECRET).update(rawBody).digest('hex')};};
function accessToken(){
  const now=Math.floor(Date.now()/1000);
  const content=b64({typ:'JWT',alg:'RS256',kid:'stage-ephemeral'})+'.'+b64({iss:issuer,aud:audience,sub:'owner-A',iat:now-1,nbf:now-1,exp:now+60});
  return content+'.'+signRsa('RSA-SHA256',Buffer.from(content),privateKey).toString('base64url');
}
let webhook,admin;
try{
  for(const x of ['A','B'])store.seedTenant({tenantId:'tenant-'+x,legalName:'Demo '+x,ownerId:'owner-'+x,wabaId:'WABA_'+x,phoneNumberId:'PHONE_'+x});
  store.putFaq('tenant-A','owner-A','opening','When are you open?','9am–6pm');
  store.putFaq('tenant-B','owner-B','opening','When are you open?','10am–7pm');
  webhook=createPrivateWebhookServer({store,appSecret:SECRET,verifyToken:'private-only',offlineFaqActorByTenant:{'tenant-A':'owner-A','tenant-B':'owner-B'}});
  admin=createPrivateAdminServer({store,identityConfig:{issuer,audience,jwks:{keys:[jwk]},maxTokenAgeSeconds:300}});
  const [webhookUrl,adminUrl]=await Promise.all([webhook.start(),admin.start()]);
  const value={object:'whatsapp_business_account',entry:[{id:'WABA_A',changes:[{field:'messages',value:{metadata:{phone_number_id:'PHONE_A'},messages:[{id:'wamid.synthetic.1',from:'263771111111',type:'text',text:{body:'When are you open?'}}]}}]}]};
  const signed=signWebhook(value);
  const response=await fetch(webhookUrl+'/webhook',{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':signed.signature},body:signed.rawBody});
  const receipt=await response.json();
  const headers={authorization:'Bearer '+accessToken()};
  const own=await fetch(adminUrl+'/v1/tenants/tenant-A/metrics',{headers});
  const drafts=await fetch(adminUrl+'/v1/tenants/tenant-A/drafts',{headers});
  const cross=await fetch(adminUrl+'/v1/tenants/tenant-B/metrics',{headers});
  const metric=await own.json(),draft=await drafts.json();
  if(response.status!==200||own.status!==200||drafts.status!==200||cross.status!==403||
     receipt.offlineDraftCount!==1||draft.drafts.length!==1||metric.inquiries!==1)throw new Error('OFFLINE_INTEGRATION_FAILED');
  const out={status:'OFFLINE_PRIVATE_STAGE_PASS',whatsappProviderConnected:false,
    providerMessagesSent:0,customerPaymentsCaptured:0,
    signedInbound:receipt.statuses,offlineDraftCount:receipt.offlineDraftCount,
    draftDelivery: draft.drafts[0].providerDelivery,tenantAInquiries:metric.inquiries,
    tenantBCrossAccessHttp:cross.status,adminOidcFormatToken:'EPHEMERAL_RSA_LOCAL_ONLY',
    commercialRelease:'BLOCKED'};
  console.log(JSON.stringify(out,null,2));
}finally{
  await Promise.allSettled([webhook?.stop(),admin?.stop()].filter(Boolean));
  store.close();rmSync(dir,{recursive:true,force:true});
}
