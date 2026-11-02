/** Actual builder D1 + authority Durable Object restore; callbacks are synthetic, not inference. */
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync,cpSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixture} from './external-ledger-fixture.mjs';
import {createD1ExecutionGovernance} from '../../ops/axiom_execution_contract.mjs';
import {executeRuntimeTask} from '../../axiom_interface/vnext/runtime_task_service.mjs';
import {ATOMIC_OPERATIONS} from '../../axiom_interface/vnext/capability_registry.js';
const {Miniflare}=await import(process.env.AXIOM_MINIFLARE_MODULE||'miniflare');
export async function anchoredRestoreCase(t,anchor){
  const authority=await fixture(t,{persist:true,anchor}),root=mkdtempSync(join(tmpdir(),'axiom-anchor-builder-')),active=join(root,'active'),snapshot=join(root,'snapshot');
  const options={modules:true,compatibilityDate:'2026-07-01',cf:false,script:'export default {fetch(){return new Response("isolated")}}',d1Databases:{DB:'00000000-0000-4000-8000-000000000057'},d1Persist:active};
  let mf,db;async function start(){mf=new Miniflare(options);db=await mf.getD1Database('DB');}await start();
  t.after(async()=>{await mf?.dispose();rmSync(root,{recursive:true,force:true});});
  const ddl=readFileSync(new URL('../../ops/axiom_execution_contract_schema.sql',import.meta.url),'utf8').split('\n').filter(x=>!x.trimStart().startsWith('--')).join('\n').trim().split(/\n(?=(?:PRAGMA|CREATE (?:TABLE|TRIGGER|INDEX))\b)/u).map(x=>x.replace(/\s+/g,' ').trim()).join('\n');await db.exec(ddl);
  const customer={customer_id:'tenant-alpha'},objective='Produce the declared synthetic acknowledgement.',context={project_id:'project-anchor',work_id:'work-one',controls:{privacy:'Project',budget:2}};
  const gate=client=>createD1ExecutionGovernance({db,customer,externalLedger:client,serverPolicy:{max_provider_calls:2}});
  await authority.bootstrap();let client=await authority.makeClient(),binding=await gate(client).admit({objective,context});await authority.grant({admission_sha256:binding.admission_sha256});
  await authority.snapshotStore();await mf.dispose();mf=null;cpSync(active,snapshot,{recursive:true});await start();binding=await gate(client).admit({objective,context});
  let callbacks=0;const model=async({stage})=>{callbacks++;return stage==='planning'?{title:'Synthetic plan',needs_research:false,operation:null,operation_args:{}}:{title:'Synthetic acknowledgement',summary:'Local callback; no model request.',findings:[],citations:[],limitations:['No inference.']};};
  const runtime={inspect:async()=>({ok:true,build_id:'anchor-fixture',operation_count:74,tools:ATOMIC_OPERATIONS}),execute:async()=>{throw Error('computation not requested');}};
  const run=b=>executeRuntimeTask({objective,customer,governance:b,runtime,model,idFactory:()=> 'task_anchor_restore'});
  const first=await run(binding);assert.equal(first.status,'COMPLETED');assert.equal(callbacks,2);assert.equal(first.external_ledger_evidence.length,2);
  await authority.restoreStore();await mf.dispose();mf=null;rmSync(active,{recursive:true,force:true});cpSync(snapshot,active,{recursive:true});await start();
  client=await authority.makeClient();binding=await gate(client).admit({objective,context});let denial;
  await assert.rejects(()=>run(binding),e=>{denial=e.remote_code??e.code??e.message;return /ANCHOR_/.test(denial);});assert.equal(callbacks,2,'destructive restore must not call the model callback again');
  const artifacts=(await db.prepare('SELECT COUNT(*) AS n FROM axiom_ec_artifacts').first()).n;assert.equal(artifacts,0);
  return {status:'PASSED',builder_store_restored:true,authority_store_restored:true,fresh_client:true,completed_before_restore:true,receipt_sha256:first.receipt.receipt_sha256,verified_checkpoint_count:2,callbacks_before_restore:2,callbacks_after_restore:0,artifacts_after_restore:artifacts,denial,inference_calls:0};
}
