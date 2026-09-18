import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {RECOVERY_PROGRAM} from './program_contract.mjs';
import {TOOL_FABRIC_ORDER} from './tool_fabric.mjs';
import {AR08_ATTACK_DOMAINS} from './adversarial_qualification.mjs';
import {AR09_TARGETS} from './reliability_qualification.mjs';
import {AR10_DOMAINS,AR10_METRICS} from './benchmark_program.mjs';
import {AR11_STAGES} from './rollout_control.mjs';
import {AUTHORITATIVE_RUNTIME_BLOBS,loadAuthoritativeRuntimeBindings,runRuntimeConvergenceGate} from './runtime_convergence.mjs';

const BASE='7f8b51ddd426aa6c4b7684a67be1960db42028ee';
const SEALED_MAIN='d6a846f6bbe0bccac1758713eb4de167caf07113';
const RUNTIME='216ee7d15f01a3fb558452cc4b906a055001ccdd';
const ALLOWED=[
  '.gitlab-ci.yml',
  'docs/axiom_recovery/AR03_AR11_PROGRAM_STATUS_20260918.json',
  'recovery/ar03_11/'
];

function fail(message){throw new Error(message);}
function git(...args){const r=spawnSync('git',args,{encoding:'utf8'});if(r.status!==0)fail(`git ${args.join(' ')} failed: ${r.stderr}`);return r.stdout.trim();}
function assert(condition,message){if(!condition)fail(message);}

function verifyGitBoundary(){
  for(const sha of [BASE,SEALED_MAIN,RUNTIME])git('cat-file','-e',`${sha}^{commit}`);
  const changed=git('diff','--name-only',`${BASE}..HEAD`).split(/\r?\n/).filter(Boolean);
  for(const path of changed)assert(ALLOWED.some(prefix=>path===prefix||path.startsWith(prefix)),`scope escape: ${path}`);
  assert(changed.length>=14,'expected recovery programme files missing');
}

function verifyAuthoritativeRuntimeBlobs(){
  for(const [path,expected] of Object.entries(AUTHORITATIVE_RUNTIME_BLOBS)){
    const actual=git('rev-parse',`HEAD:${path}`);
    assert(actual===expected,`authoritative runtime blob drift: ${path} ${actual} != ${expected}`);
  }
}

function verifyProgramme(){
  assert(RECOVERY_PROGRAM.authority.production_authority===false,'production authority overstated');
  assert(RECOVERY_PROGRAM.authority.superiority==='NOT_CERTIFIED','superiority overstated');
  assert(RECOVERY_PROGRAM.authority.ar02_dependency==='EXTERNAL_GATES_OPEN','AR-02 dependency truth drift');
  assert(JSON.stringify(RECOVERY_PROGRAM.phases['AR-06'].fixed_order)===JSON.stringify(TOOL_FABRIC_ORDER),'AR-06 tool order drift');
  assert(AR08_ATTACK_DOMAINS.length===11,'AR-08 attack domain count drift');
  assert(AR09_TARGETS.gateway_availability_pct===99.9,'AR-09 availability target drift');
  assert(AR09_TARGETS.transient_failure_recovery_pct===95,'AR-09 recovery target drift');
  assert(AR09_TARGETS.duplicate_consequential_actions===0,'AR-09 duplicate action target drift');
  assert(AR09_TARGETS.reconciliation_and_provenance_pct===100,'AR-09 provenance target drift');
  assert(AR09_TARGETS.cross_tenant_leakage===0,'AR-09 tenant leakage target drift');
  assert(AR10_DOMAINS.length===7&&AR10_METRICS.length===10,'AR-10 frozen benchmark dimensions drift');
  assert(JSON.stringify(RECOVERY_PROGRAM.phases['AR-11'].fixed_order)===JSON.stringify(AR11_STAGES),'AR-11 rollout order drift');
}

function verifyStatusLedger(){
  const status=JSON.parse(fs.readFileSync('docs/axiom_recovery/AR03_AR11_PROGRAM_STATUS_20260918.json','utf8'));
  assert(status.authority.sealed_main_commit===SEALED_MAIN,'sealed main ledger drift');
  assert(status.authority.runtime_source_commit===RUNTIME,'runtime authority ledger drift');
  assert(status.authority.ar02_bootstrap_parent_commit===BASE,'AR-02 parent ledger drift');
  assert(status.dependency_truth.ar02_complete===false,'AR-02 completion overclaim');
  for(let n=3;n<=11;n++)assert(status.claim_boundary[`ar${String(n).padStart(2,'0')}_earned`]===false,`AR-${String(n).padStart(2,'0')} earned overclaim`);
  assert(status.claim_boundary.production_mutated===false,'production mutation overclaim');
  assert(status.claim_boundary.superiority==='NOT_CERTIFIED','superiority ledger overclaim');
  assert(status.phases['AR-11'].production_cutover_executed===false,'production cutover overclaim');
}

function verifyNoDirectProductionSurface(){
  const files=fs.readdirSync('recovery/ar03_11').filter(x=>x.endsWith('.mjs')).map(x=>`recovery/ar03_11/${x}`);
  const combined=files.map(p=>fs.readFileSync(p,'utf8')).join('\n');
  const forbidden=[/api\.cloudflare\.com/i,/wrangler\s+deploy/i,/CLOUDFLARE_GLOBAL_API_KEY/i,/process\.env\.(?:CLOUDFLARE|AWS|AZURE|GCP)/i];
  for(const rx of forbidden)assert(!rx.test(combined),`provider/deploy surface present: ${rx}`);
}

verifyGitBoundary();
verifyAuthoritativeRuntimeBlobs();
const convergence=await runRuntimeConvergenceGate(await loadAuthoritativeRuntimeBindings());
assert(convergence.status==='SOURCE_RUNTIME_CONVERGENCE_PASS','runtime convergence gate failed');
verifyProgramme();
verifyStatusLedger();
verifyNoDirectProductionSurface();
console.log(JSON.stringify({
  status:'INDEPENDENT_SOURCE_VERIFICATION_PASS',
  sealed_main:SEALED_MAIN,
  runtime_authority:RUNTIME,
  ar02_parent:BASE,
  ar03_ar11_candidates_present:true,
  all_phase_earned_claims_false:true,
  provider_execution_performed:false,
  production_mutated:false,
  superiority:'NOT_CERTIFIED'
},null,2));
