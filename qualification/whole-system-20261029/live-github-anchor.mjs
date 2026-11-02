/** Bounded isolated qualification. Native Actions token stays in this runner. No CF/model calls. */
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {fixture} from './external-ledger-fixture.mjs';
import {anchoredRestoreCase} from './anchored-restore-case.mjs';
import {forwardGithubRequest} from './github-anchor-forward.mjs';
const repository='evansmusitu/mft-axiom-qualification-isolated-20260913',repository_id=1368351153,target_commitish='43cd0f6b76a69fa539a6cec572a8b2f3719a3d82';
if(process.env.GITHUB_REPOSITORY!==repository||process.env.GITHUB_RUN_ATTEMPT!=='1'||!process.env.GH_TOKEN||!/^\d+$/.test(process.env.GITHUB_RUN_ID??'')||!(/^[0-9a-f]{64}$/).test(process.env.AXIOM_ANCHOR_EXECUTION_ARTIFACT_SHA256??''))throw Error('isolated first-attempt pinned runner required');
const out='anchor-integration-results';mkdirSync(out,{recursive:true});let calls=0,dropPublish=false;
const owned=new Map(),events=[];
const report={schema:'axiom.github-anchor-product-integration.v1',source_sha:process.env.SOURCE_SHA,execution_artifact_sha256:process.env.AXIOM_ANCHOR_EXECUTION_ARTIFACT_SHA256,observed_at:new Date().toISOString(),repository,repository_id,target_commitish,checks:{},events,raw_outcomes:[],inference_calls:0,hosted_authority_deployments:0,gate3_qualified:false,independent_verification:'SKIPPED_BY_OWNER_UNQUALIFIED'};
const save=()=>writeFileSync(out+'/report.json',JSON.stringify(report,null,2)+'\n');
async function transport(input,init){
  const request=typeof input==='string'?new Request(input,init):input,url=new URL(request.url),root='/repos/'+repository;
  if(!['https://api.github.com','https://uploads.github.com'].includes(url.origin)||!(url.pathname===root||url.pathname.startsWith(root+'/')))throw Error('foreign API denied');
  if(!['GET','POST','PATCH','DELETE'].includes(request.method)||++calls>170)throw Error('request budget or method denied');
  if(request.method==='DELETE'&&!owned.has(Number(url.pathname.split('/').at(-1))))throw Error('foreign cleanup denied');
  let forwarded;try{forwarded=await forwardGithubRequest(request);}catch(error){report.transport_failure={method:request.method,path:url.pathname,name:error.name,cause_code:error.cause?.code??null};save();throw error;}
  const {response,body}=forwarded;
  const text=await response.text();if(text.length>131072)throw Error('provider reply too large');let data=null;try{data=JSON.parse(text);}catch{}
  if(request.method==='POST'&&url.pathname===root+'/releases'&&response.status===201)owned.set(data.id,data.tag_name);
  if(url.origin==='https://uploads.github.com'&&body)events.push(JSON.parse(body));
  report.raw_outcomes.push({method:request.method,path:url.pathname,status:response.status,...(data?.id?{id:data.id}:{}),...(data?.tag_name?{tag:data.tag_name,immutable:data.immutable,draft:data.draft}:{}),...(response.status>=400?{message:data?.message,errors:data?.errors}:{} )});save();
  if(dropPublish&&request.method==='PATCH'&&response.status===200){dropPublish=false;throw Error('deliberately dropped successful publish acknowledgement');}
  return new Response(text||null,{status:response.status,headers:{'content-type':'application/json'}});
}
function anchor(name){return {pin:{repository,repository_id,namespace:'ax-live-'+process.env.GITHUB_RUN_ID+'-'+name,target_commitish},token:process.env.GH_TOKEN,fetchImpl:transport};}
async function scope(fn){const cleanup=[];try{return await fn({after(cb){cleanup.push(cb);}});}finally{for(const cb of cleanup.reverse())await cb();}}
async function unchanged(){const r=await transport('https://api.github.com/repos/'+repository+'/git/ref/heads/main',{headers:{authorization:'Bearer '+process.env.GH_TOKEN}});assert.equal(r.status,200);assert.equal((await r.json()).object.sha,target_commitish);}
try{
  await unchanged();report.checks.dual_store_restore=await scope(t=>anchoredRestoreCase(t,anchor('dual-restore')));save();
  for(const operation of ['revoke','epoch'])report.checks[operation+'_restore']=await scope(async t=>{
    const f=await fixture(t,{persist:true,anchor:anchor(operation)});await f.bootstrap();await f.grant();await f.snapshotStore();
    const input=operation==='epoch'?{expected_epoch:1,challenge:'9'.repeat(64)}:{grant_id:'grant-one',tenant_id:'tenant-alpha',expected_epoch:1,challenge:'9'.repeat(64)};
    const r=await f.request('/v1/operator/'+operation,input,{role:'revoke'});assert.equal(r.status,200,await r.clone().text());
    const read=await (await f.makeClient()).inspect({tenant_id:'tenant-alpha'});assert.equal(read.payload.dispatch_allowed,false);
    if(operation==='revoke')assert.equal(read.payload.grant.state,'REVOKED');else assert.equal(read.payload.current_epoch,2);
    await f.restoreStore();const c=await f.makeClient();let denial;await assert.rejects(async()=>c.consume(await f.prepare(c)),e=>{denial=e.remote_code??e.code;return /ANCHOR_/.test(denial);});
    return {status:'PASSED',authority_store_restored:true,anchored_readback_verified:true,dispatch_allowed_after_restore:false,denial};
  });
  report.checks.lost_ack=await scope(async t=>{
    const f=await fixture(t,{persist:true,anchor:anchor('lost-ack')});await f.bootstrap();await f.grant();dropPublish=true;
    const c=await f.makeClient();await assert.rejects(async()=>c.consume(await f.prepare(c)),e=>/ANCHOR_/.test(e.remote_code??e.code));
    const before=calls;await f.restart();const rebuilt=await f.makeClient();await assert.rejects(async()=>rebuilt.consume(await f.prepare(rebuilt)),e=>e.remote_code==='ANCHOR_PENDING_RECONCILIATION_HOLD');assert.equal(calls,before);
    return {status:'PASSED',restarted:true,publication_retries:0,callbacks_after_ambiguous_publish:0};
  });
  await unchanged();report.status='REAL_GITHUB_AND_LOCAL_WORKERD_RESTORE_CHECKS_PASSED_NOT_HOSTED_ACCEPTANCE';
}catch(error){report.status='HOLD_OR_FAILURE';report.error={name:error.name,message:error.message};process.exitCode=1;}
finally{
  report.cleanup=[];
  for(const [id,tag]of owned){try{
    const init={headers:{authorization:'Bearer '+process.env.GH_TOKEN}},url='https://api.github.com/repos/'+repository+'/releases/'+id;
    const r=await transport(url,init);if(r.status!==200){report.cleanup.push({id,status:r.status});continue;}const d=await r.json();
    if(d.tag_name!==tag||!tag.startsWith('ax-live-'+process.env.GITHUB_RUN_ID+'-'))throw Error('cleanup identity mismatch');
    if(d.immutable===true){report.cleanup.push({id,tag,status:'RETAINED_IMMUTABLE'});continue;}
    report.cleanup.push({id,tag,status:(await transport(url,{...init,method:'DELETE'})).status});
  }catch{report.cleanup.push({id,tag,status:'UNKNOWN'});}}
  report.api_requests=calls;report.completed_at=new Date().toISOString();report.not_executed=['hosted authority deployment with durable narrowly scoped credentials','separate-host race','repository deletion/resurrection','disable-new-immutability test','production model dispatch','independent certification'];save();console.log(JSON.stringify({status:report.status,checks:Object.keys(report.checks),api_requests:calls,gate3_qualified:false,error:report.error??null}));
}
