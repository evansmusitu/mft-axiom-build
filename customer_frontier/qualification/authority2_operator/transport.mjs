import {ACCOUNT,SOURCE_ACCOUNT,SCRIPT,BUCKET,REPO,CHECKPOINT_REPO,PIN,need,OperatorHold} from './pins.mjs';
const ROOT='/accounts/'+ACCOUNT+'/workers/scripts/'+SCRIPT;
export const WORKER_ROOT=ROOT;
const id='[a-f0-9-]{32,36}';
const adminProbe='/accounts/'+ACCOUNT+'/workers/scripts/axiom-a2-op-authcheck-[a-f0-9]{32}';
export function cfAllowed(method,path){
 if(method==='GET')return ['/user/tokens/permission_groups','/user','/user/tokens/verify',`/accounts/${ACCOUNT}/tokens/verify`,ROOT+'/settings',ROOT+'/deployments',ROOT+'/content',ROOT+'/schedules',ROOT+'/subdomain',`/accounts/${ACCOUNT}/r2/buckets/${BUCKET}/lock`,`/accounts/${ACCOUNT}/workers/domains`].includes(path)||new RegExp('^'+adminProbe+'/settings$').test(path)||new RegExp('^'+ROOT+'/versions/'+id+'$').test(path)||/^\/user\/tokens\?page=[1-5]&per_page=50&include_expired=true$/.test(path)||new RegExp('^/accounts/('+ACCOUNT+'|'+SOURCE_ACCOUNT+')/tokens\\?page=[1-5]&per_page=50&include_expired=true$').test(path)||new RegExp('^/accounts/'+ACCOUNT+'/members\\?page=[1-5]&per_page=50$').test(path)||new RegExp('^/accounts/'+ACCOUNT+'/workers/scripts\\?page=[1-5]&per_page=100$').test(path)||new RegExp('^/zones\\?account\\.id='+ACCOUNT+'&page=[1-5]&per_page=50$').test(path)||/^\/zones\/[a-f0-9]{32}\/workers\/routes$/.test(path)||/^\/zones\/[a-f0-9]{32}$/.test(path)||/^\/zones\?page=[1-5]&per_page=50$/.test(path);
 if(method==='PUT')return [ROOT,ROOT+'/content',ROOT+'/schedules'].includes(path);
 if(method==='POST')return [ROOT+'/tails',ROOT+'/subdomain'].includes(path)||new RegExp('^'+adminProbe+'/assets-upload-session$').test(path);
 if(method==='PATCH')return path===ROOT+'/secrets-bulk';
 return method==='DELETE'&&new RegExp('^'+ROOT+'/tails/'+id+'$').test(path);
}
export function ghAllowed(method,path){
 const q='/repos/'+CHECKPOINT_REPO,c='/repos/'+REPO;
 if(method==='GET')return [q,q+'/branches/main',q+'/releases?per_page=100',c+'/branches/main',...[1,192,251].map(n=>c+'/pulls/'+n),c+'/actions/jobs/138679115528',c+'/actions/runs/45459847877/jobs?filter=latest&per_page=100'].includes(path)||new RegExp('^'+c+'/actions/runs\\?head_sha=[a-f0-9]{40}&per_page=100$').test(path)||new RegExp('^'+c+'/actions/runs/[1-9][0-9]*/jobs\\?filter=latest&per_page=100$').test(path)||new RegExp('^'+q+'/(?:releases/(?:[1-9][0-9]*|tags/ax-[a-z0-9-]+)|git/ref/tags/ax-[a-z0-9-]+)$').test(path)||new RegExp('^'+c+'/actions/jobs/[1-9][0-9]*/logs$').test(path);
 if(method==='POST')return [q+'/releases',q+'/git/tags',c+'/actions/jobs/138679115528/rerun'].includes(path)||new RegExp('^'+q+'/releases/[1-9][0-9]*/assets\\?name=checkpoint.json$').test(path);
 return method==='PATCH'&&new RegExp('^'+q+'/releases/[1-9][0-9]*$').test(path);
}
async function bytes(response,limit,deadline){
 const reader=response.body?.getReader();if(!reader)return new Uint8Array();const parts=[];let size=0;
 try{for(;;){const x=await Promise.race([reader.read(),deadline]);if(x.done)break;need(x.value instanceof Uint8Array&&(size+=x.value.byteLength)<=limit,'A2OP_RESPONSE_SIZE_HOLD');parts.push(x.value);}const out=new Uint8Array(size);let at=0;for(const p of parts){out.set(p,at);at+=p.length;}return out;}finally{try{void reader.cancel().catch(()=>{});}catch{}try{reader.releaseLock();}catch{}}
}
export class OperatorTransport{
 constructor({credential,githubToken,fetchImpl=fetch,parseJson=JSON.parse,journal=()=>{},capturePrivate=()=>true}){
  need(credential&&['api_token','global_key'].includes(credential.kind)&&typeof credential.secret==='string'&&/^[A-Za-z0-9._~-]{16,200}$/.test(credential.secret),'A2OP_OWNER_CREDENTIAL_HOLD');
  if(credential.kind==='global_key')need(typeof credential.email==='string'&&/^\S+@\S+\.\S+$/.test(credential.email)&&credential.email.length<=254,'A2OP_OWNER_EMAIL_HOLD');
  this.credential=credential;this.githubToken=githubToken;this.fetchImpl=fetchImpl;this.parseJson=parseJson;this.journal=journal;this.capturePrivate=capturePrivate;this.cfCount=0;this.ghCount=0;this.mutations=0;this.privateArchiveFailed=false;this.cleanupMode=false;
 }
 async request(provider,method,path,{body,raw=false,token,allowStatus=[200],limit=1048576}={}){
  const cf=provider==='cf';need(cf?cfAllowed(method,path):ghAllowed(method,path),'A2OP_ROUTE_SCOPE_HOLD');need(cf?++this.cfCount<=256:++this.ghCount<=256,'A2OP_REQUEST_BUDGET_HOLD');
  const mutation=method!=='GET';if(mutation){need(!this.privateArchiveFailed||this.cleanupMode,'A2OP_PRIVATE_EVIDENCE_INCOMPLETE_HOLD');this.mutations++;await this.journal({method,path,provider,phase:'BEFORE_REQUEST'});}
  const header=cf?(this.credential.kind==='global_key'?{'x-auth-key':this.credential.secret,'x-auth-email':this.credential.email}:{authorization:'Bearer '+this.credential.secret}):{authorization:'Bearer '+(token??this.githubToken),'x-github-api-version':'2022-11-28','user-agent':'musitu-axiom-private-operator'};
  const upload=!cf&&path.includes('/assets?');const host=cf?'https://api.cloudflare.com/client/v4':upload?'https://uploads.github.com':'https://api.github.com';
  let timer,observedStatus=null,responseComplete=false;const ctrl=new AbortController();const timeout=mutation?20000:10000;const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{ctrl.abort();reject(new OperatorHold('A2OP_REQUEST_AMBIGUOUS_HOLD'));},timeout);});
  try{
   const isForm=body instanceof FormData;const r=await Promise.race([this.fetchImpl(new Request(host+path,{method,redirect:'manual',credentials:'omit',cache:'no-store',signal:ctrl.signal,headers:{accept:cf?'application/json':'application/vnd.github+json',...header,...(body===undefined||isForm?{}:{'content-type':upload?'application/json':'application/json'})},...(body===undefined?{}:{body:isForm||upload?body:JSON.stringify(body)})})),deadline]);
   need(Number.isInteger(r?.status)&&r.status>=100&&r.status<=599,'A2OP_PROVIDER_STATUS_HOLD');observedStatus=r.status;
   const data=await bytes(r,limit,deadline);
   responseComplete=true;if(this.capturePrivate({provider,method,path,http_status:r.status,response_headers:Object.fromEntries(r.headers),body_base64:Buffer.from(data).toString('base64'),response_complete:true,at_utc:new Date().toISOString()})===false)this.privateArchiveFailed=true;
   if(mutation)await this.journal({method,path,provider,phase:'RESPONSE_OBSERVED',http_status:r.status});need(allowStatus.includes(r.status),'A2OP_PROVIDER_STATUS_HOLD');
   if(raw)return {status:r.status,data,headers:r.headers};
   let d;if(data.length){try{d=this.parseJson(new TextDecoder('utf-8',{fatal:true}).decode(data));}catch{throw new OperatorHold('A2OP_PROVIDER_JSON_HOLD');}}
   if(cf&&r.status===200)need(d?.success===true&&(!d.errors||Array.isArray(d.errors)&&d.errors.length===0)&&Object.hasOwn(d,'result'),'A2OP_PROVIDER_ENVELOPE_HOLD');
   if(mutation)await this.journal({method,path,provider,phase:'ACKNOWLEDGED',http_status:r.status});
   return {status:r.status,data:cf&&r.status===200?d.result:d,headers:r.headers,result_info:d?.result_info};
  }catch(e){if(this.capturePrivate({provider,method,path,http_status:observedStatus,response_complete:responseComplete,outcome:'REQUEST_NOT_ACCEPTED',at_utc:new Date().toISOString()})===false)this.privateArchiveFailed=true;if(e instanceof OperatorHold)throw e;throw new OperatorHold('A2OP_REQUEST_AMBIGUOUS_HOLD');}finally{clearTimeout(timer);}
 }
 cf(method,path,options){return this.request('cf',method,path,options);}
 gh(method,path,options){return this.request('gh',method,path,options);}
 async approvedFetch(url,options={}){
  const u=new URL(url),method=options.method??'GET';need(['https://api.github.com','https://uploads.github.com'].includes(u.origin)&&!u.username&&!u.password,'A2OP_ANCHOR_HOST_HOLD');
  const token=new Headers(options.headers).get('authorization')?.replace(/^Bearer /,'');let body=options.body;
  if(body!==undefined&&!u.hostname.startsWith('uploads.'))body=this.parseJson(body);
  const r=await this.gh(method,u.pathname+u.search,{body,token,allowStatus:[200,201,204,403,404]});return Response.json(r.data??null,{status:r.status===204?200:r.status});
 }
}
export {bytes as readBoundedBody};
