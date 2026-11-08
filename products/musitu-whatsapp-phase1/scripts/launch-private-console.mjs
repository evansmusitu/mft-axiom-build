/**
 * MANUAL PRIVATE DEMO ONLY. Creates fresh short-lived keys and synthetic
 * tenants; listens exclusively on 127.0.0.1 and sends no external requests.
 * This is NOT customer onboarding, Meta connectivity or production identity.
 */
import {generateKeyPairSync,randomBytes,sign,createHmac} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PrivateStageStore} from '../src/private-stage/store.mjs';
import {createPrivateAdminServer} from '../src/private-stage/admin-server.mjs';
const folder=mkdtempSync(join(tmpdir(),'musitu-onepass-private-'));
const store=new PrivateStageStore(join(folder,'private-stage.sqlite'),{identityKey:randomBytes(32)});
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const issuer='https://idp.test.invalid/realms/isolated-operator-demo',audience='musitu-isolated-operator-demo';
function b64(x){return Buffer.from(JSON.stringify(x)).toString('base64url');}
function issue(subject){const now=Math.floor(Date.now()/1000);const head=b64({alg:'RS256',typ:'JWT',kid:'ephemeral-demo-key'}),body=b64({iss:issuer,aud:audience,sub:subject,iat:now-1,nbf:now-1,exp:now+600});return `${head}.${body}.${sign('RSA-SHA256',Buffer.from(`${head}.${body}`),privateKey).toString('base64url')}`;}
for(const code of ['A','B']){
 store.seedTenant({tenantId:`tenant-${code}`,legalName:`Example Business ${code}`,ownerId:`owner-${code}`,wabaId:`WABA_${code}`,phoneNumberId:`PHONE_${code}`});
 store.addResource(`tenant-${code}`,`owner-${code}`,'chair','Consultation room');
 store.putFaq(`tenant-${code}`,`owner-${code}`,'opening-hours','What time do you open?',code==='A'?'We open at 8 am.':'We open at 9 am.');
}
// Inject a synthetic member only for the disposable browser demonstration.
{const fixtureDb=new DatabaseSync(join(folder,'private-stage.sqlite'));
 fixtureDb.prepare("INSERT INTO memberships VALUES(?,?,'AGENT','ACTIVE')").run('tenant-A','demo-agent-A');
 fixtureDb.prepare("INSERT INTO memberships VALUES(?,?,'AGENT','ACTIVE')").run('tenant-B','demo-agent-B');
 fixtureDb.close();}
store.reserveBooking({tenantId:'tenant-A',actorId:'owner-A',resourceId:'chair',startAt:'2026-11-23T10:00:00.000Z',endAt:'2026-11-23T11:00:00.000Z',effectKey:'stage-booking-1'});
const metaSecret='ephemeral-stage-secret';
const payload={object:'whatsapp_business_account',entry:[{id:'WABA_A',changes:[{field:'messages',value:{metadata:{phone_number_id:'PHONE_A'},messages:[{id:'wamid.stage.console.onepass',type:'text',from:'263771234567',text:{body:'What time do you open?'}}]}}]}]};
const rawBody=Buffer.from(JSON.stringify(payload));const signature='sha256='+createHmac('sha256',metaSecret).update(rawBody).digest('hex');
const inbound=store.ingestSignedWebhook({rawBody,signature,appSecret:metaSecret});
store.draftApprovedFaqReply({tenantId:'tenant-A',actorId:'owner-A',conversationId:inbound[0].conversationId,question:'What time do you open?',effectKey:'stage-draft-1'});
// A distinct signed customer STOP suppresses previously created drafts.
const stopPayload={object:'whatsapp_business_account',entry:[{id:'WABA_A',changes:[{field:'messages',value:{metadata:{phone_number_id:'PHONE_A'},
 messages:[{id:'wamid.stage.console.optout',type:'text',from:'263771234567',text:{body:' STOP '}}]}}]}]};
const stopRaw=Buffer.from(JSON.stringify(stopPayload));
store.ingestSignedWebhook({rawBody:stopRaw,
 signature:'sha256='+createHmac('sha256',metaSecret).update(stopRaw).digest('hex'),appSecret:metaSecret});
// A second synthetic contact demonstrates staff-recorded off-platform opt-out.
const secondPayload={object:'whatsapp_business_account',entry:[{id:'WABA_A',changes:[{field:'messages',value:{metadata:{phone_number_id:'PHONE_A'},
 messages:[{id:'wamid.stage.console.second',type:'text',from:'263771234568',text:{body:'What time do you open?'}}]}}]}]};
const secondRaw=Buffer.from(JSON.stringify(secondPayload));
const secondReceipt=store.ingestSignedWebhook({rawBody:secondRaw,
 signature:'sha256='+createHmac('sha256',metaSecret).update(secondRaw).digest('hex'),appSecret:metaSecret});
store.draftApprovedFaqReply({tenantId:'tenant-A',actorId:'owner-A',conversationId:secondReceipt[0].conversationId,
 question:'What time do you open?',effectKey:'stage-draft-second'});
const server=createPrivateAdminServer({store,identityConfig:{issuer,audience,jwks:{keys:[{...publicKey.export({format:'jwk'}),kid:'ephemeral-demo-key',alg:'RS256',use:'sig'}]},maxTokenAgeSeconds:600}});
const url=await server.start();
console.log('\nMUSITU PRIVATE STAGE CONSOLE');
console.log('Local-only dashboard:',url+'/app');
console.log('Example tenant: tenant-A');
console.log('Short-lived isolated demo token (paste into the dashboard, never into a public service):');
console.log('ISOLATED_AGENT_B_TOKEN:',issue('demo-agent-B'));
console.log(issue('owner-A'));
console.log('Security: no real messages, payments, models, customer onboarding or external network requests.');
console.log('Press Ctrl+C to terminate; the temporary private database is removed on shutdown.');
async function close(){await server.stop();store.close();rmSync(folder,{recursive:true,force:true});process.exit(0);}
process.once('SIGINT',close);process.once('SIGTERM',close);
