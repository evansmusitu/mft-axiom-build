import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const here=dirname(fileURLToPath(import.meta.url));
const root=resolve(here,'..');
const router=await import(pathToFileURL(resolve(root,'capability_router_v2.js')).href);
const read=name=>readFile(resolve(root,name),'utf8');

test('qualification classes remain distinct and truth counts stay locked',()=>{
  assert.deepEqual(router.QUALIFICATION_CLASSES,[
    'CERTIFIED_ATOMIC','REGISTERED_DERIVED','DISCOVERED_CANDIDATE','FRONTIER_EXPERIMENTAL','TARGET_ONLY'
  ]);
  assert.equal(router.CAPABILITY_TRUTH.certified_atomic_runtime_operations,74);
  assert.equal(router.CAPABILITY_TRUTH.public_axiom_plugin_tools,108);
  assert.equal(router.CAPABILITY_TRUTH.registered_native_derived_compositions,2400);
  assert.equal(router.CAPABILITY_TRUTH.discovered_candidate_dags,2235);
  assert.equal(router.CAPABILITY_TRUTH.frontier_v5_targets,110);
  assert.equal(router.CAPABILITY_TRUTH.candidate_certification,'NOT_CERTIFIED');
  assert.equal(router.CAPABILITY_TRUTH.wolfram_parity,'NOT_CERTIFIED');
  assert.equal(router.CAPABILITY_TRUTH.superiority,'NOT_CERTIFIED');
});

test('certified atomic and registered derived references can only plan previews',()=>{
  const atomic=router.classifyCapabilityReference('finance.var_historical');
  assert.equal(atomic.qualification_class,'CERTIFIED_ATOMIC');
  const derivedLo=router.classifyCapabilityReference('AXC-0001');
  const derivedHi=router.classifyCapabilityReference('AXC-2400');
  assert.equal(derivedLo.qualification_class,'REGISTERED_DERIVED');
  assert.equal(derivedHi.qualification_class,'REGISTERED_DERIVED');
  assert.equal(router.classifyCapabilityReference('AXC-2401').qualification_class,'TARGET_ONLY');

  const route=router.routeCapabilityV2('use finance.var_historical to inspect risk');
  assert.equal(route.policy.decision,'PREVIEW_ALLOWED');
  assert.equal(route.policy.planner_allowed,true);
  assert.equal(route.policy.browser_execution_authorized,false);
  assert.equal(route.policy.external_action_authorized,false);
  assert.equal(route.policy.production_authorized,false);
  assert.doesNotThrow(()=>router.assertPlannerRouteAllowed(route));
});

test('all discovered-candidate ID boundaries fail closed',()=>{
  for (const id of ['AXD-0001','AXD-2235']) {
    const classification=router.classifyCapabilityReference(id);
    assert.equal(classification.qualification_class,'DISCOVERED_CANDIDATE');
    const route=router.routeCapabilityV2(`please execute ${id}`);
    assert.equal(route.policy.decision,'DENY');
    assert.equal(route.policy.planner_allowed,false);
    assert.throws(()=>router.assertPlannerRouteAllowed(route),/CANDIDATE_REQUIRES_SCHEMA_DETERMINISTIC_ADVERSARIAL_EVIDENCE_AND_REGISTRATION_GATES/);
  }
  assert.equal(router.classifyCapabilityReference('AXD-2236').qualification_class,'TARGET_ONLY');
});

test('experimental, target and unknown references have no execution authority',()=>{
  assert.equal(router.classifyCapabilityReference('unknown.magic').qualification_class,'TARGET_ONLY');
  for (const ref of ['FRONTIER-new-agent','EXPERIMENTAL:tool','TARGET-007','V5TARGET:110']) {
    const classification=router.classifyCapabilityReference(ref);
    assert.ok(['FRONTIER_EXPERIMENTAL','TARGET_ONLY'].includes(classification.qualification_class));
    const route=router.routeCapabilityV2(`route ${ref}`);
    assert.equal(route.policy.decision,'DENY');
    assert.equal(route.policy.browser_execution_authorized,false);
    assert.equal(route.policy.external_action_authorized,false);
    assert.equal(route.policy.production_authorized,false);
  }
});

test('ordinary objective routing remains registered-derived preview only when every atomic op is certified',()=>{
  const route=router.routeCapabilityV2('stress test my portfolio and verify tail drawdown');
  assert.equal(route.qualification_class,'REGISTERED_DERIVED');
  assert.equal(route.policy.decision,'PREVIEW_ALLOWED');
  assert.equal(route.policy.planner_allowed,true);
  assert.equal(route.side_effect_class,'COMPUTE_ONLY');
  assert.equal(route.derived_catalog_size,2400);
  assert.equal(route.candidate_catalog_size,2235);
  assert.ok(route.atomic_operations.length>0);
  assert.equal(route.policy.browser_execution_authorized,false);
  assert.equal(route.policy.external_action_authorized,false);
  assert.equal(route.policy.production_authorized,false);
});

test('invalid risk class fails toward S5 while remaining non-executing',()=>{
  const route=router.routeCapabilityV2('finance.var_historical',{riskClass:'INVALID'});
  assert.equal(route.policy.risk_class,'S5');
  assert.equal(route.policy.browser_execution_authorized,false);
  assert.equal(route.policy.external_action_authorized,false);
  assert.equal(route.policy.production_authorized,false);
});

test('capability guard intercepts denied composer routes before legacy preview and adds no direct network execution',async()=>{
  const [guard,adapter]=await Promise.all([read('capability_guard.js'),read('data_adapters.js')]);
  assert.match(guard,/addEventListener\('submit',[\s\S]*,true\)/);
  assert.match(guard,/stopImmediatePropagation\(\)/);
  assert.match(guard,/routeCapabilityV2/);
  assert.match(guard,/assertPlannerRouteAllowed/);
  assert.match(guard,/CAPABILITY POLICY · FAIL CLOSED/);
  assert.match(guard,/browser execution: denied/);
  assert.match(guard,/external action: denied/);
  assert.match(guard,/production: denied/);
  assert.doesNotMatch(guard,/\bfetch\s*\(/);
  assert.doesNotMatch(guard,/XMLHttpRequest/);
  assert.doesNotMatch(guard,/WebSocket\s*\(/);
  assert.match(adapter,/foundation_bootstrap\.js/);
  assert.match(adapter,/capability_guard\.js/);
});
