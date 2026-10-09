import {randomBytes} from 'node:crypto';
import {MailFabric} from './src/fabric.mjs';
import {verifyProof} from './src/evidence.mjs';
import {createSimulatedProvider} from './src/providers.mjs';
const transport=createSimulatedProvider();
const fabric=new MailFabric({tenantId:'musitu-demo',verifiedDomains:['example.org'],allowedRegions:['us-east-1'],provider:transport},{privacyKey:randomBytes(32)});
const result=await fabric.submit({tenantId:'musitu-demo',from:'alerts@example.org',to:'test@example.net',subject:'Proof demonstration',text:'Simulated transactional notification. No email is sent.',kind:'SERVICE_ALERT',idempotencyKey:'demo-00000001'});
console.log(JSON.stringify({product:'MUSITU Mail Fabric',networkSending:false,messageId:result.messageId,state:result.state,evidenceVerified:verifyProof(result.proof,{trustedPublicKey:result.proof.publicKey}),evidenceEvents:result.proof.events.map(x=>x.event),note:'API acceptance is not inbox delivery. Simulation never sends real mail.'},null,2));
