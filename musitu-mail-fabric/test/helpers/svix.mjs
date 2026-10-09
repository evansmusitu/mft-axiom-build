import {createHmac} from 'node:crypto';
export const makeWebhook=event=>JSON.stringify(event);
export function webhookHeaders(secret,raw,id='svix-demo-001',timestamp=String(Math.floor(Date.now()/1000))){
 const key=Buffer.from(secret.slice('whsec_'.length),'base64');
 const signature=createHmac('sha256',key).update(id+'.'+timestamp+'.'+raw).digest('base64');
 return {'svix-id':id,'svix-timestamp':timestamp,'svix-signature':'v1,'+signature};
}
