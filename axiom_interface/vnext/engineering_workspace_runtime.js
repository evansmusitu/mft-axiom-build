import {evaluateAuthorization,normalizeActionRequest,normalizeAuthorityEnvelope} from './authorization_gateway.js';
import {ensureContentSize,normalizeProjectPath,parseTerminalRead,rejectSecretLike,sha256} from './execution_security.js';

const MAX_WORKTREES=12;
const MAX_CHECKPOINTS=40;
const MAX_SEARCH_RESULTS=200;
const clone=value=>structuredClone(value);
const now=()=>new Date().toISOString();
const cleanLabel=(value,max=120)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);

function normalizedFiles(raw={}){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new TypeError('workspace files must be an object');
  const out={};
  for(const [rawPath,rawContent] of Object.entries(raw)){
    const path=normalizeProjectPath(rawPath),content=ensureContentSize(rawContent);
    rejectSecretLike(content,`workspace file ${path}`);
    out[path]=content;
  }
  return Object.fromEntries(Object.entries(out).sort(([a],[b])=>a.localeCompare(b)));
}

function splitLines(value){
  const text=String(value??'');
  if(!text)return [];
  const lines=text.split('\n');
  if(lines.at(-1)==='')lines.pop();
  return lines;
}

export function createLineDiff(before,after,path='file'){
  path=normalizeProjectPath(path);
  before=String(before??'');after=String(after??'');
  if(before===after)return `--- a/${path}\n+++ b/${path}\n`;
  const left=splitLines(before),right=splitLines(after),rows=[`--- a/${path}`,`+++ b/${path}`,'@@'];
  const limit=Math.max(left.length,right.length);
  for(let i=0;i<limit;i++){
    if(left[i]===right[i]&&left[i]!==undefined)rows.push(` ${left[i]}`);
    else{
      if(left[i]!==undefined)rows.push(`-${left[i]}`);
      if(right[i]!==undefined)rows.push(`+${right[i]}`);
    }
  }
  return `${rows.join('\n')}\n`;
}

export function searchWorkspace(rawFiles,rawQuery,{caseSensitive=false,maxResults=MAX_SEARCH_RESULTS}={}){
  const files=normalizedFiles(rawFiles),query=String(rawQuery??'');
  if(!query)return [];
  const needle=caseSensitive?query:query.toLocaleLowerCase();
  const results=[];
  for(const [path,content] of Object.entries(files)){
    const lines=content.split('\n');
    for(let i=0;i<lines.length;i++){
      const haystack=caseSensitive?lines[i]:lines[i].toLocaleLowerCase();
      let from=0;
      while(results.length<maxResults){
        const column=haystack.indexOf(needle,from);
        if(column<0)break;
        results.push({path,line:i+1,column:column+1,preview:lines[i].slice(0,240)});
        from=column+Math.max(1,needle.length);
      }
      if(results.length>=maxResults)return results;
    }
  }
  return results;
}

function delimiterDiagnostics(path,source){
  const stack=[],pairs={')':'(',']':'[','}':'{'},open=new Set(['(','[','{']),rows=[];
  let quote=null,escaped=false,lineComment=false,blockComment=false,line=1,column=0;
  for(let i=0;i<source.length;i++){
    const ch=source[i],next=source[i+1];column+=1;
    if(ch==='\n'){line+=1;column=0;lineComment=false;continue;}
    if(lineComment)continue;
    if(blockComment){if(ch==='*'&&next==='/'){blockComment=false;i+=1;column+=1;}continue;}
    if(quote){if(escaped){escaped=false;continue;}if(ch==='\\'){escaped=true;continue;}if(ch===quote)quote=null;continue;}
    if(ch==='/'&&next==='/'){lineComment=true;i+=1;column+=1;continue;}
    if(ch==='/'&&next==='*'){blockComment=true;i+=1;column+=1;continue;}
    if(ch==='"'||ch==="'"||ch==='`'){quote=ch;continue;}
    if(open.has(ch))stack.push({ch,line,column});
    else if(Object.hasOwn(pairs,ch)){
      const top=stack.pop();
      if(!top||top.ch!==pairs[ch])rows.push({path,line,column,severity:'error',code:'UNBALANCED_DELIMITER',message:`Unexpected ${ch}`});
    }
  }
  if(quote)rows.push({path,line,column,severity:'error',code:'UNCLOSED_STRING',message:'Unclosed string literal'});
  if(blockComment)rows.push({path,line,column,severity:'error',code:'UNCLOSED_COMMENT',message:'Unclosed block comment'});
  for(const item of stack)rows.push({path,line:item.line,column:item.column,severity:'error',code:'UNBALANCED_DELIMITER',message:`Unclosed ${item.ch}`});
  return rows;
}

export function diagnoseWorkspace(rawFiles){
  const files=normalizedFiles(rawFiles),rows=[];
  for(const [path,content] of Object.entries(files)){
    if(path.endsWith('.json')){
      try{JSON.parse(content);}catch(error){rows.push({path,line:1,column:1,severity:'error',code:'INVALID_JSON',message:cleanLabel(error?.message||'Invalid JSON',240)});}
      continue;
    }
    if(/\.(?:[cm]?js|ts|tsx|jsx|css|html)$/.test(path))rows.push(...delimiterDiagnostics(path,content));
  }
  return rows.sort((a,b)=>a.path.localeCompare(b.path)||a.line-b.line||a.column-b.column);
}

export function evaluateTestContract(rawFiles,rawContract={}){
  const files=normalizedFiles(rawFiles),checks=Array.isArray(rawContract?.checks)?rawContract.checks:[];
  if(!checks.length||checks.length>128)return {status:'FAIL',passed:0,failed:1,results:[{status:'FAIL',reason:'test_contract_checks_required'}]};
  const results=checks.map((raw,index)=>{
    try{
      const kind=cleanLabel(raw?.kind,40),path=normalizeProjectPath(raw?.path),content=files[path],value=String(raw?.value??'');
      let pass=false;
      if(kind==='file_exists')pass=Object.hasOwn(files,path);
      else if(kind==='file_absent')pass=!Object.hasOwn(files,path);
      else if(kind==='contains')pass=typeof content==='string'&&content.includes(value);
      else if(kind==='not_contains')pass=typeof content==='string'&&!content.includes(value);
      else return {index,status:'FAIL',kind,path,reason:'unsupported_test_kind'};
      return {index,status:pass?'PASS':'FAIL',kind,path,reason:pass?null:'expectation_not_met'};
    }catch(error){return {index,status:'FAIL',reason:cleanLabel(error?.message||'invalid test',200)};}
  });
  const passed=results.filter(row=>row.status==='PASS').length;
  return {status:passed===results.length?'PASS':'FAIL',passed,failed:results.length-passed,results};
}

async function receipt(kind,body){
  const base={schema:`musitu.axiom.engineering-workspace-${kind}.browser.v1`,...body,created_at:now()};
  return {...base,receipt_sha256:await sha256(base)};
}

export class EngineeringWorkspaceRuntime{
  constructor({projectId,authority,files}){
    this.projectId=projectId;
    this.authorityRaw=clone(authority);
    this.authority=normalizeAuthorityEnvelope(authority);
    if(this.authority.project_id!==projectId)throw new DOMException('workspace authority project mismatch','SecurityError');
    this.worktrees=new Map([['main',{files:normalizedFiles(files),buffers:{},base_worktree_id:null,created_at:now()}]]);
    this.activeWorktreeId='main';
    this.checkpoints=new Map();
    this.events=[];
  }
  static async create({projectId,authority,files={}}={}){
    projectId=cleanLabel(projectId,180);
    if(!projectId)throw new TypeError('workspace project id required');
    const runtime=new EngineeringWorkspaceRuntime({projectId,authority,files});
    await runtime._append('workspace.opened',{file_count:Object.keys(runtime._active().files).length});
    return runtime;
  }
  _active(){const row=this.worktrees.get(this.activeWorktreeId);if(!row)throw new Error('active worktree unavailable');return row;}
  async _append(kind,payload){
    const body={sequence:this.events.length,kind,payload:clone(payload),previous_event_sha256:this.events.at(-1)?.event_sha256||null};
    const event={...body,event_sha256:await sha256(body)};this.events.push(event);return event;
  }
  async _authorize(operation,target,payload=null,instructionProvenance='GOVERNED_PLAN'){
    const request=await normalizeActionRequest(this.authorityRaw,{operation,target,payload,instruction_provenance:instructionProvenance,compute_units:1});
    const decision=await evaluateAuthorization(this.authorityRaw,request);
    if(decision.status!=='AUTHORIZED')throw new DOMException(decision.reason,'NotAllowedError');
    return {request,decision};
  }
  files({includeBuffers=true}={}){const wt=this._active();return {...clone(wt.files),...(includeBuffers?clone(wt.buffers):{})};}
  listFiles(prefix=''){prefix=String(prefix||'');return Object.keys(this.files()).filter(path=>!prefix||path.startsWith(prefix)).sort();}
  readFile(rawPath,{draft=true}={}){const path=normalizeProjectPath(rawPath),wt=this._active();return draft&&Object.hasOwn(wt.buffers,path)?wt.buffers[path]:wt.files[path]??null;}
  async editFile(rawPath,rawContent,{instructionProvenance='TRUSTED_USER'}={}){
    const path=normalizeProjectPath(rawPath),content=ensureContentSize(rawContent);rejectSecretLike(content,`editor buffer ${path}`);
    const {request}=await this._authorize('file.write',path,{content},instructionProvenance);
    this._active().buffers[path]=content;await this._append('file.edited',{path,request_sha256:request.request_sha256,content_sha256:await sha256(content)});
    return receipt('edit',{status:'STAGED',project_id:this.projectId,worktree_id:this.activeWorktreeId,path,request_sha256:request.request_sha256});
  }
  diff(rawPath){const path=normalizeProjectPath(rawPath),wt=this._active();return createLineDiff(wt.files[path]??'',this.readFile(path)??'',path);}
  discardFile(rawPath){const path=normalizeProjectPath(rawPath),wt=this._active();delete wt.buffers[path];return {status:'DISCARDED',path};}
  async saveFile(rawPath,{instructionProvenance='TRUSTED_USER'}={}){
    const path=normalizeProjectPath(rawPath),wt=this._active();if(!Object.hasOwn(wt.buffers,path))throw new DOMException('no staged editor buffer','InvalidStateError');
    const content=wt.buffers[path],before=wt.files[path]??null,{request}=await this._authorize('file.write',path,{content},instructionProvenance);
    wt.files[path]=content;delete wt.buffers[path];await this._append('file.saved',{path,request_sha256:request.request_sha256,before_sha256:await sha256(before),after_sha256:await sha256(content)});
    return receipt('save',{status:'COMPLETED',project_id:this.projectId,worktree_id:this.activeWorktreeId,path,request_sha256:request.request_sha256,rollback_available:true});
  }
  search(query,options={}){return searchWorkspace(this.files(),query,options);}
  diagnostics(){return diagnoseWorkspace(this.files());}
  async runTerminal(command){
    const {request}=await this._authorize('terminal.read',command,null,'TRUSTED_USER'),parsed=parseTerminalRead(command),files=this.files();let result;
    if(parsed.op==='pwd')result={cwd:`/${this.projectId}/${this.activeWorktreeId}`};
    else if(parsed.op==='ls'){const prefix=parsed.args[0]?`${parsed.args[0].replace(/\/$/,'')}/`:'';result={entries:Object.keys(files).filter(path=>path.startsWith(prefix)).sort()};}
    else if(parsed.op==='cat'){const path=parsed.args[0];result={path,content:files[path]??null,exists:Object.hasOwn(files,path)};}
    else if(parsed.op==='status')result={worktree_id:this.activeWorktreeId,file_count:Object.keys(files).length,dirty_paths:Object.keys(this._active().buffers).sort()};
    else result={worktree_id:this.activeWorktreeId,changed_paths:Object.keys(this._active().buffers).sort()};
    await this._append('terminal.read',{command,request_sha256:request.request_sha256});return result;
  }
  async runBuild(){
    const {request}=await this._authorize('build.run','workspace',null,'GOVERNED_PLAN'),diagnostics=this.diagnostics(),errors=diagnostics.filter(row=>row.severity==='error'),artifact_sha256=await sha256(this.files());
    const out=await receipt('build',{status:errors.length?'FAIL':'PASS',project_id:this.projectId,worktree_id:this.activeWorktreeId,artifact_sha256,diagnostics,request_sha256:request.request_sha256,external_process_spawned:false});
    await this._append('build.completed',{status:out.status,receipt_sha256:out.receipt_sha256});return out;
  }
  async runTests(){
    const {request}=await this._authorize('test.run','axiom.tests.json',null,'GOVERNED_PLAN'),files=this.files();let contract;
    try{contract=JSON.parse(files['axiom.tests.json']||'');}catch{contract={checks:[]};}
    const result=evaluateTestContract(files,contract),out=await receipt('test',{...result,project_id:this.projectId,worktree_id:this.activeWorktreeId,request_sha256:request.request_sha256,external_process_spawned:false});
    await this._append('tests.completed',{status:out.status,receipt_sha256:out.receipt_sha256});return out;
  }
  async createWorktree(rawId){
    const id=cleanLabel(rawId,80).replace(/[^A-Za-z0-9._-]/g,'-');if(!id||this.worktrees.has(id))throw new DOMException('unique worktree id required','ConstraintError');if(this.worktrees.size>=MAX_WORKTREES)throw new DOMException('worktree limit reached','QuotaExceededError');
    const {request}=await this._authorize('worktree.create',id,null,'TRUSTED_USER'),source=this._active();this.worktrees.set(id,{files:clone(this.files()),buffers:{},base_worktree_id:this.activeWorktreeId,created_at:now()});this.activeWorktreeId=id;await this._append('worktree.created',{worktree_id:id,request_sha256:request.request_sha256});return {status:'COMPLETED',worktree_id:id,base_worktree_id:source.base_worktree_id};
  }
  switchWorktree(rawId){const id=cleanLabel(rawId,80);if(!this.worktrees.has(id))throw new DOMException('worktree not found','NotFoundError');this.activeWorktreeId=id;return {status:'SWITCHED',worktree_id:id};}
  async createCheckpoint(rawLabel='checkpoint'){
    if(this.checkpoints.size>=MAX_CHECKPOINTS)throw new DOMException('checkpoint limit reached','QuotaExceededError');const label=cleanLabel(rawLabel,120)||'checkpoint';
    const {request}=await this._authorize('file.write','.axiom/checkpoint',{label},'TRUSTED_USER'),snapshot={active_worktree_id:this.activeWorktreeId,worktrees:Object.fromEntries([...this.worktrees.entries()].map(([id,row])=>[id,clone(row)]))};
    const body={schema:'musitu.axiom.engineering-workspace-checkpoint.browser.v1',checkpoint_id:`workspace-checkpoint-${crypto.randomUUID?.()||Date.now()}`,project_id:this.projectId,label,snapshot_sha256:await sha256(snapshot),created_at:now(),production_state_mutated:false,authority_effect:'NONE'};
    const checkpoint={...body,checkpoint_sha256:await sha256(body),snapshot};this.checkpoints.set(checkpoint.checkpoint_id,checkpoint);await this._append('checkpoint.created',{checkpoint_id:checkpoint.checkpoint_id,checkpoint_sha256:checkpoint.checkpoint_sha256,request_sha256:request.request_sha256});return clone(checkpoint);
  }
  async restoreCheckpoint(checkpointId){
    const checkpoint=this.checkpoints.get(String(checkpointId||''));if(!checkpoint)throw new DOMException('checkpoint not found','NotFoundError');const {snapshot,...signed}=checkpoint,body=Object.fromEntries(Object.entries(signed).filter(([key])=>key!=='checkpoint_sha256'));
    if(await sha256(body)!==checkpoint.checkpoint_sha256||await sha256(snapshot)!==checkpoint.snapshot_sha256||checkpoint.production_state_mutated!==false||checkpoint.authority_effect!=='NONE')throw new DOMException('checkpoint integrity failure','SecurityError');
    const {request}=await this._authorize('file.write','.axiom/restore',{checkpoint_id:checkpoint.checkpoint_id},'TRUSTED_USER');this.worktrees=new Map(Object.entries(clone(snapshot.worktrees)));this.activeWorktreeId=snapshot.active_worktree_id;await this._append('checkpoint.restored',{checkpoint_id:checkpoint.checkpoint_id,request_sha256:request.request_sha256});return {status:'RESTORED',checkpoint_id:checkpoint.checkpoint_id,worktree_id:this.activeWorktreeId};
  }
  async preview(){
    const files=this.files(),html=files['index.html']||'<main><h1>Workspace preview</h1></main>',css=files['styles.css']||'',script=files['app.js']||'';
    return {status:'READY',sandbox:'allow-scripts',srcdoc:`${html}<style>${css.replace(/<\/style/gi,'<\\/style')}</style><script type="module">${script.replace(/<\/script/gi,'<\\/script')}<\/script>`,source_sha256:await sha256(files)};
  }
  async verifyEventChain(){let previous=null;const errors=[];for(let i=0;i<this.events.length;i++){const row=this.events[i],body=Object.fromEntries(Object.entries(row).filter(([key])=>key!=='event_sha256'));if(row.sequence!==i||row.previous_event_sha256!==previous||await sha256(body)!==row.event_sha256)errors.push(`event_chain:${i}`);previous=row.event_sha256;}return {status:errors.length?'FAIL':'PASS',errors,event_count:this.events.length,event_chain_tip_sha256:previous};}
}
