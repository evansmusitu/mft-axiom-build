/** Test-only generation of two distinct release approvals. Never used in production. */
import {createHash,generateKeyPairSync,sign,randomBytes} from 'node:crypto';
import {canonicalReleaseBytes} from '../../src/security/release-authorization.mjs';
export function provisionTestRelease(env,{issuedMs=Date.now()-60000,expiresMs=Date.now()+3600000}={}){
 const owner=generateKeyPairSync('ed25519'),approver=generateKeyPairSync('ed25519');
 const configure=(name,pair)=>{
  env['MMF_RELEASE_'+name+'_PUBLIC_KEY_PEM']=pair.publicKey.export({format:'pem',type:'spki'}).toString();
  env['MMF_RELEASE_'+name+'_FINGERPRINT']=createHash('sha256').update(pair.publicKey.export({format:'der',type:'spki'})).digest('hex');
 };
 configure('OWNER',owner);configure('APPROVER',approver);
 const grant={schema:'mmf-live-release-v1',tenantId:env.MMF_TENANT_ID,domain:env.MMF_FROM_DOMAIN,provider:env.MMF_PROVIDER,issuedMs,expiresMs,nonce:'test-only-'+randomBytes(16).toString('hex')};
 const signed=canonicalReleaseBytes(grant);
 env.MMF_RELEASE_GRANT_JSON=JSON.stringify({grant,ownerSignature:sign(null,signed,owner.privateKey).toString('base64url'),approverSignature:sign(null,signed,approver.privateKey).toString('base64url')});
}
