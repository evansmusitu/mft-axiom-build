import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {inspectPhase1Evidence,PHASE1_GATE_IDS} from '../scripts/phase1-release-gate.mjs';
test('Phase 1 release is blocked in absence of independently earned live approvals',()=>{
 const r=spawnSync(process.execPath,['scripts/phase1-release-gate.mjs'],{encoding:'utf8'});
 assert.equal(r.status,2);const o=JSON.parse(r.stdout);
 assert.equal(o.status,'PHASE1_RELEASE_BLOCKED');
 assert.ok(o.blocked.includes('native_postgresql_17_migrations_rls_concurrency_recovery'));
 assert.ok(o.blocked.includes('authorized_meta_development_account_end_to_end'));
 assert.ok(o.blocked.includes('live_keycloak_oidc_and_membership_mfa'));
 assert.equal(o.evidenceIntegrity,'PASS');
 assert.ok(o.boundedTechnicalEvidence.some(g=>g.id==='nextjs_customer_dashboard_prod_build'));
});

function synthetic(t){
 const root=mkdtempSync(join(tmpdir(),'musitu-release-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 mkdirSync(join(root,'evidence/20261023'),{recursive:true});
 const content='synthetic evidence',path='evidence/20261023/synthetic.json';writeFileSync(join(root,path),content);
 const evidence={path,sha256:createHash('sha256').update(content).digest('hex')};
 const register={schema:'musitu.whatsapp.phase1.acceptance.v2',environment:'PRIVATE_STAGING_PROTECTED',observedAt:'2026-10-23T00:00:00Z',publicReleaseAuthorized:false,
  gates:PHASE1_GATE_IDS.map(id=>({id,status:'CONFIRMED_BOUNDED',scope:'Synthetic technical fixture; no live authority.',evidence:[{...evidence}]}))};
 return{root,register};
}

test('even an entirely confirmed checked-in matrix cannot grant live release authority',t=>{
 const o=inspectPhase1Evidence(synthetic(t));assert.deepEqual(o.blocked,[]);
 assert.equal(o.status,'PHASE1_RELEASE_BLOCKED');assert.equal(o.publicReleaseAuthorized,false);assert.equal(o.independentLiveApprovalRequired,true);
});

test('missing, duplicate, unknown or release-authorizing gate records fail closed',t=>{
 const {root,register}=synthetic(t);
 for(const change of [r=>r.gates.pop(),r=>r.gates[0].id=r.gates[1].id,r=>r.gates[0].status='APPROVED',r=>r.publicReleaseAuthorized=true,r=>r.gates[0].evidence=[]]){
  const candidate=structuredClone(register);change(candidate);assert.throws(()=>inspectPhase1Evidence({root,register:candidate}));
 }
});

test('missing, altered, traversing and external-symlink evidence is rejected',t=>{
 const {root,register}=synthetic(t);
 for(const path of ['../outside.json','evidence/20261023/missing.json']){
  const candidate=structuredClone(register);candidate.gates[0].evidence[0].path=path;assert.throws(()=>inspectPhase1Evidence({root,register:candidate}));
 }
 const target=join(root,'outside.json');writeFileSync(target,'synthetic evidence');
 const current=join(root,'evidence/20261023/synthetic.json');rmSync(current);symlinkSync(target,current);
 assert.throws(()=>inspectPhase1Evidence({root,register}));rmSync(current);writeFileSync(current,'changed');
 assert.throws(()=>inspectPhase1Evidence({root,register}));
});
