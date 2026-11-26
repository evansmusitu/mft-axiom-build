import {readFileSync,lstatSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {parseIdentityJson} from './parser.mjs';
import {OperatorTransport,readBoundedBody} from './transport.mjs';
import {operatorKey,PrivateOperatorRunner,hash} from './operator_core.mjs';
import {need,OperatorHold,REPO} from './pins.mjs';
import {PrivateEvidence} from './private_evidence.mjs';
const write=x=>process.stdout.write(JSON.stringify(x)+'\n');
export function requireOwnerContext(env=process.env,platform=process.platform){need(platform==='win32'&&!env.CI&&!env.GITHUB_ACTIONS&&!env.TF_BUILD&&!env.AXIOM_BUILDER_RUNTIME,'A2OP_OWNER_WINDOWS_CONTEXT_REQUIRED_HOLD');for(const n of ['NODE_OPTIONS','NODE_PATH','NODE_EXTRA_CA_CERTS','NODE_TLS_REJECT_UNAUTHORIZED','NODE_USE_ENV_PROXY','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY'])need(!env[n],'A2OP_RUNTIME_OVERRIDE_HOLD');}
async function githubLog(t,job){
 const r=await t.gh('GET','/repos/'+REPO+'/actions/jobs/'+job+'/logs',{raw:true,allowStatus:[200,302],limit:2097152});
 if(r.status===200)return new TextDecoder('utf-8',{fatal:true}).decode(r.data);
 const u=new URL(r.headers.get('location'));need(u.protocol==='https:'&&!u.username&&!u.password&&u.port===''&&['githubusercontent.com','blob.core.windows.net','amazonaws.com'].some(h=>u.hostname.endsWith('.'+h)),'A2OP_GITHUB_LOG_DOWNLOAD_HOST_HOLD');
 let timer;const abort=new AbortController();const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(new OperatorHold('A2OP_LOG_DOWNLOAD_UNKNOWN_HOLD'));},15000);});
 try{const response=await Promise.race([fetch(u,{method:'GET',redirect:'manual',credentials:'omit',signal:abort.signal}),deadline]);need(response.status===200,'A2OP_LOG_DOWNLOAD_HOLD');const raw=await readBoundedBody(response,2097152,deadline);if(t.capturePrivate({provider:'GitHub job log download',job_id:job,http_status:response.status,response_headers:Object.fromEntries(response.headers),body_base64:Buffer.from(raw).toString('base64'),response_complete:true,at_utc:new Date().toISOString()})===false)t.privateArchiveFailed=true;return new TextDecoder('utf-8',{fatal:true}).decode(raw);}finally{clearTimeout(timer);}
}
export async function main(){
 if(process.argv.length===3&&process.argv[2]==='--inspect'){write({type:'INSPECTION',status:'A2_OPERATOR_SOURCE_VALID_NOT_OWNER_EXECUTION',private_input_read:false,provider_requests:0,gate3_closed:false,release_status:'NOT_RELEASE'});return;}
 let rl,privateEvidence;
 try{
  requireOwnerContext();need(process.argv.length===4,'A2OP_PRIVATE_WRAPPER_REQUIRED_HOLD');
  const root=resolve(process.argv[2]),ghPath=resolve(process.argv[3]);need(readFileSync(join(root,'.AXIOM_OWNER_OPERATOR_V1'),'utf8')==='OWNER_LOCAL_PROTECTED_NTFS_V1\n','A2OP_OWNER_WRAPPER_MARKER_HOLD');
  rl=createInterface({input:process.stdin,crlfDelay:Infinity});const iterator=rl[Symbol.asyncIterator]();let inputRecord=await iterator.next();need(!inputRecord.done&&inputRecord.value.length<=16384,'A2OP_PRIVATE_INPUT_HOLD');const input=parseIdentityJson(inputRecord.value);inputRecord=null;
  const payload=parseIdentityJson(readFileSync(join(root,'payload.json'),'utf8'));need(input.source_approval_sha256===hash(readFileSync(join(root,'payload.json'))),'A2OP_NEW_OPERATOR_SOURCE_APPROVAL_HOLD');
  const localKey=operatorKey(input.private_key_path,input.passphrase,root);input.passphrase=null;
  let githubOwner='';if(!input.cleanup_journal_path){const gh=spawnSync(ghPath,['auth','token','--hostname','github.com'],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:32768,shell:false});need(gh.status===0&&typeof gh.stdout==='string','A2OP_EXISTING_GITHUB_OWNER_LOGIN_REQUIRED_HOLD');githubOwner=gh.stdout.trim();need(/^[A-Za-z0-9._~+\/-]{20,8192}={0,2}$/.test(githubOwner)&&typeof input.github_read_token==='string'&&/^[A-Za-z0-9._~+\/-]{20,8192}={0,2}$/.test(input.github_read_token),'A2OP_GITHUB_CAPABILITY_HOLD');}
  privateEvidence=new PrivateEvidence(root);const t=new OperatorTransport({credential:input.credential,githubToken:githubOwner,parseJson:parseIdentityJson,capturePrivate:record=>privateEvidence.capture(record)});
  const ask=async data=>{write({type:'APPROVAL',...data});let timer;try{const answer=await Promise.race([iterator.next(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new OperatorHold('A2OP_OPERATOR_APPROVAL_TIMEOUT_HOLD')),900000);})]);need(!answer.done&&answer.value.length<512,'A2OP_OPERATOR_APPROVAL_REQUIRED_HOLD');const x=parseIdentityJson(answer.value);return x.approved_sha256;}finally{clearTimeout(timer);}};
  const runner=new PrivateOperatorRunner({transport:t,work:root,payload,key:localKey,githubReadToken:input.github_read_token,sourceApprovalSha:input.source_approval_sha256,ask,progress:message=>write({type:'PROGRESS',message}),wait:ms=>new Promise(resolve=>setTimeout(resolve,ms)),readLog:job=>githubLog(t,job)});
  input.private_key_path=null;let result;
  if(input.cleanup_journal_path){const f=resolve(input.cleanup_journal_path),s=lstatSync(f);need(s.isFile()&&!s.isSymbolicLink()&&s.size<131072,'A2OP_JOURNAL_SIZE_HOLD');result=await runner.cleanupOnly(parseIdentityJson(readFileSync(f,'utf8')));}else result=await runner.run();
  write({type:'COMPLETE',...result});if(!result.success)process.exitCode=2;
 }catch(e){write({type:'ERROR',code:typeof e?.code==='string'&&/^A2OP_[A-Z0-9_]+$/.test(e.code)?e.code:'A2OP_OWNER_EXECUTION_UNKNOWN_HOLD',gate3_closed:false,release_status:'NOT_RELEASE'});process.exitCode=2;}finally{privateEvidence?.close();rl?.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
