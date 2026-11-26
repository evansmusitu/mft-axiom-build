// Real local workerd/SQLite/R2; ephemeral test signer and synthetic GitHub ONLY.
// Never provider or custody acceptance. Production bundle key is not replaced.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {mkdtemp,readFile,rm,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash,generateKeyPairSync,createPublicKey} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const stage=resolve(process.env.A2_OPERATOR_STAGE??''),deps=resolve(process.env.A2_OPERATOR_DEPS??'');
assert(process.env.A2_OPERATOR_STAGE&&process.env.A2_OPERATOR_DEPS,'Dedicated test build/dependencies are required; no silent skipping');
const require=createRequire(join(deps,'package.json')), {Miniflare}=require('miniflare'),{build}=require('esbuild');
const load=f=>import(pathToFileURL(join(stage,f)).href);
const {PIN,canonical,ACCOUNT,SERVING_SHA}=await load('pins.mjs');
const {scheduleWindow,eventPlan,operatorKey,PrivateOperatorRunner,publicEnvelope,validateHostedPayload}=await load('operator_core.mjs');
const {requireOwnerContext}=await load('operator_cli.mjs');
const H=x=>createHash('sha256').update(x).digest('hex');
const payload=JSON.parse(await readFile(join(stage,'payload.json'),'utf8'));

test('public inspection and actual full-mode refusal happen before key/provider access',()=>{
 assert.throws(()=>requireOwnerContext({},'linux'),/A2OP_OWNER_WINDOWS_CONTEXT_REQUIRED_HOLD/);assert.throws(()=>requireOwnerContext({GITHUB_ACTIONS:'true'},'win32'),/A2OP_OWNER_WINDOWS_CONTEXT_REQUIRED_HOLD/);assert.throws(()=>requireOwnerContext({NODE_OPTIONS:'--require=private'},'win32'),/A2OP_RUNTIME_OVERRIDE_HOLD/);
 const r=spawnSync(process.execPath,[join(stage,'operator_cli.mjs'),'x','y'],{encoding:'utf8',env:{...process.env,CI:'true'}});assert.equal(r.status,2);assert.match(r.stdout,/A2OP_OWNER_WINDOWS_CONTEXT_REQUIRED_HOLD/);assert(!r.stdout.includes('PRIVATE'));
 const i=spawnSync(process.execPath,[join(stage,'operator_cli.mjs'),'--inspect'],{encoding:'utf8'});assert.equal(i.status,0);const x=JSON.parse(i.stdout);assert.equal(x.provider_requests,0);assert.equal(x.private_input_read,false);
});
test('private windows are future staged and below the reviewed15-minute execution duration; qualification events form a monotonic plan',()=>{
 const now=Date.UTC(2026,10,26,23,50),w=scheduleWindow(now);assert(w.scheduled_ms-now>=17*60000);assert(w.not_after_ms-w.not_before_ms<=900000);assert(w.not_before_ms<w.scheduled_ms&&w.not_after_ms>w.scheduled_ms);assert.match(w.cron,/^\d+ \d+ \d+ \d+ \*$/);
 const e=eventPlan();assert.equal(e.length,4);for(let i=0;i<4;i++){assert.equal(e[i].sequence,i);assert.equal(e[i].previous_head,i?e[i-1].head:'0'.repeat(64));assert.equal(e[i].namespace,PIN.namespace);}
});
test('the existing encrypted key is required and a generated test key cannot impersonate the approved signer',async()=>{
 const root=await mkdtemp(join(tmpdir(),'a2-key-negative-'));try{const pair=generateKeyPairSync('ed25519');const pem=pair.privateKey.export({format:'pem',type:'pkcs8',cipher:'aes-256-cbc',passphrase:'synthetic-pass'});const path=join(root,'test.pem');await writeFile(path,pem);assert.throws(()=>operatorKey(path,'synthetic-pass',join(root,'packet')),/A2OP_SIGNER_DECRYPTION_OR_PIN_HOLD/);assert.throws(()=>operatorKey(path,'wrong',join(root,'packet')),/A2OP_SIGNER_DECRYPTION_OR_PIN_HOLD/);}finally{await rm(root,{recursive:true,force:true});}
});
test('an invalid hosted signature cannot become a passed operator result',()=>{
 assert.throws(()=>publicEnvelope({payload:{},signature:'a'.repeat(86)},'HOSTED_CASES','f'.repeat(64),'e'.repeat(64)),/A2OP_HOSTED_SIGNATURE_HOLD/);
});
test('a denied initial repository/provider read never starts an upload or claims a pass',async()=>{
 const root=await mkdtemp(join(tmpdir(),'a2-predecessor-'));try{await mkdir(join(root,'RETURN_ONLY'));const pair=generateKeyPairSync('ed25519');const t={credential:{secret:'PRIVATE_TEST_CF_SECRET'},githubToken:'PRIVATE_TEST_GH_SECRET',async gh(){throw Error('PRIVATE_PROVIDER_BODY');},cfCount:0,ghCount:0,mutations:0,async cf(){throw Error('PRIVATE_PROVIDER_BODY');}};
 const r=new PrivateOperatorRunner({transport:t,work:root,payload,key:{key:pair.privateKey,jwk:pair.privateKey.export({format:'jwk'})},githubReadToken:'PRIVATE_READ_TEST_SECRET',ask:()=>{throw Error('must not ask');},progress:()=>{},wait:async()=>{}});const result=await r.run();assert.equal(result.success,false);assert.equal(result.gate3_closed,false);assert.equal(t.mutations,0);const out=await readFile(join(root,'RETURN_ONLY','OWNER_OPERATOR_EXECUTION_RECEIPT.json'),'utf8');for(const v of ['PRIVATE_TEST_CF_SECRET','PRIVATE_PROVIDER_BODY','PRIVATE_TEST_GH_SECRET','PRIVATE_READ_TEST_SECRET'])assert(!out.includes(v));}finally{await rm(root,{recursive:true,force:true});}
});

async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'a2-hosted-model-'));
 const pair=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']),jwk=await crypto.subtle.exportKey('jwk',pair.privateKey),pin={...PIN,public_key_jwk:{kty:'OKP',crv:'Ed25519',x:jwk.x}};
 const originalPins=await readFile(join(stage,'pins.mjs'),'utf8');
 const bundle=await build({absWorkingDir:stage,entryPoints:['private_hosted_harness.mjs'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',plugins:[{name:'test-only-ephemeral-public-key',setup(b){b.onLoad({filter:/[/\\]pins\.mjs$/},()=>({contents:originalPins.replace(PIN.public_key_jwk.x,jwk.x),loader:'js'}));}}]});
 assert((await readFile(join(stage,'hosted-harness.js'),'utf8')).includes(PIN.public_key_jwk.x),'Production artifact must retain approved key, not the ephemeral test key');
 const events=eventPlan(),anchorPin={repository:'evansmusitu/mft-axiom-qualification-isolated-20260913',repository_id:1368351153,namespace:pin.namespace,target_commitish:'a'.repeat(40)},genesisPin={...anchorPin,namespace:pin.namespace+'-pre'};
 const genesis={schema:'musitu.axiom.authority2.pre-genesis-commitment.v1',ledger_sequence:0,kind:'AUTHORITY2_PREGENESIS',...pin,reviewed_bundle_sha256:SERVING_SHA,genesis_nonce:'f'.repeat(64),initial_sequence:-1,initial_head:'0'.repeat(64)},genesisSha=H(canonical(genesis));
 const rows=new Map();
 function proof(a,p,id){const tag=a.namespace+'-'+String(p.ledger_sequence).padStart(12,'0'),bytes=canonical({schema:'musitu.axiom.github-checkpoint.v1',pin:a,payload:p});const digest='sha256:'+H(bytes),v={schema:'musitu.axiom.github-checkpoint.v1',repository_id:a.repository_id,namespace:a.namespace,tag,release_id:id,asset_digest:digest};rows.set(id,{id,immutable:true,draft:false,tag_name:tag,assets:[{name:'checkpoint.json',state:'uploaded',size:new TextEncoder().encode(bytes).length,digest}]});return v;}
 const gp=proof(genesisPin,genesis,10),anchorPayloads=events.map((e,i)=>({kind:'DISPOSABLE_HOSTED_QUALIFICATION_EVENT',ledger_sequence:i,...e})),anchors=anchorPayloads.map((e,i)=>proof(anchorPin,e,100+i));
 const github=async req=>{assert.equal(req.method,'GET');const u=new URL(req.url);assert.equal(u.origin,'https://api.github.com');const path=u.pathname,root='/repos/'+anchorPin.repository;if(path===root)return Response.json({id:anchorPin.repository_id,full_name:anchorPin.repository,private:true});const m=path.match(/\/releases\/(\d+)$/);if(m)return Response.json(rows.get(+m[1]));if(path.startsWith(root+'/git/ref/tags/')){const tag=path.split('/').at(-1);return Response.json({ref:'refs/tags/'+tag,object:{type:'commit',sha:anchorPin.target_commitish}});}throw Error('unexpected synthetic provider route');};
 const now=Date.now(),window={approved_cron:'* * * * *',not_before_ms:now-10000,not_after_ms:now+600000};const roles={read:'r'.repeat(40),write:'w'.repeat(40)};
 const base={HW_CONFIG_JSON:JSON.stringify(pin),HW_SIGNING_JWK:JSON.stringify(jwk),HW_ROLE_TOKEN_SHA256_JSON:JSON.stringify({read:H(roles.read),write:H(roles.write)})};
 const init={...base,HW_GENESIS_CONTROL_TOKEN:'g'.repeat(40),HW_GENESIS_GITHUB_READ_TOKEN:'synthetic-checkpoint-read-only',HW_GENESIS_CONTROL_JSON:JSON.stringify({schema:'musitu.axiom.authority2.private-genesis-control.v1',...window,expected_commitment_sha256:genesisSha,anchor_pin:genesisPin,commitment:genesis,anchor_proof:gp})};
 let settings={name:'a2-operator-real-local-runtime',modules:true,script:Buffer.from(payload.bundles.initializer.base64,'base64').toString(),compatibilityDate:'2026-07-01',cf:false,durableObjects:{HIGHWATER_STATE:{className:'Authority2Highwater',useSQLite:true}},r2Buckets:['HIGHWATER_WORM'],durableObjectsPersist:join(dir,'do'),r2Persist:join(dir,'r2'),bindings:init,outboundService:github};
 const mf=new Miniflare(settings);t.after(async()=>{await mf.dispose();await rm(dir,{recursive:true,force:true});});
 const schedule=async()=>{const worker=await mf.getWorker();return worker.scheduled({cron:'* * * * *',scheduledTime:new Date()});};
 assert.equal((await schedule()).outcome,'ok');
 const plan={schema:'musitu.axiom.authority2.private-hosted-plan.v1',phase:'HOSTED_CASES',nonce:'b'.repeat(64),genesis_sha256:genesisSha,cron:'* * * * *',not_before_ms:now-10000,not_after_ms:now+600000,events,anchors,anchor_payloads:anchorPayloads,anchor_pin:anchorPin,read_token:roles.read,write_token:roles.write};
 const env={...base,HW_GENESIS_CONTROL_TOKEN:'g'.repeat(40),HW_GENESIS_GITHUB_READ_TOKEN:'synthetic-checkpoint-read-only',HW_GENESIS_CONTROL_JSON:JSON.stringify(plan)};
 // Production HTTP stays closed. This separate test-only entry invokes the
 // same scheduler function with local scheduler context, not a production route.
 // The exact approved initializer above runs through real workerd.scheduled().
 const entry=join(dir,'test-entry.mjs');await writeFile(entry,`export {Authority2Highwater} from ${JSON.stringify(join(stage,'private_hosted_harness.mjs'))};import {runHosted} from ${JSON.stringify(join(stage,'private_hosted_harness.mjs'))};export default{async fetch(r,e){if(new URL(r.url).pathname!=='/__local_test_schedule__')return new Response('NO_ROUTE',{status:404});try{const result=await runHosted({noRetry(){},cron:'* * * * *',scheduledTime:Date.now()},e);return Response.json({outcome:'ok',result});}catch(x){return Response.json({outcome:'exception',code:x.code??'UNKNOWN'},{status:200});}}};`);
 const testBundle=await build({absWorkingDir:stage,entryPoints:[entry],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',plugins:[{name:'test-ephemeral-key-only',setup(b){b.onLoad({filter:/[/\\]pins\.mjs$/},()=>({contents:originalPins.replace(PIN.public_key_jwk.x,jwk.x),loader:'js'}));}}]});
 let result,error;
 const localRun=async()=>{const r=await mf.dispatchFetch('https://private.invalid/__local_test_schedule__'),d=await r.json();result=d.result;error=d.code;return d;};
 settings={...settings,script:testBundle.outputFiles[0].text,bindings:env};await mf.setOptions(settings);
 return {mf,schedule:localRun,plan,env,pin,roles,async update(planChange={},registry,extraEnv={}){const p={...plan,...planChange};settings={...settings,bindings:{...env,...extraEnv,...(registry?{HW_ROLE_TOKEN_SHA256_JSON:JSON.stringify(registry)}:{}),HW_GENESIS_CONTROL_JSON:JSON.stringify(p)}};await mf.setOptions(settings);return p;},async error(){return error;},async result(){return result;},async emulateRetention(){
  // Miniflare does not enforce real Cloudflare account bucket locks. For this
  // single dependency, wrap deletion only for NEW lock-canary keys. All other
  // R2 operations remain actual workerd/R2. This cannot qualify hosted locks.
  const source=testBundle.outputFiles[0].text.replace('this.env.HIGHWATER_WORM,free=', 'this.env.HIGHWATER_WORM,free=');
  const target="await b.delete(locked);";assert(source.includes(target));settings={...settings,script:source.replace(target,"throw Error('SYNTHETIC_BUCKET_LOCK_ONLY');")};await mf.setOptions(settings);
 }};
}

test('actual local private controller executes disposable faults/recovery and live role replacement; only account lock/GitHub remain synthetic',{timeout:120000},async t=>{
 const f=await fixture(t);await f.emulateRetention();assert.equal((await f.mf.dispatchFetch('https://private.invalid/__private_operator/qualified-disposable-tests')).status,404);
 const out=await f.schedule();assert.equal(out.outcome,'ok',JSON.stringify(await f.error()));const signed=await f.result();assert.equal(signed.payload.cases.length,10);assert(signed.payload.cases.every(x=>x.status==='PASS'));assert.equal(signed.payload.gate3_closed,false);
 const next={read:'n'.repeat(40),write:'v'.repeat(40)};await f.update({phase:'REVOCATION',old_read_token:f.roles.read,old_write_token:f.roles.write,read_token:next.read,write_token:next.write},{read:H(next.read),write:H(next.write)});assert.equal((await f.schedule()).outcome,'ok');const revoked=await f.result();assert.equal(revoked.payload.cases.length,2);assert(revoked.payload.cases.every(x=>x.status==='PASS'));
});
test('an actual local unlocked bucket cannot be mistaken for hosted indefinite retention',{timeout:120000},async t=>{
 const f=await fixture(t);const result=await f.schedule();assert.equal(result.outcome,'exception');assert.equal(await f.result(),undefined);
});
test('late cron cannot start hosted mutations',{timeout:120000},async t=>{
 const f=await fixture(t);await f.update({not_before_ms:1,not_after_ms:2});assert.equal((await f.schedule()).outcome,'exception');assert.equal(await f.result(),undefined);
});

test('a changed qualification account cannot start a hosted mutation',{timeout:120000},async t=>{
 const f=await fixture(t);await f.update({},null,{HW_CONFIG_JSON:JSON.stringify({...f.pin,account_id:'f'.repeat(32)})});assert.equal((await f.schedule()).outcome,'exception');assert.equal(await f.result(),undefined);
});
test('production harness HTTP has no operator route or access to private bindings',async()=>{
 const m=await load('private_hosted_harness.mjs'),env=new Proxy({},{get(){throw Error('private binding accessed');}});
 for(const path of ['/','/__private_operator/qualified-disposable-tests','/__local_test_schedule__','/v1/highwater/append'])for(const method of ['GET','POST']){const r=await m.default.fetch(new Request('https://closed.invalid'+path,{method}),env);assert.equal(r.status,404);assert.equal((await r.json()).dispatch_allowed,false);}
});
async function withRunner(t,transport){const root=await mkdtemp(join(tmpdir(),'a2-runner-unit-'));await mkdir(join(root,'RETURN_ONLY'));t.after(()=>rm(root,{recursive:true,force:true}));const pair=generateKeyPairSync('ed25519');return new PrivateOperatorRunner({transport:{credential:{secret:'SYNTHETIC_PRIVATE_CF'},githubToken:'SYNTHETIC_PRIVATE_GH',...transport},work:root,payload,key:{key:pair.privateKey,jwk:pair.privateKey.export({format:'jwk'})},githubReadToken:'SYNTHETIC_PRIVATE_READ',ask:async()=>null,progress:()=>{},wait:async()=>{}});}
function liveGh(path){
 if(path.endsWith('/branches/main'))return {data:{commit:{sha:'c3c5aaab90e94f1ca84ac9903f9d481c23c4f350'}}};
 const n=Number(path.split('/').at(-1));if([1,192,251].includes(n))return {data:{number:n,state:'open',draft:true,merged:false,head:{sha:n===1?'8fc1fbb7c5ebbcc1604ecf24c5f4594f2d5667e3':n===192?payload.approved_source_commit:payload.source_commit}}};
 if(path.includes('/actions/runs?'))return {data:{total_count:1,workflow_runs:[{path:'.github/workflows/axiom-a2-owner-online-operator-20261126.yml',head_sha:payload.source_commit,id:123,status:'completed',conclusion:'success'}]}};
 if(path.endsWith('/123/jobs?filter=latest&per_page=100'))return {data:{total_count:2,jobs:['local-runtime-and-build','native-windows-public-validation'].map(name=>({name,conclusion:'success'}))}};
 throw Error('unexpected route');
}
test('live source gate requires preserved PR1, exact source and actual completed native CI',async t=>{
 const r=await withRunner(t,{gh:async(method,path)=>{assert.equal(method,'GET');return liveGh(path);}});assert.equal((await r.liveSourceGate()).hosted_proof_inferred_from_CI,false);
 for(const target of ['main','pr1','ci']){r.t.gh=async(method,path)=>{const out=liveGh(path);if(target==='main'&&path.endsWith('/branches/main'))out.data.commit.sha='f'.repeat(40);if(target==='pr1'&&path.endsWith('/pulls/1'))out.data.merged=true;if(target==='ci'&&path.includes('/actions/runs?'))out.data.workflow_runs[0].conclusion='failure';return out;};await assert.rejects(r.liveSourceGate(),/A2OP_(LIVE_MAIN_DRIFT|LIVE_PR_DRIFT|SOURCE_CI_NOT_PASSED)_HOLD/);}
});
test('owner positive control discards its returned capability, never uploads code and cannot pass with a read-only credential',async t=>{
 const calls=[],r=await withRunner(t,{async cf(method,path){calls.push({method,path});return method==='GET'?{status:404}:{status:200,data:{jwt:'SYNTHETIC_PRIVATE_JWT_'+ 'a'.repeat(30)}};}});
 const result=await r.ownerWriteControl();assert.equal(result.capability_used_or_exported,false);assert.equal(calls.filter(x=>x.method==='POST').length,1);assert(calls.every(x=>x.path.includes('axiom-a2-op-authcheck-')));assert(!JSON.stringify(result).includes('SYNTHETIC_PRIVATE_JWT'));
 r.t.cf=async m=>{if(m==='POST')throw Error('A2OP_PROVIDER_STATUS_HOLD');return {status:404};};await assert.rejects(r.ownerWriteControl(),/A2OP_PROVIDER_STATUS_HOLD/);
});
test('an uncertain upload is not retried and marks mandatory cleanup; a counterfeit prior journal cannot authorize retirement',async t=>{
 let mutations=0;const r=await withRunner(t,{async cf(method){if(method!=='GET')mutations++;throw Error('A2OP_REQUEST_AMBIGUOUS_HOLD');}});await assert.rejects(r.upload('initializer'),/A2OP_REQUEST_AMBIGUOUS_HOLD/);assert.equal(mutations,1);assert.equal(r.created,true);
 const fake={payload:{schema:'musitu.axiom.authority2.operator-request-journal.v1',source_commit:payload.source_commit,pin:PIN,rows:[{provider:'cf',method:'PUT',path:'/accounts/'+PIN.account_id+'/workers/scripts/axiom-security-authority2-highwater'}]},signature_base64url:'a'.repeat(86)};await assert.rejects(r.cleanupOnly(fake),/A2OP_OWNED_JOURNAL_REQUIRED_HOLD/);assert.equal(mutations,1);
});
test('active-version opaque ETag must bind the downloaded exact source bytes and stay stable',async t=>{
 const version='12345678-1234-1234-1234-123456789abc',deploy={deployments:[{id:'test-deployment',versions:[{version_id:version,percentage:100}]}]},content=Buffer.from('SYNTHETIC_SOURCE_BYTES'),etag='provider-opaque-etag';
 const r=await withRunner(t,{async cf(method,path){assert.equal(method,'GET');if(path.endsWith('/settings'))return {data:{bindings:[]}};if(path.endsWith('/deployments'))return {data:deploy};if(path.includes('/versions/'))return {data:{id:version,resources:{script:{etag}}}};if(path.endsWith('/content'))return {data:content,headers:new Headers({'content-type':'application/javascript'})};if(path.endsWith('/subdomain'))return {data:{enabled:false,previews_enabled:false}};if(path.endsWith('/domains'))return {data:[]};if(path.startsWith('/zones?'))return {data:[],result_info:{page:1,total_count:0}};throw Error('unexpected source route');}});
 assert.equal((await r.sourceEvidence(H(content),etag)).bundle_sha256,H(content));await assert.rejects(r.sourceEvidence(H(content),'other-etag'),/A2OP_VERSION_UPLOAD_ETAG_BINDING_HOLD/);await assert.rejects(r.sourceEvidence('f'.repeat(64),etag),/A2OP_DEPLOYED_BYTES_MISMATCH_HOLD/);
});
test('duplicate hosted case names or upgraded governance flags cannot become completed results',()=>{
 const cases=['provider_backed_old_role_credentials_denied','new_roles_operate_and_consumed_sequence_still_denied'].map(name=>({name,status:'PASS'})),p={schema:'musitu.axiom.authority2.hosted-disposable-results.v1',pin:PIN,phase:'REVOCATION',nonce:'a'.repeat(64),genesis_sha256:'b'.repeat(64),private_hosted_tests_completed:true,independent_review_still_required:true,B27:'FAILED_IN_SYNTHETIC_ATTACK',gate3_closed:false,release_status:'NOT_RELEASE',fault_origin:'OPERATOR_CONTROLLED_INJECTION_ON_ACTUAL_PROVIDER_STATE',cases};
 assert.equal(validateHostedPayload(p,'REVOCATION',p.nonce,p.genesis_sha256),p);for(const changed of [{cases:[cases[0],cases[0]]},{B27:'PASS'},{gate3_closed:true},{phase:'GENESIS'}])assert.throws(()=>validateHostedPayload({...p,...changed},'REVOCATION',p.nonce,p.genesis_sha256),/A2OP_HOSTED_RESULTS_INCOMPLETE_HOLD/);assert.throws(()=>scheduleWindow(NaN),/A2OP_CLOCK_HOLD/);
});
