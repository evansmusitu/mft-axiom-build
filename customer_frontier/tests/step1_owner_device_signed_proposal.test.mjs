import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync, sign, createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {buildUnsignedOwnerProposal,verifySignedOwnerProposal,prepareLocalProposal,finalizeLocalProposal,OwnerDeviceNoGo} from '../qualification/step1_owner_device_signed_proposal.mjs';
const modulePath=fileURLToPath(new URL('../qualification/step1_owner_device_signed_proposal.mjs',import.meta.url));
const sha=b=>createHash('sha256').update(b).digest('hex');
const signing=generateKeyPairSync('ed25519'),recipient=generateKeyPairSync('x25519');
const signingDer=signing.publicKey.export({type:'spki',format:'der'});
const recipientDer=recipient.publicKey.export({type:'spki',format:'der'});
const signingPin=sha(signingDer),recipientPin=sha(recipientDer);
const issued='2026-11-12T19:00:00.000Z',now=new Date(issued);
const keys={signingDer,recipientDer,trustedSigningPin:signingPin,trustedRecipientPin:recipientPin};
const entropy=(n)=>Buffer.alloc(n,n);
const plan=()=>buildUnsignedOwnerProposal({...keys,now,entropy});
const sig=payload=>sign(null,Buffer.from(payload,'utf8'),signing.privateKey);
const valid=()=>{const p=plan();return {...keys,payload:p.payload,signature:sig(p.payload),now:new Date(issued)};};
const rejected=x=>assert.throws(()=>x(),e=>e instanceof OwnerDeviceNoGo);
function fixture(fn){const temp=mkdtempSync(join(tmpdir(),'axiom-owner-local-test-'));try{return fn(temp)}finally{rmSync(temp,{recursive:true,force:true})}}
function setup(temp){const keysDir=join(temp,'keys');mkdirSync(keysDir);mkdirSync(join(keysDir,'public'));
 writeFileSync(join(keysDir,'public','owner_ed25519_spki.der'),signingDer);
 writeFileSync(join(keysDir,'public','owner_x25519_spki.der'),recipientDer);
 return keysDir;}
function withPins(fn){const prior={...process.env};process.env.AXIOM_TRUSTED_OWNER_ED25519_SPKI_SHA256=signingPin;process.env.AXIOM_TRUSTED_OWNER_X25519_SPKI_SHA256=recipientPin;try{return fn()}finally{process.env=prior}}

test('canonical unsigned intent pins all previously failed gates as NO_GO',()=>{
 const p=plan(),obj=JSON.parse(p.payload);
 assert.equal(obj.schema,'musitu.axiom.step1.owner-controlled-recovery-proposal.v1');
 assert.equal(obj.source_database,'ccc473f1-fbb5-4b8d-8a24-45f3696ac10f');
 assert.match(obj.new_database_name,/^axiom-idp-step1-disposable-restore-20261112-[a-f0-9]{8}$/);
 assert.equal(obj.max_additional_spend_usd,0);
 assert.equal(obj.customer_data_export_authorized,false);
 assert.equal(obj.customer_data_restore_authorized,false);
 assert.equal(obj.existing_database_changes,false);
 assert.equal(obj.production_changes,false);
 assert.equal(obj.historical_independent_custody_result,'UNMET_POLICY_SUPERSEDED_NOT_PASS');
 assert.equal(obj.b27_synthetic_cas_result,'FAIL');
 assert.equal(obj.pr83_fullstack_result,'FAIL');
 assert.equal(obj.release_status,'NOT_RELEASE');
 assert.equal(p.status,'UNSIGNED_OWNER_POLICY_PROPOSAL_ONLY_NO_GO');
 assert.equal(p.plan_sha256,sha(Buffer.from(p.payload,'utf8')));
});

test('synthetic signed exact intent passes verification but never authorizes D1',()=>{
 const r=verifySignedOwnerProposal(valid());
 assert.equal(r.signature_valid_for_exact_proposal,true);
 for(const k of ['source_customer_sql_export_authorized','disposable_target_creation_authorized','current_encrypted_backup_qualified','zero_additional_spend_qualified','hosted_restore_and_tenant_parity_qualified','step_1_closed','step_2_authorized','release_authorized'])assert.equal(r[k],false,k);
 assert.equal(r.status,'OWNER_SIGNATURE_VALID_PROPOSAL_ONLY_NO_GO');
});

test('tampered plan and wrong owner signature denied',()=>{
 const a=valid();rejected(()=>verifySignedOwnerProposal({...a,payload:a.payload.replace('20261112','20261113')}));
 rejected(()=>verifySignedOwnerProposal({...a,signature:sign(null,Buffer.from('other'),signing.privateKey)}));
 rejected(()=>verifySignedOwnerProposal({...a,signature:Buffer.alloc(64)}));
});

test('wrong algorithm or unpinned signer and recipient denied',()=>{
 const a=valid(),other=generateKeyPairSync('ed25519');
 rejected(()=>verifySignedOwnerProposal({...a,signingDer:other.publicKey.export({type:'spki',format:'der'})}));
 rejected(()=>verifySignedOwnerProposal({...a,recipientDer:signingDer}));
 rejected(()=>verifySignedOwnerProposal({...a,trustedSigningPin:sha(Buffer.from('fake'))}));
 rejected(()=>verifySignedOwnerProposal({...a,trustedRecipientPin:undefined}));
 rejected(()=>verifySignedOwnerProposal({...a,signingDer:Buffer.from('garbage')}));
});

test('expiry, future-dated and forged timestamp denied',()=>{
 const a=valid();rejected(()=>verifySignedOwnerProposal({...a,now:new Date('2026-11-12T19:15:00.000Z')}));
 rejected(()=>verifySignedOwnerProposal({...a,now:new Date('2026-11-12T18:59:59.999Z')}));
 rejected(()=>verifySignedOwnerProposal({...a,now:'not-a-date'}));
});

test('entropy malformed or unsupported issue date denied',()=>{
 rejected(()=>buildUnsignedOwnerProposal({...keys,now,entropy:()=>Buffer.alloc(1)}));
 rejected(()=>buildUnsignedOwnerProposal({...keys,now:new Date('1999-01-01'),entropy}));
});

test('unreviewed trust pins cannot be derived from the public key itself',()=>{
 rejected(()=>buildUnsignedOwnerProposal({signingDer,recipientDer,now,entropy}));
 rejected(()=>buildUnsignedOwnerProposal({...keys,trustedRecipientPin:'f'.repeat(64),now,entropy}));
});

test('fresh proposals generate fresh nonces and target names',()=>{
 const a=buildUnsignedOwnerProposal({...keys,now}),b=buildUnsignedOwnerProposal({...keys,now});
 assert.notEqual(JSON.parse(a.payload).nonce,JSON.parse(b.payload).nonce);
 assert.notEqual(JSON.parse(a.payload).new_database_name,JSON.parse(b.payload).new_database_name);
});

test('offline prepare writes only public scoped plan without accessing owner private key',()=>fixture(temp=>withPins(()=>{
 const keysDir=setup(temp),out=join(temp,'proposal');
 const a=prepareLocalProposal(keysDir,out,now);
 assert.equal(JSON.parse(readFileSync(join(out,'OWNER_PROPOSAL_PAYLOAD.json'),'utf8')).release_status,'NOT_RELEASE');
 assert.equal(readFileSync(join(out,'OWNER_PROPOSAL_PAYLOAD.json'),'utf8'),a.payload);
 assert.equal(existsSync(join(out,'OWNER_SIGNATURE.bin')),false);
 rejected(()=>prepareLocalProposal(keysDir,out,now));
})));

test('offline finalize with synthetic signature writes a proposal-only evidence bundle',()=>fixture(temp=>withPins(()=>{
 const keysDir=setup(temp),out=join(temp,'proposal');
 prepareLocalProposal(keysDir,out,now);
 const payload=readFileSync(join(out,'OWNER_PROPOSAL_PAYLOAD.json'));
 writeFileSync(join(out,'OWNER_SIGNATURE.bin'),sig(payload));
 const r=finalizeLocalProposal(keysDir,out,now);
 assert.equal(r.release_status,'NOT_RELEASE');
 const b=JSON.parse(readFileSync(join(out,'OWNER_SIGNED_PROPOSAL_NOT_AUTHORITY.json'),'utf8'));
 assert.equal(b.payload,payload.toString('utf8'));
 assert.equal(Buffer.from(b.owner.signature_base64,'base64').length,64);
 assert.equal(existsSync(join(out,'OWNER_PRIVATE_KEY.pem')),false);
 rejected(()=>finalizeLocalProposal(keysDir,out,now));
})));

test('wrong signature or removed trust pins never create signed receipt',()=>fixture(temp=>withPins(()=>{
 const keysDir=setup(temp),out=join(temp,'proposal');prepareLocalProposal(keysDir,out,now);
 writeFileSync(join(out,'OWNER_SIGNATURE.bin'),Buffer.alloc(64));
 rejected(()=>finalizeLocalProposal(keysDir,out,now));
 assert.equal(existsSync(join(out,'OWNER_SIGNATURE_PROPOSAL_ONLY_NO_GO.json')),false);
 delete process.env.AXIOM_TRUSTED_OWNER_X25519_SPKI_SHA256;
 rejected(()=>finalizeLocalProposal(keysDir,out,now));
})));

test('symlinked public key and output collisions fail closed',()=>fixture(temp=>withPins(()=>{
 const keysDir=setup(temp),out=join(temp,'proposal');
 rmSync(join(keysDir,'public','owner_ed25519_spki.der'));
 symlinkSync(join(keysDir,'public','owner_x25519_spki.der'),join(keysDir,'public','owner_ed25519_spki.der'));
 rejected(()=>prepareLocalProposal(keysDir,out,now));
 assert.equal(existsSync(out),false);
})));

test('CLI with no external trust pins refuses without emitting private key material',()=>fixture(temp=>{
 const keysDir=setup(temp),out=join(temp,'proposal');
 const env={...process.env};delete env.AXIOM_TRUSTED_OWNER_ED25519_SPKI_SHA256;delete env.AXIOM_TRUSTED_OWNER_X25519_SPKI_SHA256;
 const r=spawnSync(process.execPath,[modulePath,'prepare',keysDir,out],{encoding:'utf8',env});
 assert.equal(r.status,2);assert.match(r.stderr,/AXIOM_OWNER_PROPOSAL_NO_GO:EXTERNAL_TRUST_PINS_REQUIRED/);
 assert.ok(!r.stderr.includes(signingDer.toString('base64')));
 assert.equal(existsSync(out),false);
}));

test('OpenSSL Ed25519 pkeyutl -rawin interoperability with unsigned JSON',()=>fixture(temp=>{
 const keyPath=join(temp,'synthetic-private.pem'),msgPath=join(temp,'payload'),signaturePath=join(temp,'signature');
 writeFileSync(keyPath,signing.privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});
 const a=plan();writeFileSync(msgPath,a.payload,{mode:0o600});
 const openssl=spawnSync('openssl',['pkeyutl','-sign','-rawin','-inkey',keyPath,'-in',msgPath,'-out',signaturePath],{encoding:'utf8'});
 assert.equal(openssl.status,0,openssl.stderr);
 const receipt=verifySignedOwnerProposal({...keys,payload:a.payload,signature:readFileSync(signaturePath),now});
 assert.equal(receipt.release_authorized,false);
}));
