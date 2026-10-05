import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OPENTELEMETRY_BACKEND_DESCRIPTOR,
  createOpenTelemetryBackend,
} from '../product_intelligence/backends/opentelemetry_backend.js';

function fakeExporter({fail=false}={}){
  const calls=[];
  const send=async(kind,payload)=>{calls.push({kind,payload:structuredClone(payload)});if(fail)throw new Error('collector unavailable');return {accepted:true,export_id:`export_${kind}_1`};};
  return {calls,exportTrace:p=>send('trace',p),exportMetric:p=>send('metric',p),exportLog:p=>send('log',p),async health(){return {status:'UP'};}};
}

const context={projectId:'project_12345678',workId:'work_12345678',workloadIdentityId:'agent_workload_12345678'};

test('OpenTelemetry backend is mechanism-only and pins the Phase-1.5 Collector baseline',()=>{
  assert.equal(OPENTELEMETRY_BACKEND_DESCRIPTOR.kind,'TelemetryBackend');
  assert.equal(OPENTELEMETRY_BACKEND_DESCRIPTOR.provider,'opentelemetry');
  assert.equal(OPENTELEMETRY_BACKEND_DESCRIPTOR.collector_baseline,'0.162.0');
  assert.equal(OPENTELEMETRY_BACKEND_DESCRIPTOR.semantic_owner,'AXIOM');
  assert.equal(OPENTELEMETRY_BACKEND_DESCRIPTOR.authority,'MECHANISM_ONLY');
  assert.equal(OPENTELEMETRY_BACKEND_DESCRIPTOR.evidence_authority,'NONE');
  assert.equal(OPENTELEMETRY_BACKEND_DESCRIPTOR.live_runtime_qualification,'NOT_PROVEN');
});

test('trace metric and log exports preserve AXIOM project/work identity but never become canonical Evidence',async()=>{
  const exporter=fakeExporter();
  const backend=createOpenTelemetryBackend({exporter,serviceName:'musitu-axiom-pi',environment:'isolated-dev'});
  const trace=await backend.emitTrace({...context,traceId:'1'.repeat(32),spanId:'2'.repeat(16),name:'compiler.diff',status:'OK',attributes:{impact_count:2}});
  const metric=await backend.emitMetric({...context,name:'axiom.compiler.impact.count',value:2,unit:'1',attributes:{phase:'2'}});
  const log=await backend.emitLog({...context,severity:'INFO',body:'compiler checkpoint created',attributes:{checkpoint:'checkpoint_1'}});

  for(const receipt of [trace,metric,log]){
    assert.equal(receipt.project_id,'project_12345678');
    assert.equal(receipt.work_id,'work_12345678');
    assert.equal(receipt.authority_effect,'NONE');
    assert.equal(receipt.canonical_evidence,false);
    assert.equal(receipt.may_certify,false);
    assert.equal(receipt.production_authority,false);
    assert.match(receipt.receipt_sha256,/^[a-f0-9]{64}$/);
  }
  assert.equal(exporter.calls.length,3);
  assert.equal(exporter.calls[0].payload.resource['service.name'],'musitu-axiom-pi');
  assert.equal(exporter.calls[0].payload.resource['deployment.environment.name'],'isolated-dev');
  assert.equal(exporter.calls[0].payload.attributes['axiom.project_id'],'project_12345678');
});

test('telemetry rejects credential material instead of exfiltrating it through attributes or logs',async()=>{
  const backend=createOpenTelemetryBackend({exporter:fakeExporter()});
  await assert.rejects(()=>backend.emitTrace({...context,traceId:'1'.repeat(32),spanId:'2'.repeat(16),name:'x',status:'OK',attributes:{api_key:'secret'}}),/forbidden credential material/);
  await assert.rejects(()=>backend.emitLog({...context,severity:'INFO',body:'x',attributes:{nested:{access_token:'secret'}}}),/forbidden credential material/);
});

test('collector outage is explicit and never converted into a fake telemetry success',async()=>{
  const backend=createOpenTelemetryBackend({exporter:fakeExporter({fail:true})});
  await assert.rejects(()=>backend.emitMetric({...context,name:'axiom.test',value:1,unit:'1'}),/collector unavailable/);
});

test('health remains provider health only and cannot certify AXIOM',async()=>{
  const backend=createOpenTelemetryBackend({exporter:fakeExporter()});
  const health=await backend.health();
  assert.equal(health.provider_status,'UP');
  assert.equal(health.axiom_certification,'NOT_PROVEN');
  assert.equal(health.authority_effect,'NONE');
});
