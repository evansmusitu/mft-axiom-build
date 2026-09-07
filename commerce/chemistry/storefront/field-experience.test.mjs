import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FIELD_SCHEMA_SQL,FIELD_EXPERIENCE_JS,routeClass,viewportBucket,quantizeMetric,normalizeTelemetryBatch,computeFieldSnapshot
} from './field-experience.mjs';

const req=(body,headers={})=>new Request('https://payments.mftintelligence.com/chemistry/telemetry/v1',{method:'POST',headers:{'content-type':'application/json','origin':'https://payments.mftintelligence.com',...headers},body:JSON.stringify(body)});

test('route classification strips customer identifiers and query state by construction',()=>{
  const cases=[
    ['/chemistry/','home'],['/chemistry/plans','plans'],['/chemistry/checkout/start','checkout'],['/chemistry/return','status'],['/chemistry/claim','claim'],['/chemistry/support','support'],['/chemistry/privacy','privacy'],['/chemistry/verify','verify'],['/unknown','other']
  ];
  for(const [path,want] of cases) assert.equal(routeClass(path),want);
});

test('viewport buckets are coarse and non-identifying',()=>{
  assert.equal(viewportBucket(320),'mobile');
  assert.equal(viewportBucket(599),'mobile');
  assert.equal(viewportBucket(600),'tablet');
  assert.equal(viewportBucket(899),'tablet');
  assert.equal(viewportBucket(900),'desktop');
});

test('metric values are bounded and quantized for aggregate histograms',()=>{
  assert.equal(quantizeMetric('LCP',1041.4),1050);
  assert.equal(quantizeMetric('INP',187.9),200);
  assert.equal(quantizeMetric('CLS',0.0871),0.09);
  assert.equal(quantizeMetric('LCP',999999),10000);
  assert.equal(quantizeMetric('CLS',99),2);
  assert.equal(quantizeMetric('BAD',12),null);
});

test('telemetry accepts only bounded anonymous allowlisted fields',async()=>{
  const batch=await normalizeTelemetryBatch(req({events:[
    {kind:'vital',name:'LCP',value:1041.4,route:'home',viewport:'mobile'},
    {kind:'event',name:'start_free',route:'home',viewport:'mobile',detail:''}
  ]}));
  assert.equal(batch.length,2);
  assert.deepEqual(Object.keys(batch[0]).sort(),['bucket','detail','kind','name','route','viewport'].sort());
  assert.equal(batch[0].bucket,'1050');
  for(const forbidden of ['id','session','user','email','reference','url','query','referrer','ip','ua','device_id']) assert.equal(JSON.stringify(batch).includes(forbidden),false,forbidden);
});

test('telemetry rejects identifiers, unknown dimensions, oversized batches and cross-origin submissions',async()=>{
  await assert.rejects(()=>normalizeTelemetryBatch(req({events:[{kind:'vital',name:'LCP',value:1000,route:'home',viewport:'mobile',email:'x@example.com'}]})));
  await assert.rejects(()=>normalizeTelemetryBatch(req({events:[{kind:'event',name:'made_up',route:'home',viewport:'mobile'}]})));
  await assert.rejects(()=>normalizeTelemetryBatch(req({events:Array.from({length:17},()=>({kind:'event',name:'page_view',route:'home',viewport:'mobile'}))})));
  await assert.rejects(()=>normalizeTelemetryBatch(req({events:[]},{origin:'https://evil.example'})));
});

test('D1 schema stores aggregate buckets only and has no raw-event identity columns',()=>{
  assert.match(FIELD_SCHEMA_SQL,/chemistry_field_aggregate/);
  assert.match(FIELD_SCHEMA_SQL,/PRIMARY KEY\s*\(day,kind,name,route,detail,viewport,bucket\)/i);
  assert.doesNotMatch(FIELD_SCHEMA_SQL,/\b(ip|email|user_id|session_id|device_id|reference|url|referrer|user_agent)\b/i);
});

test('field client is same-origin, respects privacy signals, and never creates tracking identifiers',()=>{
  assert.match(FIELD_EXPERIENCE_JS,/navigator\.globalPrivacyControl/);
  assert.match(FIELD_EXPERIENCE_JS,/doNotTrack/);
  assert.match(FIELD_EXPERIENCE_JS,/localStorage\.getItem\('musitu_experience_measurement'\)/);
  assert.match(FIELD_EXPERIENCE_JS,/sendBeacon\('\/chemistry\/telemetry\/v1'/);
  assert.doesNotMatch(FIELD_EXPERIENCE_JS,/https?:\/\//);
  assert.doesNotMatch(FIELD_EXPERIENCE_JS,/(randomUUID|Math\.random|sessionStorage|document\.cookie)/);
});

test('public field claims remain withheld until minimum sample and use p75 histogram evidence',()=>{
  const rows=[
    {name:'LCP',bucket:'1000',count:74},{name:'LCP',bucket:'2000',count:25},{name:'LCP',bucket:'3000',count:1},
    {name:'INP',bucket:'100',count:75},{name:'INP',bucket:'200',count:25},
    {name:'CLS',bucket:'0.05',count:75},{name:'CLS',bucket:'0.1',count:25}
  ];
  const snap=computeFieldSnapshot(rows,100);
  assert.equal(snap.metrics.LCP.sample,100);
  assert.equal(snap.metrics.LCP.p75,2000);
  assert.equal(snap.metrics.LCP.claimable,true);
  const small=computeFieldSnapshot([{name:'LCP',bucket:'1000',count:99}],100);
  assert.equal(small.metrics.LCP.claimable,false);
  assert.equal(small.status,'insufficient_field_sample');
});

test('Rescue campaign has a dedicated coarse route class',()=>{
  assert.equal(routeClass('/chemistry/rescue'),'rescue');
});
