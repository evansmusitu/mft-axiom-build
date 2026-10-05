export const FA06_FOUNDATION_VERSION = 'musitu.axiom.final-product-foundation.v1';

export const AXIOM_OBJECT_TYPES = Object.freeze(['Project','Work','Agent','Artifact','Evidence']);

const ENVELOPE_FIELDS = Object.freeze(['schema','type','id','version','created_at','updated_at','data']);
const ID_PATTERN = /^(?:project|work|agent|artifact|evidence)_[A-Za-z0-9][A-Za-z0-9._:-]{7,191}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

const TYPE_PREFIX = Object.freeze({
  Project:'project',
  Work:'work',
  Agent:'agent',
  Artifact:'artifact',
  Evidence:'evidence',
});

const DOMAIN_FIELDS = Object.freeze({
  Project:Object.freeze(['goal','objects','work','agents','artifacts','sources','memory','evidence','decisions','deployments','evaluations','failures']),
  Work:Object.freeze(['objective','acceptance_criteria','plan','tasks','agents','capabilities','approvals','budget','deadline','checkpoints','outputs','verification']),
  Agent:Object.freeze(['identity','role','purpose','tool_scopes','data_scopes','network_scope','autonomy','budget','policies','model_route','status','history','kill_switch','evidence']),
  Artifact:Object.freeze(['artifact_type','versions','provenance','dependencies','diff','comments','permissions','export','rollback']),
  Evidence:Object.freeze(['inputs','sources','capability_chain','calculations','actions','policies','approvals','hashes','receipts','verification','failures','timestamps','versions']),
});

const ARRAY_FIELDS = new Set([
  'objects','work','agents','artifacts','sources','evidence','decisions','deployments','evaluations','failures',
  'acceptance_criteria','plan','tasks','capabilities','approvals','checkpoints','outputs',
  'tool_scopes','data_scopes','policies','history',
  'versions','provenance','dependencies','diff','comments','permissions',
  'inputs','capability_chain','calculations','actions','hashes','receipts','timestamps'
]);

const SAFE_SCALAR_OR_OBJECT_FIELDS = new Set([
  'goal','memory','objective','budget','deadline','verification','identity','role','purpose','network_scope','autonomy',
  'model_route','status','kill_switch','artifact_type','export','rollback'
]);

const FORBIDDEN_KEY = /^(?:access|refresh|id)?_?token$|authorization|api_?key|password|private_?key|client_?secret|secret$/i;

function isPlainObject(value){
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function assertNoCredentialMaterial(value,path='object'){
  if (!value || typeof value !== 'object') return;
  for (const [key,child] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key)) throw new TypeError(`${path}.${key} contains forbidden credential material`);
    assertNoCredentialMaterial(child,`${path}.${key}`);
  }
}

function isIsoInstant(value){
  return typeof value === 'string' && ISO_DATE_PATTERN.test(value) && Number.isFinite(Date.parse(value));
}

function validateDomainField(name,value,errors){
  if (ARRAY_FIELDS.has(name)) {
    if (!Array.isArray(value)) errors.push(`${name} must be an array`);
    return;
  }
  if (name === 'network_scope') {
    if (!(typeof value === 'string' || isPlainObject(value))) errors.push('network_scope must be a string or object');
    return;
  }
  if (name === 'kill_switch') {
    if (!(typeof value === 'boolean' || isPlainObject(value))) errors.push('kill_switch must be boolean or object');
    return;
  }
  if (SAFE_SCALAR_OR_OBJECT_FIELDS.has(name)) {
    const ok = value === null || ['string','number','boolean'].includes(typeof value) || isPlainObject(value) || Array.isArray(value);
    if (!ok) errors.push(`${name} has unsupported value type`);
    return;
  }
  if (value === undefined) errors.push(`${name} is required`);
}

export const OBJECT_CONTRACTS = Object.freeze(Object.fromEntries(
  AXIOM_OBJECT_TYPES.map(type => [type,Object.freeze({
    schema:`musitu.axiom.${type.toLowerCase()}.v1`,
    type,
    id_prefix:TYPE_PREFIX[type],
    required_fields:Object.freeze([...DOMAIN_FIELDS[type]]),
    authority:'DATA_CONTRACT_NOT_AUTHORIZATION',
  })])
));

export function validateAxiomObject(candidate,{expectedType=null}={}){
  const errors=[];
  if (!isPlainObject(candidate)) return Object.freeze({ok:false,errors:Object.freeze(['object must be a plain object']),type:null});
  try { assertNoCredentialMaterial(candidate); } catch (error) { errors.push(error.message); }

  for (const field of ENVELOPE_FIELDS) if (!(field in candidate)) errors.push(`${field} is required`);
  for (const field of Object.keys(candidate)) if (!ENVELOPE_FIELDS.includes(field)) errors.push(`unsupported envelope field: ${field}`);

  const type = typeof candidate.type === 'string' ? candidate.type : null;
  if (!AXIOM_OBJECT_TYPES.includes(type)) errors.push('type must be one of Project, Work, Agent, Artifact, Evidence');
  if (expectedType && type !== expectedType) errors.push(`expected ${expectedType} but received ${type || 'unknown'}`);

  const contract = type && OBJECT_CONTRACTS[type];
  if (contract && candidate.schema !== contract.schema) errors.push(`schema must equal ${contract.schema}`);
  if (!Number.isInteger(candidate.version) || candidate.version < 1) errors.push('version must be a positive integer');

  if (typeof candidate.id !== 'string' || !ID_PATTERN.test(candidate.id)) errors.push('id has invalid format');
  else if (contract && !candidate.id.startsWith(`${contract.id_prefix}_`)) errors.push(`id must begin with ${contract.id_prefix}_`);

  if (!isIsoInstant(candidate.created_at)) errors.push('created_at must be a UTC ISO instant');
  if (!isIsoInstant(candidate.updated_at)) errors.push('updated_at must be a UTC ISO instant');
  if (isIsoInstant(candidate.created_at) && isIsoInstant(candidate.updated_at) && Date.parse(candidate.updated_at) < Date.parse(candidate.created_at)) {
    errors.push('updated_at cannot precede created_at');
  }

  if (!isPlainObject(candidate.data)) errors.push('data must be a plain object');
  if (contract && isPlainObject(candidate.data)) {
    const expected = new Set(contract.required_fields);
    for (const field of expected) {
      if (!(field in candidate.data)) errors.push(`data.${field} is required`);
      else validateDomainField(field,candidate.data[field],errors);
    }
    for (const field of Object.keys(candidate.data)) if (!expected.has(field)) errors.push(`unsupported data field for ${type}: ${field}`);
  }

  return Object.freeze({ok:errors.length===0,errors:Object.freeze(errors),type});
}

export function assertAxiomObject(candidate,options={}){
  const result=validateAxiomObject(candidate,options);
  if (!result.ok) throw new TypeError(`AXIOM object contract violation: ${result.errors.join('; ')}`);
  return candidate;
}

export const DESIGN_TOKENS = Object.freeze({
  color:Object.freeze({
    canvas:'var(--axiom-canvas, #f7f8fa)',
    surface:'var(--axiom-surface, #ffffff)',
    text:'var(--axiom-text, #111827)',
    muted:'var(--axiom-muted, #667085)',
    line:'var(--axiom-line, #e4e7ec)',
    accent:'var(--axiom-accent, #111827)',
    danger:'var(--axiom-danger, #b42318)',
    warning:'var(--axiom-warning, #b54708)',
    success:'var(--axiom-success, #067647)',
  }),
  radius:Object.freeze({sm:'8px',md:'12px',lg:'18px',pill:'999px'}),
  spacing:Object.freeze({xs:'4px',sm:'8px',md:'12px',lg:'16px',xl:'24px',xxl:'32px'}),
  motion:Object.freeze({fast:'120ms',standard:'180ms',slow:'260ms'}),
  density:Object.freeze({home:'calm',workspace:'focused',advanced:'dense-on-demand'}),
});

export const SHELL_SURFACES = Object.freeze([
  Object.freeze({id:'home',label:'Home',group:'primary',presentation:'route',phase:'FA-06',state:'FOUNDATION'}),
  Object.freeze({id:'projects',label:'Projects',group:'primary',presentation:'route',phase:'FA-08',state:'EXISTING_LOCAL_FOUNDATION'}),
  Object.freeze({id:'work',label:'Work',group:'primary',presentation:'route',phase:'FA-08',state:'EXISTING_LOCAL_FOUNDATION'}),
  Object.freeze({id:'agents',label:'Agents',group:'primary',presentation:'route',phase:'FA-09',state:'FOUNDATION'}),
  Object.freeze({id:'research',label:'Research',group:'primary',presentation:'route',phase:'FA-14',state:'FOUNDATION'}),
  Object.freeze({id:'memory',label:'Knowledge / Memory',group:'primary',presentation:'route',phase:'FA-08',state:'FOUNDATION_ONLY'}),
  Object.freeze({id:'analyze',label:'Analyze',group:'primary',presentation:'route',phase:'FA-14',state:'EXISTING_COMPUTE_FOUNDATION'}),
  Object.freeze({id:'twin',label:'Twin / Scenario Lab',group:'primary',presentation:'route',phase:'FA-14',state:'FOUNDATION_ONLY'}),
  Object.freeze({id:'artifacts',label:'Artifacts',group:'primary',presentation:'route',phase:'FA-14',state:'FOUNDATION'}),
  Object.freeze({id:'create',label:'Create',group:'primary',presentation:'route',phase:'FA-14',state:'FOUNDATION'}),
  Object.freeze({id:'build',label:'Build',group:'primary',presentation:'route',phase:'FA-13',state:'FOUNDATION'}),
  Object.freeze({id:'computer',label:'Computer',group:'primary',presentation:'route',phase:'FA-15',state:'FOUNDATION'}),
  Object.freeze({id:'live',label:'Live',group:'primary',presentation:'route',phase:'FA-15',state:'FOUNDATION'}),
  Object.freeze({id:'automations',label:'Automations',group:'primary',presentation:'route',phase:'FA-15',state:'FOUNDATION'}),
  Object.freeze({id:'evidence',label:'Evidence Observatory',group:'platform',presentation:'route',phase:'FA-15',state:'FOUNDATION_ONLY'}),
  Object.freeze({id:'trust',label:'Trust',group:'platform',presentation:'route',phase:'FA-15',state:'FOUNDATION'}),
  Object.freeze({id:'developer',label:'Developer',group:'platform',presentation:'route',phase:'FA-15',state:'FOUNDATION'}),
  Object.freeze({id:'marketplace',label:'Marketplace',group:'platform',presentation:'route',phase:'FA-15',state:'FOUNDATION_ONLY'}),
  Object.freeze({id:'enterprise',label:'Enterprise Control Plane',group:'platform',presentation:'route',phase:'FA-15',state:'FOUNDATION_ONLY'}),
  Object.freeze({id:'inbox',label:'Inbox',group:'platform',presentation:'route',phase:'FA-15',state:'FOUNDATION_ONLY'}),
  Object.freeze({id:'search',label:'Search / Command',group:'global',presentation:'command',phase:'FA-06',state:'FOUNDATION'}),
  Object.freeze({id:'settings',label:'Settings',group:'platform',presentation:'route',phase:'FA-06',state:'FOUNDATION'}),
]);

export const FOUNDATION_ONLY_ROUTE_IDS = Object.freeze(
  SHELL_SURFACES.filter(surface => surface.presentation === 'route' && surface.state === 'FOUNDATION_ONLY').map(surface => surface.id)
);

export const CLAIM_BOUNDARIES = Object.freeze({
  certified_atomic_operations:74,
  public_axiom_plugin_tools:108,
  registered_native_derived_compositions:2400,
  discovered_candidate_dags:2235,
  discovered_candidate_dags_certified:false,
  highest_earned_interface_phase:12,
  phase_13:'SKIPPED_UNEARNED',
  phase_14:'INCOMPLETE_UNEARNED_PHYSICAL_TABLET_EVIDENCE_MISSING',
  phase_15:'UNEARNED_EXTERNAL_COMPARATIVE_CLAIM_BLOCKED',
  wolfram_parity:'NOT_CERTIFIED',
  superiority:'NOT_CERTIFIED',
});
