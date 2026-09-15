import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const here=dirname(fileURLToPath(import.meta.url));
const root=resolve(here,'..');
const read=name=>readFile(resolve(root,name),'utf8');

const iso='2026-09-15T06:50:00Z';

function sample(type){
  const fields={
    Project:{goal:'Ship AXIOM',objects:[],work:[],agents:[],artifacts:[],sources:[],memory:{scope:'project'},evidence:[],decisions:[],deployments:[],evaluations:[],failures:[]},
    Work:{objective:'Implement FA-06',acceptance_criteria:[],plan:[],tasks:[],agents:[],capabilities:[],approvals:[],budget:{},deadline:null,checkpoints:[],outputs:[],verification:{}},
    Agent:{identity:{kind:'workload'},role:'builder',purpose:'bounded implementation',tool_scopes:[],data_scopes:[],network_scope:'default-deny',autonomy:'policy-bounded',budget:{},policies:[],model_route:null,status:'idle',history:[],kill_switch:true,evidence:[]},
    Artifact:{artifact_type:'document',versions:[],provenance:[],dependencies:[],diff:[],comments:[],permissions:[],export:{},rollback:{}},
    Evidence:{inputs:[],sources:[],capability_chain:[],calculations:[],actions:[],policies:[],approvals:[],hashes:[],receipts:[],verification:{},failures:[],timestamps:[],versions:[]},
  }[type];
  return {schema:`musitu.axiom.${type.toLowerCase()}.v1`,type,id:`${type.toLowerCase()}_12345678`,version:1,created_at:iso,updated_at:iso,data:fields};
}

test('five permanent AXIOM objects are versioned and runtime validated',async()=>{
  const mod=await import(pathToFileURL(resolve(root,'foundation_contracts.js')).href);
  assert.deepEqual(mod.AXIOM_OBJECT_TYPES,['Project','Work','Agent','Artifact','Evidence']);
  for (const type of mod.AXIOM_OBJECT_TYPES) {
    const candidate=sample(type);
    assert.equal(mod.validateAxiomObject(candidate,{expectedType:type}).ok,true,`${type} should validate`);
    assert.doesNotThrow(()=>mod.assertAxiomObject(candidate,{expectedType:type}));
    const broken=structuredClone(candidate);
    delete broken.data[mod.OBJECT_CONTRACTS[type].required_fields[0]];
    assert.equal(mod.validateAxiomObject(broken,{expectedType:type}).ok,false,`${type} missing field must fail`);
  }
});

test('object contracts reject credential material and envelope widening',async()=>{
  const mod=await import(pathToFileURL(resolve(root,'foundation_contracts.js')).href);
  const project=sample('Project');
  project.data.memory={access_token:'forbidden'};
  assert.equal(mod.validateAxiomObject(project).ok,false);
  const widened=sample('Evidence');
  widened.authority_override='self-granted';
  const result=mod.validateAxiomObject(widened);
  assert.equal(result.ok,false);
  assert.ok(result.errors.some(error=>error.includes('unsupported envelope field')));
});

test('shell registry preserves complete final-product breadth without claiming later phases',async()=>{
  const mod=await import(pathToFileURL(resolve(root,'foundation_contracts.js')).href);
  const ids=new Set(mod.SHELL_SURFACES.map(surface=>surface.id));
  for (const id of ['home','projects','work','agents','research','memory','analyze','twin','artifacts','create','build','computer','live','automations','evidence','trust','developer','marketplace','enterprise','inbox','search','settings']) {
    assert.ok(ids.has(id),`missing shell surface ${id}`);
  }
  for (const id of ['memory','twin','evidence','marketplace','enterprise','inbox']) {
    assert.equal(mod.SHELL_SURFACES.find(surface=>surface.id===id).state,'FOUNDATION_ONLY');
  }
  assert.equal(mod.CLAIM_BOUNDARIES.certified_atomic_operations,74);
  assert.equal(mod.CLAIM_BOUNDARIES.registered_native_derived_compositions,2400);
  assert.equal(mod.CLAIM_BOUNDARIES.discovered_candidate_dags,2235);
  assert.equal(mod.CLAIM_BOUNDARIES.discovered_candidate_dags_certified,false);
  assert.equal(mod.CLAIM_BOUNDARIES.superiority,'NOT_CERTIFIED');
});

test('identity adapter is same-origin, cookie based, fail closed and browser cannot self-grant scopes',async()=>{
  const source=await read('identity_session_adapter.js');
  assert.match(source,/credentials:'include'/);
  assert.match(source,/AbortController/);
  assert.match(source,/endpoint\.origin!==origin/);
  assert.match(source,/browserMayGrant:false/);
  assert.doesNotMatch(source,/localStorage/);
  assert.doesNotMatch(source,/sessionStorage/);

  const mod=await import(pathToFileURL(resolve(root,'identity_session_adapter.js')).href);
  const baseURI='https://axiom.example/app/';
  const origin='https://axiom.example';
  const state=mod.normalizeIdentityPayload({
    schema:'musitu.axiom.browser-session.v1',
    authenticated:true,
    subject:'user:1',
    display_name:'Operator',
    session_id:'server-session-1',
    assurance:'AAL2',
    expires_at:'2099-01-01T00:00:00Z',
    sign_in_path:'/signin',
    sign_out_path:'/signout',
  },{baseURI,origin});
  assert.equal(state.authenticated,true);
  assert.equal(state.authorization.source,'SERVER_ONLY');
  assert.equal(state.authorization.browserMayGrant,false);
  assert.deepEqual(state.authorization.roles,[]);
  assert.throws(()=>mod.normalizeIdentityPayload({
    schema:'musitu.axiom.browser-session.v1',
    authenticated:true,
    subject:'user:1',
    display_name:'Operator',
    session_id:'server-session-1',
    roles:['admin'],
  },{baseURI,origin}),/unsupported authority fields/);
});

test('identity network request uses strict request policy and rejects remote endpoints',async()=>{
  const mod=await import(pathToFileURL(resolve(root,'identity_session_adapter.js')).href);
  let request=null;
  const response={
    ok:true,status:200,
    headers:{get:()=> 'application/json; charset=utf-8'},
    text:async()=>JSON.stringify({schema:'musitu.axiom.browser-session.v1',authenticated:false,sign_in_path:'/signin'})
  };
  const fetchImpl=async(url,options)=>{request={url,options};return response;};
  const state=await mod.readIdentitySession({fetchImpl,baseURI:'https://axiom.example/app/',origin:'https://axiom.example',timeoutMs:500});
  assert.equal(state.authenticated,false);
  assert.equal(request.options.credentials,'include');
  assert.equal(request.options.redirect,'error');
  assert.equal(request.options.cache,'no-store');
  assert.equal(request.options.referrerPolicy,'same-origin');
  assert.match(request.url,/^https:\/\/axiom\.example\//);
});

test('foundation bootstrap adds only truthful foundation surfaces and no direct execution networking',async()=>{
  const [bootstrap,adapter]=await Promise.all([read('foundation_bootstrap.js'),read('data_adapters.js')]);
  assert.doesNotMatch(bootstrap,/\bfetch\s*\(/);
  assert.doesNotMatch(bootstrap,/XMLHttpRequest/);
  assert.doesNotMatch(bootstrap,/WebSocket\s*\(/);
  assert.match(bootstrap,/FOUNDATION ONLY · BACKEND AUTHORITY NOT CLAIMED/);
  assert.match(adapter,/foundation_bootstrap\.js/);
});
