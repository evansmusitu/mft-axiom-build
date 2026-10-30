import {ATOMIC_OPERATIONS, DERIVED_CAPABILITY_COUNT, routeCapability as routeCapabilityV1} from './capability_registry.js';

export const QUALIFICATION_CLASSES = Object.freeze([
  'CERTIFIED_ATOMIC',
  'REGISTERED_DERIVED',
  'DISCOVERED_CANDIDATE',
  'FRONTIER_EXPERIMENTAL',
  'TARGET_ONLY',
]);

export const CAPABILITY_TRUTH = Object.freeze({
  certified_atomic_runtime_operations:74,
  public_axiom_plugin_tools:108,
  public_business_wrappers:30,
  public_discovery_tools:3,
  public_generic_executor_tools:1,
  registered_native_derived_compositions:2400,
  discovered_candidate_dags:2235,
  frontier_v5_targets:110,
  candidate_certification:'NOT_CERTIFIED',
  wolfram_parity:'NOT_CERTIFIED',
  superiority:'NOT_CERTIFIED',
});

const ATOMIC_SET=new Set(ATOMIC_OPERATIONS);
const AXC=/^AXC-(\d{4})$/i;
const AXD=/^AXD-(\d{4})$/i;
const EXPERIMENTAL=/^(?:FRONTIER|EXPERIMENTAL)[-:_]/i;
const TARGET=/^(?:TARGET|V5TARGET)[-:_]/i;
const RISK_CLASSES=Object.freeze(['S0','S1','S2','S3','S4','S5']);

function clean(value,limit=1000){
  return String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,limit);
}

function withinRange(match,max){
  const n=Number(match?.[1]||0);
  return Number.isInteger(n) && n>=1 && n<=max;
}

export function classifyCapabilityReference(reference){
  const ref=clean(reference,240);
  if (!ref) return Object.freeze({reference:null,qualification_class:'TARGET_ONLY',known:false,reason:'EMPTY_OR_UNSPECIFIED_REFERENCE'});
  if (ATOMIC_SET.has(ref)) return Object.freeze({reference:ref,qualification_class:'CERTIFIED_ATOMIC',known:true,reason:'MATCHED_CERTIFIED_ATOMIC_REGISTRY'});
  const axc=ref.match(AXC);
  if (axc) {
    if (withinRange(axc,DERIVED_CAPABILITY_COUNT)) return Object.freeze({reference:ref.toUpperCase(),qualification_class:'REGISTERED_DERIVED',known:true,reason:'MATCHED_REGISTERED_DERIVED_ID_RANGE'});
    return Object.freeze({reference:ref.toUpperCase(),qualification_class:'TARGET_ONLY',known:false,reason:'DERIVED_ID_OUT_OF_REGISTERED_RANGE'});
  }
  const axd=ref.match(AXD);
  if (axd) {
    if (withinRange(axd,CAPABILITY_TRUTH.discovered_candidate_dags)) return Object.freeze({reference:ref.toUpperCase(),qualification_class:'DISCOVERED_CANDIDATE',known:true,reason:'MATCHED_DISCOVERED_CANDIDATE_ID_RANGE'});
    return Object.freeze({reference:ref.toUpperCase(),qualification_class:'TARGET_ONLY',known:false,reason:'CANDIDATE_ID_OUT_OF_DISCOVERED_RANGE'});
  }
  if (EXPERIMENTAL.test(ref)) return Object.freeze({reference:ref,qualification_class:'FRONTIER_EXPERIMENTAL',known:false,reason:'EXPERIMENTAL_REFERENCE_REQUIRES_EXPLICIT_EVIDENCE'});
  if (TARGET.test(ref)) return Object.freeze({reference:ref,qualification_class:'TARGET_ONLY',known:false,reason:'TARGET_REGISTRY_PRESENCE_IS_NOT_IMPLEMENTATION_PROOF'});
  return Object.freeze({reference:ref,qualification_class:'TARGET_ONLY',known:false,reason:'UNKNOWN_CAPABILITY_REFERENCE'});
}

function explicitReferenceFromObjective(objective){
  const text=clean(objective,2000);
  const candidate=text.match(/\bAXD-\d{4}\b/i);
  if (candidate) return candidate[0];
  const derived=text.match(/\bAXC-\d{4}\b/i);
  if (derived) return derived[0];
  for (const op of ATOMIC_OPERATIONS) if (text.includes(op)) return op;
  const frontier=text.match(/\b(?:FRONTIER|EXPERIMENTAL)[-:_][A-Za-z0-9._:-]+\b/i);
  if (frontier) return frontier[0];
  const target=text.match(/\b(?:TARGET|V5TARGET)[-:_][A-Za-z0-9._:-]+\b/i);
  return target?.[0]||null;
}

function policyFor(classification,{riskClass='S0'}={}){
  const risk=RISK_CLASSES.includes(riskClass)?riskClass:'S5';
  const base={
    risk_class:risk,
    browser_execution_authorized:false,
    external_action_authorized:false,
    production_authorized:false,
  };
  if (classification.qualification_class==='CERTIFIED_ATOMIC') {
    return Object.freeze({...base,decision:'PREVIEW_ALLOWED',planner_allowed:true,reason:'CERTIFIED_ATOMIC_MAY_BE_ROUTED_TO_QUALIFIED_RUNTIME_BUT_BROWSER_CANNOT_EXECUTE'});
  }
  if (classification.qualification_class==='REGISTERED_DERIVED') {
    return Object.freeze({...base,decision:'PREVIEW_ALLOWED',planner_allowed:true,reason:'REGISTERED_DERIVED_MAY_PLAN_CERTIFIED_ATOMIC_CHAIN_BUT_IS_NOT_SEPARATE_ATOMIC_CERTIFICATION'});
  }
  if (classification.qualification_class==='DISCOVERED_CANDIDATE') {
    return Object.freeze({...base,decision:'DENY',planner_allowed:false,reason:'CANDIDATE_REQUIRES_SCHEMA_DETERMINISTIC_ADVERSARIAL_EVIDENCE_AND_REGISTRATION_GATES'});
  }
  if (classification.qualification_class==='FRONTIER_EXPERIMENTAL') {
    return Object.freeze({...base,decision:'DENY',planner_allowed:false,reason:'EXPERIMENTAL_CAPABILITY_REQUIRES_ISOLATED_EVAL_AND_EXPLICIT_AUTHORITY'});
  }
  return Object.freeze({...base,decision:'DENY',planner_allowed:false,reason:'TARGET_OR_UNKNOWN_CAPABILITY_HAS_NO_EXECUTION_AUTHORITY'});
}

export function routeCapabilityV2(objective,{riskClass='S0'}={}){
  const text=clean(objective,2000);
  const explicit=explicitReferenceFromObjective(text);
  if (explicit) {
    const classification=classifyCapabilityReference(explicit);
    const policy=policyFor(classification,{riskClass});
    return Object.freeze({
      schema:'musitu.axiom.capability-route.v2',
      objective:text,
      explicit_reference:explicit,
      qualification_class:classification.qualification_class,
      qualification_reason:classification.reason,
      policy,
      atomic_operations:classification.qualification_class==='CERTIFIED_ATOMIC'?[classification.reference]:[],
      derived_catalog_size:DERIVED_CAPABILITY_COUNT,
      candidate_catalog_size:CAPABILITY_TRUTH.discovered_candidate_dags,
      evidence_requirement:classification.qualification_class==='CERTIFIED_ATOMIC'?'CERTIFIED_OPERATION_EVIDENCE':'QUALIFICATION_GATE_EVIDENCE',
      legacy_preview:null,
    });
  }

  const legacy=routeCapabilityV1(text);
  const atomicValid=legacy.atomic_operations.every(op=>ATOMIC_SET.has(op));
  const classification=atomicValid
    ? Object.freeze({reference:legacy.archetype,qualification_class:'REGISTERED_DERIVED',known:true,reason:'OBJECTIVE_ROUTED_TO_REGISTERED_DERIVED_ARCHETYPE'})
    : Object.freeze({reference:legacy.archetype,qualification_class:'TARGET_ONLY',known:false,reason:'ROUTE_REFERENCED_UNCERTIFIED_ATOMIC_OPERATION'});
  const policy=policyFor(classification,{riskClass});
  return Object.freeze({
    schema:'musitu.axiom.capability-route.v2',
    objective:text,
    explicit_reference:null,
    qualification_class:classification.qualification_class,
    qualification_reason:classification.reason,
    policy,
    archetype:legacy.archetype,
    category:legacy.category,
    intent:legacy.intent,
    atomic_operations:[...legacy.atomic_operations],
    side_effect_class:legacy.side_effect_class,
    derived_catalog_size:legacy.derived_catalog_size,
    candidate_catalog_size:CAPABILITY_TRUTH.discovered_candidate_dags,
    evidence_requirement:legacy.evidence_requirement,
    legacy_preview:legacy,
  });
}

export function assertPlannerRouteAllowed(route){
  if (!route || route.schema!=='musitu.axiom.capability-route.v2') throw new TypeError('route v2 required');
  if (route.policy?.decision!=='PREVIEW_ALLOWED' || route.policy?.planner_allowed!==true) {
    throw new DOMException(route.policy?.reason||'capability route denied','SecurityError');
  }
  return route;
}
