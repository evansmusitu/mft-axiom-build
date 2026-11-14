import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash,sign} from 'node:crypto';
import {mkdtempSync,rmSync,mkdirSync,existsSync,readdirSync,writeFileSync,chmodSync,symlinkSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {consumeSignedOwnerProposal,LocalNonceNoGo} from '../qualification/step1_owner_signed_proposal_nonce_guard.mjs';
import {PROPOSAL_SCHEMA,SOURCE_ACCOUNT,SOURCE_D1,AMENDMENT_SHA256} from '../qualification/step1_owner_control_policy_candidate.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const ed=generateKeyPairSync('ed25519');const x=generateKeyPairSync('x25519');
const der=ed.publicKey.export({format:'der',type:'spki'}),rec=x.publicKey.export({format:'der',type:'spki'});
const signPin=sha(der),recPin=sha(rec), issued='2026-11-13T05:00:00.000Z';
function plan(nonce='a'.repeat(32),suffix='abcddcba') {return {
 schema:PROPOSAL_SCHEMA,action:'PROPOSE_NEW_DISPOSABLE_D1_ONLY',
 governance_amendment_sha256:AMENDMENT_SHA256,source_account:SOURCE_ACCOUNT,
 source_database:SOURCE_D1,target_account:SOURCE_ACCOUNT,
 new_database_name:`axiom-idp-step1-disposable-restore-20261113-${suffix}`,
 owner_encryption_recipient_spki_sha256:recPin,
 issued_at:issued,expires_at:'2026-11-13T05:15:00.000Z',nonce,
 max_additional_spend_usd:0,existing_database_changes:false,
 customer_data_export_authorized:false,customer_data_restore_authorized:false,
 production_changes:false,step_2_authorized:false,
 independent_custodian_mandatory:false,owner_accepts_sole_custody_risk:true,
 historical_independent_custody_result:'UNMET_POLICY_SUPERSEDED_NOT_PASS',
 b27_synthetic_cas_result:'FAIL',pr83_fullstack_result:'FAIL',release_status:'NOT_RELEASE',
};}
const signed=(p=plan())=>{const payload=JSON.stringify(p);return{payload,owner:{public_key_spki_der_base64:der.toString('base64'),signature_base64:sign(null,Buffer.from(payload),ed.privateKey).toString('base64')}}};
function fixture(callback){const root=mkdtempSync(join(tmpdir(),'axiom-owner-nonce-test-'));try{const ledgerDir=join(root,'ledger');mkdirSync(ledgerDir,{mode:0o700});return callback(ledgerDir,root);}finally{rmSync(root,{recursive:true,force:true});}}
const run=(ledgerDir,s=signed(),other={})=>consumeSignedOwnerProposal({...s,ledgerDir,trustedSigningSpkiSha256:signPin,trustedRecipientSpkiSha256:recPin,now:new Date(issued),...other});
const dbname='AXIOM_STEP1_LOCAL_OWNER_PROPOSAL_NONCES_NOT_AUTHORITY.sqlite3';

test('a synthetic valid proposal consumes local nonce but always NO_GO',()=>fixture(ledger=>{
 const receipt=run(ledger);
 assert.equal(receipt.status,'LOCAL_OWNER_SIGNED_PROPOSAL_REPLAY_CONSUMED_ONLY_NO_GO');
 assert.equal(receipt.local_ledger_nonce_count,1);
 for(const flag of ['hosted_nonce_consistency_qualified','global_anti_rollback_qualified','owner_identity_mfa_verified','disposable_d1_creation_authorized','step1_closed','step2_authorized','release_authorized']) assert.equal(receipt[flag],false,flag);
 assert.equal(receipt.release_status,'NOT_RELEASE');
 assert.ok(existsSync(join(ledger,dbname)));
}));
test('exact signature or exact nonce replay is denied across fresh process attempts',()=>fixture(ledger=>{
 run(ledger);assert.throws(()=>run(ledger), e=>e instanceof LocalNonceNoGo && e.code==='LOCAL_NONCE_TRANSACTION_FAILED_NO_GO');
 assert.throws(()=>run(ledger,signed(plan('a'.repeat(32),'deadbeef'))),LocalNonceNoGo);
}));
test('different fresh nonces are accepted locally, never globally qualified',()=>fixture(ledger=>{
 run(ledger);const r=run(ledger,signed(plan('b'.repeat(32),'beefbeef')));
 assert.equal(r.local_ledger_nonce_count,2);assert.equal(r.global_anti_rollback_qualified,false);
}));
test('invalid signature, changed plan, expired time never touch ledger',()=>fixture(ledger=>{
 const valid=signed();const forged={...valid,owner:{...valid.owner,signature_base64:Buffer.alloc(64).toString('base64')}};
 assert.throws(()=>run(ledger,forged),LocalNonceNoGo);
 assert.throws(()=>run(ledger,{...valid,payload:valid.payload.replace('abcddcba','12345678')}),LocalNonceNoGo);
 assert.throws(()=>run(ledger,valid,{now:new Date('2026-11-13T05:15:00.000Z')}),LocalNonceNoGo);
 assert.equal(existsSync(join(ledger,dbname)),false);
}));
test('pin mismatch or missing recipient pin blocks before ledger mutation',()=>fixture(ledger=>{
 assert.throws(()=>run(ledger,signed(),{trustedSigningSpkiSha256:'0'.repeat(64)}),LocalNonceNoGo);
 assert.throws(()=>run(ledger,signed(),{trustedRecipientSpkiSha256:undefined}),LocalNonceNoGo);
 assert.equal(existsSync(join(ledger,dbname)),false);
}));
test('unreviewed action/side-effects cannot be signed into local replay ledger',()=>fixture(ledger=>{
 assert.throws(()=>run(ledger,signed({...plan(),customer_data_export_authorized:true})),LocalNonceNoGo);
 assert.throws(()=>run(ledger,signed({...plan(),release_status:'RELEASE'})),LocalNonceNoGo);
 assert.throws(()=>run(ledger,signed({...plan(),action:'DELETE_SOURCE_DATABASE'})),LocalNonceNoGo);
 assert.equal(readdirSync(ledger).length,0);
}));
test('path symlink and permissive shared directory cannot act as trusted ledger',()=>fixture((ledger,root)=>{
 const alias=join(root,'link');symlinkSync(ledger,alias);
 assert.throws(()=>run(alias),LocalNonceNoGo);chmodSync(ledger,0o755);
 assert.throws(()=>run(ledger),LocalNonceNoGo);assert.equal(existsSync(join(ledger,dbname)),false);
}));
test('a symlink or reused insecure database file cannot be used',()=>fixture((ledger,root)=>{
 const b=join(root,'dummy');writeFileSync(b,'fake');symlinkSync(b,join(ledger,dbname));
 assert.throws(()=>run(ledger),LocalNonceNoGo);
}));
test('direct noninteractive CLI refuses even public signed test input and leaves no ledger',()=>fixture((ledger,root)=>{
 const path=join(root,'owner_proposal.json');writeFileSync(path,JSON.stringify(signed()));
 const modulePath=new URL('../qualification/step1_owner_signed_proposal_nonce_guard.mjs',import.meta.url).pathname;
 const ret=spawnSync(process.execPath,[modulePath,path,ledger],{encoding:'utf8',env:{PATH:process.env.PATH}});
 assert.equal(ret.status,2);assert.match(ret.stderr,/OWNER_INTERACTIVE_DEVICE_ONLY/);
 assert.equal(existsSync(join(ledger,dbname)),false);
}));
