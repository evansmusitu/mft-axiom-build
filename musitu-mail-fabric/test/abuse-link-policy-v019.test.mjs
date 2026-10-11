import test from 'node:test';
import assert from 'node:assert/strict';
import {MailFabric} from '../src/fabric.mjs';
import {createSimulatedProvider} from '../src/providers.mjs';
import {PolicyRejection} from '../src/policy.mjs';
const message={tenantId:'client1',from:'alerts@example.org',to:'member@example.net',subject:'Account security',text:'Please sign in securely.',kind:'SECURITY',idempotencyKey:'security-key-1234'};
const fixture=(config={})=>{
 const provider=createSimulatedProvider();
 const fabric=new MailFabric({tenantId:'client1',verifiedDomains:['example.org'],allowedRegions:['us-east-1'],provider,...config});
 return {fabric,provider};
};
async function rejected(body,code,config={}){
 const {fabric,provider}=fixture(config);
 await assert.rejects(()=>fabric.submit({...message,text:body}),{code});
 assert.equal(provider.attempts,0);
}
test('explicit HTTPS link allowlist is required, even on a SECURITY-purpose message',async()=>{
 await rejected('Review https://untrusted.example/login','UNAPPROVED_LINK');
 await rejected('Review http://example.org/account','INSECURE_LINK',{allowedLinkDomains:['example.org']});
 const {fabric}=fixture({allowedLinkDomains:['example.org']});
 const response=await fabric.submit({...message,text:'Review https://example.org/security.'});
 assert.equal(response.state,'ACCEPTED_BY_PROVIDER');
});
test('link rules deny phishing lookalike, private IP, embedded credentials and unlisted subdomains',async()=>{
 const allowed={allowedLinkDomains:['example.org']};
 for(const body of ['https://example.org.attacker.invalid/login','https://bad.example.org/login',
  'https://user:pass@example.org/login','https://127.0.0.1/login','https://example.org@attacker.invalid/login'])
  await rejected(body,'UNAPPROVED_LINK',allowed);
});
test('config refuses malformed allowlist and nonsensical domains',()=>{
 for(const domains of [['https://example.org'],['*.example.org'],['127.0.0.1'],['Example.org'],['example.org','example.org']])
  assert.throws(()=>fixture({allowedLinkDomains:domains}),TypeError);
});
test('body without URLs remains valid and plain www host is rejected to avoid accidental unsafe links',async()=>{
 const {fabric}=fixture();assert.equal((await fabric.submit(message)).state,'ACCEPTED_BY_PROVIDER');
 await rejected('Go to www.example.org to log in','UNAPPROVED_LINK');
});
