/** Bounded credential qualification. Keys remain in the Actions environment; no inference/CF calls. */
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {anchorCredential} from '../../integrations/independent-ledger/github-anchor.mjs';
const repository='evansmusitu/mft-axiom-qualification-isolated-20260913',repository_id=1368351153,baseline='43cd0f6b76a69fa539a6cec572a8b2f3719a3d82',root='/repos/'+repository;
if(process.env.GITHUB_REPOSITORY!=='evansmusitu/mft-axiom-build'||process.env.GITHUB_RUN_ATTEMPT!=='1'||!/^\d+$/.test(process.env.GITHUB_RUN_ID??''))throw Error('isolated first-attempt workflow required');
const tag='ax-credential-20261102-'+process.env.GITHUB_RUN_ID,owned=new Set();let calls=0;
const out='qualification/whole-system-20261029/anchor-credential-results';mkdirSync(out,{recursive:true});
const report={schema:'axiom.github-anchor-credential-qualification.v1',source_sha:process.env.SOURCE_SHA,observed_at:new Date().toISOString(),repository,repository_id,checks:{},raw_outcomes:[],inference_calls:0,cloudflare_calls:0,hosted_authority_deployments:0,gate3_qualified:false,independent_verification:'SKIPPED_BY_OWNER_UNQUALIFIED'};
const save=()=>writeFileSync(out+'/report.json',JSON.stringify(report,null,2)+'\n');
async function api(role,method,path,body){
  if(++calls>18||!(path===root||path.startsWith(root+'/')))throw Error('API scope or budget denied');
  const token=anchorCredential(process.env[role==='writer'?'AXIOM_GITHUB_ANCHOR_WRITE_TOKEN':'AXIOM_GITHUB_ANCHOR_READ_TOKEN']);
  const r=await fetch('https://api.github.com'+path,{method,redirect:'manual',signal:AbortSignal.timeout(10000),headers:{authorization:'Bearer '+token,accept:'application/vnd.github+json','x-github-api-version':'2022-11-28','user-agent':'axiom-scoped-credential-qualification',...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  let data=null;const text=await r.text();if(text.length>131072)throw Error('API reply too large');try{data=JSON.parse(text);}catch{}
  report.raw_outcomes.push({role,method,path,status:r.status});save();return {status:r.status,data};
}
try{
  for(const role of ['writer','reader']){
    const r=await api(role,'GET',root);assert.equal(r.status,200);assert.equal(r.data.id,repository_id);assert.equal(r.data.full_name,repository);assert.equal(r.data.private,true);
  }
  report.checks.authenticated_repository_identity=true;
  const before=await api('reader','GET',root+'/git/ref/heads/main');assert.equal(before.status,200);assert.equal(before.data.object.sha,baseline);
  const created=await api('writer','POST',root+'/git/refs',{ref:'refs/tags/'+tag,sha:baseline});if(created.status===201)owned.add(tag);assert.equal(created.status,201);assert.equal(created.data.ref,'refs/tags/'+tag);assert.equal(created.data.object.sha,baseline);
  const read=await api('reader','GET',root+'/git/ref/tags/'+tag);assert.equal(read.status,200);assert.equal(read.data.object.sha,baseline);
  const deniedTag=tag+'-reader-denied';const denied=await api('reader','POST',root+'/git/refs',{ref:'refs/tags/'+deniedTag,sha:baseline});if(denied.status===201)owned.add(deniedTag);
  assert.equal(denied.status,403,'read-only credential must not create a repository ref');assert.match(denied.data?.message??'',/not accessible|permission|forbidden/i);
  report.checks.writer_create_and_reader_read=true;report.checks.reader_write_denied=true;
  const after=await api('writer','GET',root+'/git/ref/heads/main');assert.equal(after.status,200);assert.equal(after.data.object.sha,baseline);report.checks.main_unchanged=true;
  report.status='SCOPED_CREDENTIALS_CONFIRMED_NOT_HOSTED_AUTHORITY_ACCEPTANCE';
}catch(error){report.status='HOLD_OR_FAILURE';report.error={name:error.name,code:error.code??'QUALIFICATION_FAILED'};process.exitCode=1;}
finally{
  report.cleanup=[];
  for(const value of owned){try{
    if(value!==tag&&value!==tag+'-reader-denied')throw Error('foreign cleanup denied');
    const r=await api('writer','DELETE',root+'/git/refs/tags/'+value),read=await api('reader','GET',root+'/git/ref/tags/'+value);
    report.cleanup.push({tag:value,delete_status:r.status,readback_status:read.status});
    if(r.status!==204||read.status!==404){report.status='HOLD_CLEANUP_UNCONFIRMED';process.exitCode=1;}
  }catch{report.status='HOLD_CLEANUP_UNCONFIRMED';report.cleanup.push({tag:value,status:'UNKNOWN'});process.exitCode=1;}}
  report.api_requests=calls;report.completed_at=new Date().toISOString();save();console.log(JSON.stringify({status:report.status,checks:report.checks,api_requests:calls,gate3_qualified:false}));
}
