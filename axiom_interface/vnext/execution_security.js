export const RISK_CLASSES=Object.freeze(['S0','S1','S2','S3','S4','S5']);
export const NETWORK_DENY='DENY_ALL_EXTERNAL_NETWORK';
export const SECRET_POLICY='OPAQUE_SHORT_LIVED_OPERATION_SCOPED_NO_PLAINTEXT';
export const EXECUTION_MODE='BROWSER_LOCAL_GOVERNED_EXECUTION_SUBSTRATE';
export const TERMINAL_MODE='BOUNDED_VIRTUAL_TERMINAL_NO_HOST_SHELL';
export const SANDBOX_MODE='PROJECT_SCOPED_VIRTUAL_SANDBOX';
export const WORKTREE_MODE='ISOLATED_VIRTUAL_WORKTREE_NO_REPO_MUTATION';
export const MAX_LEASE_SECONDS=300;
export const MAX_FILE_BYTES=262144;
export const MAX_FILES=256;
export const MAX_COMPUTE_UNITS=100000;
export const INSTRUCTION_PROVENANCE=Object.freeze(['TRUSTED_USER','GOVERNED_PLAN','VERIFIED_SYSTEM','RETRIEVED_DATA']);
export const APPROVAL_ROLES=Object.freeze(['HUMAN_APPROVER','HUMAN_RELEASE_APPROVER','HUMAN_SECURITY_APPROVER','INDEPENDENT_VERIFIER']);
export const OPERATION_SPECS=Object.freeze({
  'file.read':{risk:'S0',tool_scope:'project.read',effect:'READ',reversible:false,external:false},
  'terminal.read':{risk:'S0',tool_scope:'project.read',effect:'READ',reversible:false,external:false},
  'build.plan':{risk:'S0',tool_scope:'project.read',effect:'COMPUTE',reversible:false,external:false},
  'file.write':{risk:'S1',tool_scope:'artifact.write',effect:'LOCAL_WRITE',reversible:true,external:false},
  'worktree.create':{risk:'S1',tool_scope:'artifact.write',effect:'LOCAL_WRITE',reversible:true,external:false},
  'build.run':{risk:'S1',tool_scope:'artifact.write',effect:'LOCAL_COMPUTE_WRITE',reversible:true,external:false},
  'test.run':{risk:'S1',tool_scope:'artifact.write',effect:'LOCAL_COMPUTE_WRITE',reversible:true,external:false},
  'network.read':{risk:'S2',tool_scope:'computer.preview',effect:'EXTERNAL_READ',reversible:false,external:true},
  'repo.mutate':{risk:'S3',tool_scope:'artifact.write',effect:'EXTERNAL_REVERSIBLE_WRITE',reversible:true,external:true},
  'network.write':{risk:'S3',tool_scope:'computer.preview',effect:'EXTERNAL_REVERSIBLE_WRITE',reversible:true,external:true},
  'publish.deploy':{risk:'S4',tool_scope:'artifact.write',effect:'PUBLICATION_DEPLOYMENT',reversible:true,external:true},
  'secret.use':{risk:'S5',tool_scope:'computer.preview',effect:'SECRET_AUTHORITY',reversible:false,external:true},
  'identity.change':{risk:'S5',tool_scope:null,effect:'IDENTITY_SECURITY',reversible:false,external:true},
  'security.policy.change':{risk:'S5',tool_scope:null,effect:'SECURITY_POLICY',reversible:false,external:true},
  'data.destroy':{risk:'S5',tool_scope:null,effect:'DESTRUCTIVE',reversible:false,external:true},
});
const SECRET_RX=/(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|private[_ -]?key|authorization)["']?\s*[:=]|\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{10,}|\bbearer\s+[A-Za-z0-9._~-]{10,}/i;
const CONTROL_RX=/(?:^|\s)(?:&&|\|\||[;<>`]|\$\(|\$\{|\n|\r)/;
export const clone=value=>structuredClone(value);
export const clean=(value,max=1000)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);
export const canonical=value=>Array.isArray(value)?`[${value.map(canonical).join(',')}]`:value&&typeof value==='object'?`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`:JSON.stringify(value);
export async function sha256(value){const bytes=new TextEncoder().encode(canonical(value));const digest=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
export function rejectSecretLike(value,label='value'){if(SECRET_RX.test(typeof value==='string'?value:canonical(value)))throw new DOMException(`${label} contains plaintext secret-like material`,'SecurityError');}
export function riskIndex(value){const index=RISK_CLASSES.indexOf(clean(value,8).toUpperCase());return index;}
export function specFor(operation){return OPERATION_SPECS[clean(operation,80).toLowerCase()]||null;}
export function computeRisk(operation,suppliedRisk=null){const spec=specFor(operation);const computed=spec?.risk||'S5';if(suppliedRisk!=null){const supplied=clean(suppliedRisk,8).toUpperCase();if(riskIndex(supplied)<0)throw new DOMException('invalid supplied risk class','SecurityError');if(riskIndex(supplied)<riskIndex(computed))throw new DOMException('caller cannot understate computed risk','SecurityError');return riskIndex(supplied)>riskIndex(computed)?supplied:computed;}return computed;}
export function requiredApprovalRoles(risk){risk=clean(risk,8).toUpperCase();if(risk==='S3')return ['HUMAN_APPROVER'];if(risk==='S4')return ['HUMAN_RELEASE_APPROVER','INDEPENDENT_VERIFIER'];if(risk==='S5')return ['HUMAN_SECURITY_APPROVER','INDEPENDENT_VERIFIER'];return [];}
export function normalizeProjectPath(value){let path=clean(value,500).replace(/\\/g,'/');if(!path)throw new TypeError('path required');if(path.startsWith('/')||path.includes('\0')||path.split('/').some(part=>part===''||part==='.'||part==='..'))throw new DOMException('path escapes isolated worktree','SecurityError');if(path.length>500)throw new TypeError('path too long');return path;}
export function parseTerminalRead(command){const raw=clean(command,1000);if(!raw)throw new TypeError('terminal command required');if(CONTROL_RX.test(raw))throw new DOMException('terminal shell/control operators forbidden','SecurityError');const parts=raw.split(/\s+/);const op=parts.shift()?.toLowerCase();if(!['pwd','ls','cat','status','diff'].includes(op))throw new DOMException('terminal command outside bounded read vocabulary','SecurityError');if(['pwd','status','diff'].includes(op)&&parts.length)throw new DOMException('unexpected terminal arguments','SecurityError');if(op==='ls'&&parts.length>1)throw new DOMException('ls accepts at most one relative path','SecurityError');if(op==='cat'&&parts.length!==1)throw new DOMException('cat requires one relative path','SecurityError');return {op,args:parts.map(normalizeProjectPath)};}
export function normalizeDestination(value){let url;try{url=new URL(clean(value,2048));}catch{throw new DOMException('valid HTTPS destination required','SecurityError');}if(url.protocol!=='https:'||url.username||url.password||url.hash)throw new DOMException('credential-free HTTPS destination required','SecurityError');return {url:url.toString(),host:url.hostname.toLowerCase().replace(/\.$/,'')};}
export function networkAllows(policy,destination){if(!destination)return false;if(policy===NETWORK_DENY||!policy)return false;if(!policy||typeof policy!=='object'||Array.isArray(policy)||clean(policy.mode,32).toUpperCase()!=='ALLOWLIST')return false;const host=normalizeDestination(destination).host;const hosts=[...new Set((policy.hosts||[]).map(value=>clean(value,253).toLowerCase().replace(/^\./,'')).filter(Boolean))];return hosts.some(allowed=>host===allowed||host.endsWith(`.${allowed}`));}
export function boundedCost(value=1){const n=Number(value);if(!Number.isInteger(n)||n<0||n>MAX_COMPUTE_UNITS)throw new TypeError('compute cost outside bounded range');return n;}
export function normalizeProvenance(value='GOVERNED_PLAN'){const p=clean(value,40).toUpperCase();if(!INSTRUCTION_PROVENANCE.includes(p))throw new DOMException('unrecognized instruction provenance','SecurityError');return p;}
export function ensureContentSize(value){const bytes=new TextEncoder().encode(String(value??''));if(bytes.length>MAX_FILE_BYTES)throw new DOMException('file content exceeds sandbox limit','QuotaExceededError');return String(value??'');}
