import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {spawnSync} from 'node:child_process';import {randomBytes} from 'node:crypto';
import {MailFabric} from '../src/fabric.mjs';import {createSimulatedProvider} from '../src/providers.mjs';
async function fixture(t){const path=mkdtempSync(join(tmpdir(),'mmf-verify-'));t.after(()=>rmSync(path,{recursive:true,force:true}));
 const provider=createSimulatedProvider(),fabric=new MailFabric({tenantId:'client1',verifiedDomains:['example.org'],allowedRegions:['us-east-1'],provider},{privacyKey:randomBytes(32)});
 const message={tenantId:'client1',from:'sender@example.org',to:'recipient@example.net',subject:'Test',text:'Private',kind:'ACCOUNT',idempotencyKey:'notification001'};
 const result=await fabric.submit(message);const proof=join(path,'receipt.json'),trusted=join(path,'trusted.pem');
 writeFileSync(proof,JSON.stringify(result.proof));writeFileSync(trusted,result.proof.publicKey);return {proof,trusted,path};}
test('offline verifier accepts pinned key and rejects tampering or missing trust anchor',async t=>{
 const f=await fixture(t),run=(...args)=>spawnSync(process.execPath,[new URL('../src/verify-cli.mjs',import.meta.url).pathname,...args],{encoding:'utf8'});
 const ok=run('--receipt',f.proof,'--trusted-key',f.trusted);assert.equal(ok.status,0);assert.match(ok.stdout,/VERIFIED/);
 const missing=run('--receipt',f.proof);assert.notEqual(missing.status,0);assert.match(missing.stderr,/TRUST_ANCHOR_REQUIRED/);
 const json=JSON.parse((await import('node:fs')).readFileSync(f.proof,'utf8'));json.events[0].detail.kind='SECURITY';writeFileSync(f.proof,JSON.stringify(json));
 const bad=run('--receipt',f.proof,'--trusted-key',f.trusted);assert.notEqual(bad.status,0);assert.match(bad.stderr,/INVALID_EVIDENCE/);
});
