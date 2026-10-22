import test from 'node:test';
import assert from 'node:assert/strict';
import {OPENHANDS_VERIFIED_RUN_REFERENCES, summarizeOpenHandsEngineering, registerOpenHandsEvidence} from '../openhands_engineering_bridge.js';

const project='project:qualify-openhands';
const run=(x)=>({...x,repository:'evansmusitu/mft-axiom-build',status:'completed',conclusion:'success'});
const verified=OPENHANDS_VERIFIED_RUN_REFERENCES.map(run);

test('real historical OpenHands execution evidence remains bounded and does not certify end-to-end S3',()=>{
  const report=summarizeOpenHandsEngineering({project_id:project,runs:verified});
  assert.equal(report.schema,'musitu.axiom.openhands-ecc-evidence.s0.v1');
  assert.equal(report.project_id,project);
  assert.equal(report.existing_live_native_agents,'HISTORICAL_CI_PASS_BOUNDED');
  assert.equal(report.native_durable_workerd,'HISTORICAL_CI_PASS_BOUNDED');
  assert.equal(report.end_to_end_s3_engineering,'NOT_PROVEN');
  assert.equal(report.external_verifier,'NOT_CERTIFIED');
  assert.equal(report.independent_global_antirollback,'FAILED_IN_SYNTHETIC_ATTACK');
  assert.equal(report.production_authority,false);
  assert.equal(report.provider_dispatch_allowed,false);
  assert.deepEqual(report.mission_control_rows,['agent_fleet','cloud_handoff']);
});
test('unverified run metadata cannot claim historical success',()=>{
  const bad=[{...verified[0],conclusion:'failure'},...verified.slice(1)];
  const report=summarizeOpenHandsEngineering({project_id:project,runs:bad});
  assert.equal(report.existing_live_native_agents,'NOT_PROVEN');
  assert.equal(report.end_to_end_s3_engineering,'NOT_PROVEN');
});
test('run provenance refuses unexpected repository or commit, forged status, and extra provider grants',()=>{
  for(const runs of [
    [{...verified[0],repository:'attacker/fork'},...verified.slice(1)],
    [{...verified[0],head_sha:'f'.repeat(40)},...verified.slice(1)],
    [{...verified[0],production_authority:true},...verified.slice(1)],
  ])assert.throws(()=>summarizeOpenHandsEngineering({project_id:project,runs}),/invalid|untrusted|unsupported/i);
});
test('cross-project and secret-bearing evidence rejects before persistence',async()=>{
  await assert.rejects(()=>registerOpenHandsEvidence({ecc:{setMatrixEvidence:async()=>{}},project_id:project,actor_id:'local-user',runs:[{...verified[0],credential:'Bearer abcdefghijklmnop'},...verified.slice(1)]}),/invalid|unsupported|secret/i);
});
test('ECC integration records only blocked-external rows and never production authorities',async()=>{
  const calls=[];const ecc={setMatrixEvidence:async(pid,aid,row)=>{calls.push([pid,aid,row]);return row;}};
  const result=await registerOpenHandsEvidence({ecc,project_id:project,actor_id:'local-user',runs:verified});
  assert.equal(calls.length,2);
  assert.deepEqual(calls.map(x=>x[2].row_id),['agent_fleet','cloud_handoff']);
  for(const [pid,aid,row] of calls){assert.equal(pid,project);assert.equal(aid,'local-user');assert.equal(row.state,'IMPLEMENTED_BLOCKED_EXTERNAL');assert.equal(row.external_qualification,null);}
  assert.equal(result.production_authority,false);
  assert.equal(result.end_to_end_s3_engineering,'NOT_PROVEN');
});
import fs from 'node:fs';
test('existing Command Center exposes provider evidence panel and only governed registration',()=>{
  const ui=fs.readFileSync(new URL('../engineering_command_center_ui.js',import.meta.url),'utf8');
  assert.ok(ui.includes('OpenHands engineering evidence'));
  assert.ok(ui.includes('registerOpenHandsEvidence({ecc:db.ecc'));
  assert.ok(ui.includes('openHands')||ui.includes('openhands_run_references'));
  assert.ok(ui.includes('production authority FALSE'));
  assert.equal(/OPENHANDS_API_KEY|CLOUDFLARE_API_TOKEN/.test(ui),false);
});
