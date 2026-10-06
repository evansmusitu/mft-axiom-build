import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createOpenFeatureEvaluation} from '../product_intelligence/openfeature_flag_evaluation.js';

const sdkRoot=process.argv[2];
if(!sdkRoot) throw new TypeError('OpenFeature SDK package root argument required');
const pkg=JSON.parse(await fs.readFile(path.join(sdkRoot,'package.json'),'utf8'));
assert.equal(pkg.name,'@openfeature/server-sdk');
assert.equal(pkg.version,'1.23.0');
const sdk=await import(pathToFileURL(path.join(sdkRoot,'dist/esm/index.js')).href);
const {OpenFeature}=sdk;
assert.ok(OpenFeature,'OpenFeature export required');

class QualificationProvider {
  runsOn='server';
  metadata={name:'axiom-qualification-provider'};
  mode='normal';
  seen=[];
  async resolveBooleanEvaluation(flagKey,defaultValue,context){
    this.seen.push(structuredClone(context));
    if(this.mode==='authority') return {value:true,variant:'enabled',reason:'STATIC',flagMetadata:{production_authority:true}};
    if(this.mode==='error') return {value:defaultValue,reason:'ERROR',errorCode:'GENERAL',errorMessage:'forced qualification error'};
    return {value:true,variant:'enabled',reason:'TARGETING_MATCH',flagMetadata:{source:'real-openfeature-1.23.0'}};
  }
  async resolveStringEvaluation(flagKey,defaultValue,context){return {value:'treatment',variant:'v1',reason:'STATIC'};}
  async resolveNumberEvaluation(flagKey,defaultValue,context){return {value:0.25,variant:'v1',reason:'STATIC'};}
  async resolveObjectEvaluation(flagKey,defaultValue,context){return {value:{mode:'new'},variant:'v1',reason:'STATIC'};}
}

const provider=new QualificationProvider();
await OpenFeature.setProviderAndWait(provider);
const client=OpenFeature.getClient();
const evaluation=createOpenFeatureEvaluation({client,providerName:provider.metadata.name});
const request={
  projectId:'project_qualification',workId:'work_qualification',agentId:'agent_qualification',requestId:'request_qualification',
  flagKey:'qualification.boolean',valueType:'boolean',defaultValue:false,
  context:{targetingKey:'subject_qualification',attributes:{environment:'isolated-ephemeral-ci'}},
};

const first=await evaluation.evaluate(request);
const second=await evaluation.evaluate(request);
assert.equal(first.value,true);
assert.equal(first.provider,provider.metadata.name);
assert.equal(first.project_id,request.projectId);
assert.equal(first.work_id,request.workId);
assert.equal(first.agent_id,request.agentId);
assert.equal(first.canonical_evidence,false);
assert.equal(first.release_authority,false);
assert.equal(first.production_authority,false);
assert.equal(first.certification_authority,false);
assert.equal(first.evaluation_sha256,second.evaluation_sha256);
assert.deepEqual(provider.seen[0],{
  targetingKey:'subject_qualification',environment:'isolated-ephemeral-ci',
  axiom_project_id:'project_qualification',axiom_work_id:'work_qualification',axiom_agent_id:'agent_qualification',axiom_request_id:'request_qualification',
});

OpenFeature.setContext({rogue_global:'must-fail'});
await assert.rejects(()=>evaluation.evaluate({...request,requestId:'request_merged_context'}),/provider error|identity binding mismatch/i);
OpenFeature.setContext({});

provider.mode='authority';
await assert.rejects(()=>evaluation.evaluate({...request,requestId:'request_authority'}),/forbidden authority/i);
provider.mode='error';
await assert.rejects(()=>evaluation.evaluate({...request,requestId:'request_provider_error'}),/provider error/i);
provider.mode='normal';

assert.equal(evaluation.descriptor.qualification_baseline,'1.23.0');
assert.equal(evaluation.descriptor.semantic_owner,'AXIOM');
assert.equal(evaluation.descriptor.authority,'MECHANISM_ONLY');
assert.equal(evaluation.descriptor.live_runtime_qualification,'NOT_PROVEN');
console.log('MUSITU_AXIOM_OPENFEATURE_1_23_0_MECHANISM_QUALIFICATION_PASS');
console.log('LIVE_INTEGRATED_RUNTIME_QUALIFICATION=NOT_PROVEN');
console.log('RELEASE_AUTHORITY=FALSE');
console.log('PRODUCTION_AUTHORITY=FALSE');
console.log('CERTIFICATION_AUTHORITY=FALSE');
