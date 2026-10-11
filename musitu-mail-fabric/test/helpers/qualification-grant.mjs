/** Local synthetic fixtures ONLY. Never use generated signing keys to claim real Resend qualification. */
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {canonicalProviderQualificationBytes} from '../../src/security/provider-qualification.mjs';
const pem=k=>k.export({type:'spki',format:'pem'}).toString();
const digest=k=>createHash('sha256').update(k.export({type:'spki',format:'der'})).digest('hex');
export function provisionSyntheticQualification(env,{auditor,claimOverrides={}}={}){
 const pair=auditor??generateKeyPairSync('ed25519'),now=Date.now();
 const claim={schema:'mmf-provider-qualification-v1',tenantId:env.MMF_TENANT_ID,domain:env.MMF_FROM_DOMAIN,
  provider:'resend',webhookId:'synthetic-webhook-123',svixId:'synthetic-svix-event-123',
  providerMessageId:'synthetic-provider-message-123',deliveryAttemptId:'synthetic-provider-attempt-123',
  eventType:'email.delivered',rawSha256:'a'.repeat(64),qualifiedMs:now-60000,expiresMs:now+3600000,
  nonce:'synthetic-attestation-nonce-123',...claimOverrides};
 const signature=sign(null,canonicalProviderQualificationBytes(claim),pair.privateKey).toString('base64url');
 env.MMF_QUALIFICATION_AUDITOR_PUBLIC_KEY_PEM=pem(pair.publicKey);
 env.MMF_QUALIFICATION_AUDITOR_FINGERPRINT=digest(pair.publicKey);
 env.MMF_PROVIDER_QUALIFICATION_JSON=JSON.stringify({claim,auditorSignature:signature});
 return {auditor:pair,claim};
}
