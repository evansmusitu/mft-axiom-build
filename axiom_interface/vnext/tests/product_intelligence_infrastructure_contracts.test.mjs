import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REQUIRED_INFRASTRUCTURE_ADAPTERS,
  validateAdapterDescriptor,
  assertAdapterDescriptor,
  unavailableAdapterState,
} from '../product_intelligence/infrastructure_contracts.js';

const fakeDescriptor=(overrides={})=>({
  kind:'PersistenceBackend',
  adapter_version:'1.0.0',
  provider:'fake-memory',
  semantic_owner:'AXIOM',
  authority:'MECHANISM_ONLY',
  capabilities:['load','commit','verify','export'],
  unsupported_operations:['production_mutation'],
  timeout_ms:1000,
  retry:{max_attempts:1,backoff:'NONE'},
  idempotency:{mode:'REQUIRED_FOR_WRITES'},
  data_classification:['project-private'],
  egress:{required:false,allowed_origins:[]},
  identity_binding:{required:true,mode:'AXIOM_WORKLOAD_ID'},
  evidence_envelope:{schema:'musitu.axiom.evidence.v1',required:true},
  health:{mode:'EXPLICIT'},
  migration_export:{supported:true,format:'JSONL'},
  fail_closed:true,
  ...overrides,
});

test('Phase-2 adapter registry freezes every required infrastructure seam',()=>{
  assert.deepEqual(REQUIRED_INFRASTRUCTURE_ADAPTERS,[
    'PersistenceBackend','VectorIndexBackend','DurableWorkBackend','TelemetryBackend','PolicyDecisionPoint',
    'SecretBroker','WorkloadIdentityProvider','SandboxBackend','ObjectStoreBackend','EventBusBackend',
    'AnalyticsWarehouseBackend','ExperimentEngineBackend','EngineeringWorkerBackend','DesignInteropBackend',
    'DeploymentBackend','RuntimeSecurityBackend','AccessibilityScannerBackend','RealityBrowserBackend',
  ]);
});

test('adapter descriptors require AXIOM semantic ownership and explicit failure semantics',()=>{
  assert.equal(validateAdapterDescriptor(fakeDescriptor()).ok,true);
  assert.doesNotThrow(()=>assertAdapterDescriptor(fakeDescriptor(),{expectedKind:'PersistenceBackend'}));

  const vendorOwned=validateAdapterDescriptor(fakeDescriptor({semantic_owner:'Temporal'}));
  assert.equal(vendorOwned.ok,false);
  assert.ok(vendorOwned.errors.includes('semantic_owner must equal AXIOM'));

  const openFallback=validateAdapterDescriptor(fakeDescriptor({fail_closed:false}));
  assert.equal(openFallback.ok,false);
  assert.ok(openFallback.errors.includes('fail_closed must be true'));
});

test('adapter descriptors reject credential material and incomplete contracts',()=>{
  const credential=validateAdapterDescriptor(fakeDescriptor({health:{mode:'EXPLICIT',api_key:'secret'}}));
  assert.equal(credential.ok,false);
  assert.ok(credential.errors.some(error=>error.includes('forbidden credential material')));

  const incomplete=fakeDescriptor();
  delete incomplete.idempotency;
  const result=validateAdapterDescriptor(incomplete);
  assert.equal(result.ok,false);
  assert.ok(result.errors.includes('idempotency is required'));
});

test('unavailable adapters fail closed instead of silently degrading authority',()=>{
  const state=unavailableAdapterState('DesignInteropBackend',{reason:'provider_down'});
  assert.deepEqual(state,{
    kind:'DesignInteropBackend',
    status:'UNAVAILABLE',
    evidence_state:'NOT_PROVEN',
    silent_fallback:false,
    authority_effect:'NONE',
    reason:'provider_down',
  });
});
