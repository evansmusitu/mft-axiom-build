import assert from 'node:assert/strict';
import test from 'node:test';
import {OPENFEATURE_EVALUATION_DESCRIPTOR,createOpenFeatureEvaluation} from '../product_intelligence/openfeature_flag_evaluation.js';

test('OpenFeature is a mechanism-only evaluation seam owned by AXIOM',()=>{
  assert.equal(OPENFEATURE_EVALUATION_DESCRIPTOR.standard,'OpenFeature');
  assert.equal(OPENFEATURE_EVALUATION_DESCRIPTOR.semantic_owner,'AXIOM');
  assert.equal(OPENFEATURE_EVALUATION_DESCRIPTOR.authority,'MECHANISM_ONLY');
  assert.equal(OPENFEATURE_EVALUATION_DESCRIPTOR.release_authority,false);
  assert.equal(OPENFEATURE_EVALUATION_DESCRIPTOR.production_authority,false);
  assert.equal(OPENFEATURE_EVALUATION_DESCRIPTOR.certification_authority,false);
  assert.equal(typeof createOpenFeatureEvaluation,'function');
});

function booleanClient(result={}){
  const calls=[];
  return {
    calls,
    async getBooleanDetails(flagKey,defaultValue,context){
      calls.push({flagKey,defaultValue,context:structuredClone(context)});
      return {flagKey,value:true,variant:'enabled',reason:'TARGETING_MATCH',flagMetadata:{source:'test-fixture'},...structuredClone(result)};
    },
  };
}
const baseRequest={
  projectId:'project_12345678',workId:'work_12345678',agentId:'agent_12345678',requestId:'request_12345678',
  flagKey:'engineering.new-workflow',valueType:'boolean',defaultValue:false,
  context:{targetingKey:'subject_12345678',attributes:{environment:'isolated-dev',cohort:'A'}},
};

test('evaluate binds Project Work Agent identity and returns deterministic non-authoritative evidence',async()=>{
  const client=booleanClient();
  const evaluation=createOpenFeatureEvaluation({client,providerName:'test-provider'});
  const one=await evaluation.evaluate(baseRequest);
  const two=await evaluation.evaluate(baseRequest);
  assert.equal(client.calls.length,2);
  assert.deepEqual(client.calls[0].context,{
    targetingKey:'subject_12345678',environment:'isolated-dev',cohort:'A',
    axiom_project_id:'project_12345678',axiom_work_id:'work_12345678',axiom_agent_id:'agent_12345678',axiom_request_id:'request_12345678',
  });
  assert.equal(one.schema,'musitu.axiom.openfeature-evaluation.v1');
  assert.equal(one.project_id,baseRequest.projectId); assert.equal(one.work_id,baseRequest.workId); assert.equal(one.agent_id,baseRequest.agentId);
  assert.equal(one.request_id,baseRequest.requestId); assert.equal(one.flag_key,baseRequest.flagKey); assert.equal(one.value_type,'boolean');
  assert.equal(one.value,true); assert.equal(one.variant,'enabled'); assert.equal(one.reason,'TARGETING_MATCH'); assert.equal(one.provider,'test-provider');
  assert.match(one.evaluation_context_sha256,/^[a-f0-9]{64}$/); assert.match(one.evaluation_sha256,/^[a-f0-9]{64}$/);
  assert.equal(one.evaluation_sha256,two.evaluation_sha256);
  assert.equal(one.canonical_evidence,false); assert.equal(one.authority_effect,'NONE');
  assert.equal(one.release_authority,false); assert.equal(one.production_authority,false); assert.equal(one.certification_authority,false);
  assert.equal(one.required_next_gate,'AXIOM_POLICY_ADMISSION'); assert.equal(one.live_runtime_qualification,'NOT_PROVEN');
});

test('unknown request and evaluation-context schema fields fail closed before provider evaluation',async()=>{
  for(const request of [
    {...baseRequest,unexpected:true},
    {...baseRequest,context:{...baseRequest.context,unexpected:true}},
  ]){
    const client=booleanClient();
    const evaluation=createOpenFeatureEvaluation({client,providerName:'test-provider'});
    await assert.rejects(()=>evaluation.evaluate(request),/unsupported fields/);
    assert.equal(client.calls.length,0);
  }
});

test('evaluation context rejects identity override, authority claims, credentials and malformed values before provider use',async()=>{
  const cases=[
    {attributes:{axiom_project_id:'other_project'}},
    {attributes:{release_authority:true}},
    {attributes:{nested:{api_key:'must-not-cross'}}},
    {attributes:[]},
    {attributes:{bad:Infinity}},
  ];
  for(const context of cases){
    const client=booleanClient();
    const evaluation=createOpenFeatureEvaluation({client,providerName:'test-provider'});
    await assert.rejects(()=>evaluation.evaluate({...baseRequest,context:{targetingKey:'subject_12345678',...context}}));
    assert.equal(client.calls.length,0);
  }
});

test('provider attempts to grant release production or certification authority are rejected',async()=>{
  const cases=[
    {release_authority:true},
    {production_authority:true},
    {certification_authority:true},
    {flagMetadata:{source:'provider',production_authority:true}},
    {flagMetadata:{authority:'RELEASE'}},
  ];
  for(const result of cases){
    const client=booleanClient(result);
    const evaluation=createOpenFeatureEvaluation({client,providerName:'test-provider'});
    await assert.rejects(()=>evaluation.evaluate(baseRequest),/forbidden authority/);
    assert.equal(client.calls.length,1);
  }
});

test('provider error fallbacks, flag identity mismatch and value type mismatch fail closed',async()=>{
  const cases=[
    [{value:false,reason:'ERROR',errorCode:'FLAG_NOT_FOUND',errorMessage:'missing'},/provider error/],
    [{value:false,reason:'ERROR'},/provider error/],
    [{flagKey:'other.flag'},/identity mismatch/],
    [{value:'true'},/boolean value/],
  ];
  for(const [result,pattern] of cases){
    const client=booleanClient(result);
    const evaluation=createOpenFeatureEvaluation({client,providerName:'test-provider'});
    await assert.rejects(()=>evaluation.evaluate(baseRequest),pattern);
    assert.equal(client.calls.length,1);
  }
});

function typedClient(){
  const calls=[];
  const make=(method,value)=>async(flagKey,defaultValue,context)=>{calls.push({method,flagKey,defaultValue,context:structuredClone(context)});return {flagKey,value,variant:'v1',reason:'STATIC',flagMetadata:{source:'typed-fixture'}};};
  return {
    calls,
    getBooleanDetails:make('boolean',true),
    getStringDetails:make('string','treatment'),
    getNumberDetails:make('number',0.25),
    getObjectDetails:make('object',{mode:'new',limits:{max:3}}),
  };
}

test('standard boolean string number and object evaluations preserve AXIOM semantics and deterministic evidence',async()=>{
  const client=typedClient();
  const evaluation=createOpenFeatureEvaluation({client,providerName:'typed-provider'});
  const cases=[
    ['boolean',false,true,'boolean'],
    ['string','control','treatment','string'],
    ['number',0,0.25,'number'],
    ['object',{mode:'safe'},{mode:'new',limits:{max:3}},'object'],
  ];
  for(const [valueType,defaultValue,expected,method] of cases){
    const request={...baseRequest,flagKey:'flag.'+valueType,valueType,defaultValue};
    const one=await evaluation.evaluate(request); const two=await evaluation.evaluate(request);
    assert.deepEqual(one.value,expected); assert.equal(one.value_type,valueType); assert.equal(one.evaluation_sha256,two.evaluation_sha256);
    assert.equal(client.calls.at(-2).method,method);
  }
});

test('AXIOM invocation guard detects identity tampering before and after provider resolution',async()=>{
  for(const stage of ['before','after']){
    const client={
      async getBooleanDetails(flagKey,defaultValue,context,options){
        const hook=options?.hooks?.[0];
        assert.ok(hook,'identity guard hook required');
        const good={context:structuredClone(context)};
        if(stage==='before') hook.before({context:{...good.context,axiom_project_id:'other_project'}});
        hook.before(good);
        const details={flagKey,value:true,variant:'enabled',reason:'STATIC'};
        if(stage==='after') hook.after({context:{...good.context,axiom_agent_id:'other_agent'}},details);
        return details;
      },
    };
    const evaluation=createOpenFeatureEvaluation({client,providerName:'guard-provider'});
    await assert.rejects(()=>evaluation.evaluate(baseRequest),/identity binding mismatch/);
  }
});

test('provider metadata is normalized into deterministic evidence and credential material fails closed',async()=>{
  const client=booleanClient({flagMetadata:{source:'provider',rollout:25,nested:{lane:'alpha'}}});
  const evaluation=createOpenFeatureEvaluation({client,providerName:'metadata-provider'});
  const one=await evaluation.evaluate(baseRequest);
  const two=await evaluation.evaluate(baseRequest);
  assert.deepEqual(one.provider_metadata,{nested:{lane:'alpha'},rollout:25,source:'provider'});
  assert.equal(one.evaluation_sha256,two.evaluation_sha256);

  const bad=booleanClient({flagMetadata:{nested:{api_key:'must-not-leak'}}});
  await assert.rejects(
    ()=>createOpenFeatureEvaluation({client:bad,providerName:'metadata-provider'}).evaluate(baseRequest),
    /forbidden credential material/,
  );
});

test('provider variant and reason must follow the OpenFeature string contract',async()=>{
  for(const [result,pattern] of [
    [{variant:{name:'bad'}},/variant must be a string/],
    [{reason:['STATIC']},/reason must be a string/],
  ]){
    const client=booleanClient(result);
    const evaluation=createOpenFeatureEvaluation({client,providerName:'shape-provider'});
    await assert.rejects(()=>evaluation.evaluate(baseRequest),pattern);
    assert.equal(client.calls.length,1);
  }
});

test('identity guard rejects SDK-merged context additions so AXIOM invocation context is exact',async()=>{
  const client={
    calls:[],
    async getBooleanDetails(flagKey,defaultValue,context,options){
      this.calls.push({flagKey,defaultValue,context:structuredClone(context)});
      const hook=options?.hooks?.[0];
      assert.ok(hook,'identity guard hook required');
      hook.before({context:{...structuredClone(context),release_authority:true}});
      return {flagKey,value:true,variant:'enabled',reason:'STATIC'};
    },
  };
  const evaluation=createOpenFeatureEvaluation({client,providerName:'merged-context-provider'});
  await assert.rejects(()=>evaluation.evaluate(baseRequest),/identity binding mismatch|reserved AXIOM identity or authority/);
  assert.equal(client.calls.length,1);
});

test('provider identity is bound to OpenFeature client metadata and provider swaps fail closed',async()=>{
  let providerName='provider-a';
  const client=booleanClient();
  Object.defineProperty(client,'metadata',{get(){return {sdk:'js-server',paradigm:'server',providerMetadata:{name:providerName}};}});
  const evaluation=createOpenFeatureEvaluation({client,providerName:'provider-a'});
  const good=await evaluation.evaluate(baseRequest);
  assert.equal(good.provider,'provider-a');
  providerName='provider-b';
  await assert.rejects(()=>evaluation.evaluate(baseRequest),/provider identity mismatch/);
});
