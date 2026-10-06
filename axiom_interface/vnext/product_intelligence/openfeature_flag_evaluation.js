export const OPENFEATURE_EVALUATION_DESCRIPTOR=Object.freeze({
  standard:'OpenFeature',mechanism_reference:'@openfeature/server-sdk',qualification_baseline:'1.23.0',
  semantic_owner:'AXIOM',authority:'MECHANISM_ONLY',
  capabilities:Object.freeze(['evaluate-boolean','evaluate-string','evaluate-number','evaluate-object','identity-binding-guard','deterministic-evaluation-evidence']),
  release_authority:false,production_authority:false,certification_authority:false,
  live_runtime_qualification:'NOT_PROVEN',fail_closed:true,
});

const ID=/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,299}$/;
const REQUEST_KEYS=new Set(['projectId','workId','agentId','requestId','flagKey','valueType','defaultValue','context']);
const CONTEXT_KEYS=new Set(['targetingKey','attributes']);
const RESERVED_CONTEXT_KEYS=new Set([
  'axiom_project_id','axiom_work_id','axiom_agent_id','axiom_request_id',
  'release_authority','production_authority','certification_authority','policy_authority','identity_authority','canonical_evidence',
  'allow_release','allow_production','certified','authority_effect',
]);
const PROVIDER_AUTHORITY_KEYS=new Set([
  'release_authority','production_authority','certification_authority','policy_authority','identity_authority','canonical_evidence',
  'allow_release','allow_production','certified','authority_effect',
]);
const FORBIDDEN_CREDENTIAL_KEY=/^(?:access|refresh|id)?_?token$|authorization|api_?key|password|private_?key|client_?secret|secret$/i;
const TYPE_METHOD=Object.freeze({boolean:'getBooleanDetails',string:'getStringDetails',number:'getNumberDetails',object:'getObjectDetails'});
const isPlainObject=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const clean=(value,max=300)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);
function id(name,value){const v=clean(value);if(!ID.test(v))throw new TypeError(name+' invalid');return v;}
function rejectUnknownKeys(value,allowed,label){if(!isPlainObject(value))throw new TypeError(label+' must be a plain object');const extra=Object.keys(value).filter(key=>!allowed.has(key));if(extra.length)throw new DOMException(label+' contains unsupported fields: '+extra.join(','),'SecurityError');}
function normalizeContextValue(value,path,depth=0){
  if(depth>8)throw new RangeError(path+' exceeds nesting limit');
  if(value===null||typeof value==='string'||typeof value==='boolean')return value;
  if(typeof value==='number'){if(!Number.isFinite(value))throw new TypeError(path+' must be finite');return value;}
  if(Array.isArray(value)){if(value.length>128)throw new RangeError(path+' exceeds array limit');return value.map((item,index)=>normalizeContextValue(item,path+'['+index+']',depth+1));}
  if(!isPlainObject(value))throw new TypeError(path+' contains unsupported value type');
  const keys=Object.keys(value);if(keys.length>128)throw new RangeError(path+' exceeds object key limit');
  const out={};
  for(const key of keys.sort()){
    if(!key||key.length>160)throw new TypeError(path+' key invalid');
    if(key.startsWith('axiom_')||RESERVED_CONTEXT_KEYS.has(key))throw new DOMException(path+'.'+key+' attempts reserved AXIOM identity or authority','SecurityError');
    if(FORBIDDEN_CREDENTIAL_KEY.test(key))throw new DOMException(path+'.'+key+' contains forbidden credential material','SecurityError');
    out[key]=normalizeContextValue(value[key],path+'.'+key,depth+1);
  }
  return out;
}
function normalizeAttributes(value){if(value===undefined)return {};if(!isPlainObject(value))throw new TypeError('context.attributes must be a plain object');return normalizeContextValue(value,'context.attributes');}
function rejectProviderAuthority(value,path='provider',depth=0){
  if(depth>10)throw new RangeError(path+' exceeds provider-result nesting limit');
  if(!value||typeof value!=='object')return;
  for(const [key,child] of Object.entries(value)){
    if(key==='authority'){
      if(child!==undefined&&child!==null&&child!==false&&child!=='NONE'&&child!=='MECHANISM_ONLY')throw new DOMException(path+'.authority attempted forbidden authority','SecurityError');
    }else if(PROVIDER_AUTHORITY_KEYS.has(key)){
      if(child!==undefined&&child!==null&&child!==false&&child!=='NONE'&&child!=='NOT_PROVEN')throw new DOMException(path+'.'+key+' attempted forbidden authority','SecurityError');
    }
    rejectProviderAuthority(child,path+'.'+key,depth+1);
  }
}
function normalizeJsonValue(value,path='value',depth=0){
  if(depth>10)throw new RangeError(path+' exceeds nesting limit');
  if(value===null||typeof value==='boolean')return value;
  if(typeof value==='string'){if(value.length>65536)throw new RangeError(path+' exceeds string limit');return value;}
  if(typeof value==='number'){if(!Number.isFinite(value))throw new TypeError(path+' must be finite');return value;}
  if(Array.isArray(value)){if(value.length>1024)throw new RangeError(path+' exceeds array limit');return value.map((item,index)=>normalizeJsonValue(item,path+'['+index+']',depth+1));}
  if(!isPlainObject(value))throw new TypeError(path+' must be JSON-compatible');
  const keys=Object.keys(value);if(keys.length>1024)throw new RangeError(path+' exceeds object key limit');
  const out={};
  for(const key of keys.sort()){
    if(!key||key.length>256)throw new TypeError(path+' key invalid');
    if(FORBIDDEN_CREDENTIAL_KEY.test(key))throw new DOMException(path+'.'+key+' contains forbidden credential material','SecurityError');
    out[key]=normalizeJsonValue(value[key],path+'.'+key,depth+1);
  }
  return out;
}
function normalizeProviderText(value,label,max){
  if(value===undefined||value===null)return null;
  if(typeof value!=='string')throw new TypeError('OpenFeature '+label+' must be a string');
  return clean(value,max);
}
function normalizeTypedValue(valueType,value,label){
  if(valueType==='boolean'){if(typeof value!=='boolean')throw new TypeError('OpenFeature boolean value required');return value;}
  if(valueType==='string'){if(typeof value!=='string')throw new TypeError('OpenFeature string value required');return normalizeJsonValue(value,label);}
  if(valueType==='number'){if(typeof value!=='number'||!Number.isFinite(value))throw new TypeError('OpenFeature number value required');return value;}
  if(valueType==='object'){
    if(!(isPlainObject(value)||Array.isArray(value)))throw new TypeError('OpenFeature object value required');
    return normalizeJsonValue(value,label);
  }
  throw new TypeError('valueType unsupported');
}

function createIdentityGuard(expected){
  const assertBound=hookContext=>{
    const context=hookContext?.context;
    if(!context||typeof context!=='object')throw new DOMException('OpenFeature identity binding mismatch: context missing','SecurityError');
    for(const [key,value] of Object.entries(expected)){
      if(context[key]!==value)throw new DOMException('OpenFeature identity binding mismatch: '+key,'SecurityError');
    }
  };
  return Object.freeze({before:assertBound,after:assertBound,finally:assertBound});
}
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));return value;}
async function sha256(value){const bytes=new TextEncoder().encode(JSON.stringify(canonical(value)));const digest=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');}

export function createOpenFeatureEvaluation({client,providerName}={}){
  if(!client||typeof client!=='object')throw new TypeError('OpenFeature client required');
  const provider=id('providerName',providerName);
  return Object.freeze({
    descriptor:OPENFEATURE_EVALUATION_DESCRIPTOR,
    async evaluate(request={}){
      rejectUnknownKeys(request,REQUEST_KEYS,'request');
      const {projectId,workId,agentId,requestId,flagKey,valueType,defaultValue,context={}}=request;
      rejectUnknownKeys(context,CONTEXT_KEYS,'context');
      const project_id=id('projectId',projectId),work_id=id('workId',workId),agent_id=id('agentId',agentId),request_id=id('requestId',requestId),flag_key=id('flagKey',flagKey);
      const method=TYPE_METHOD[valueType];if(!method)throw new TypeError('valueType unsupported');if(typeof client[method]!=='function')throw new TypeError('OpenFeature client '+method+' required');
      const normalizedDefault=normalizeTypedValue(valueType,defaultValue,'defaultValue');
      const targetingKey=id('context.targetingKey',context.targetingKey),attributes=normalizeAttributes(context.attributes);
      const providerContext={targetingKey,...structuredClone(attributes),axiom_project_id:project_id,axiom_work_id:work_id,axiom_agent_id:agent_id,axiom_request_id:request_id};
      const evaluation_context_sha256=await sha256(providerContext);
      const guard=createIdentityGuard({targetingKey,axiom_project_id:project_id,axiom_work_id:work_id,axiom_agent_id:agent_id,axiom_request_id:request_id});
      const details=await client[method](flag_key,structuredClone(normalizedDefault),structuredClone(providerContext),{hooks:[guard]});
      if(!isPlainObject(details))throw new TypeError('OpenFeature evaluation details required');
      rejectProviderAuthority(details,'provider_result');
      const variant=normalizeProviderText(details.variant,'variant',256),reason=normalizeProviderText(details.reason,'reason',128);
      if(details.errorCode||details.errorMessage||String(reason??'').toUpperCase()==='ERROR')throw new DOMException('OpenFeature provider error'+(details.errorCode?': '+clean(details.errorCode,80):''),'OperationError');
      if(details.flagKey!==undefined&&details.flagKey!==flag_key)throw new DOMException('OpenFeature flag identity mismatch','DataError');
      const resolvedValue=normalizeTypedValue(valueType,details.value,'provider_result.value');
      const provider_metadata=details.flagMetadata===undefined?{}:normalizeJsonValue(details.flagMetadata,'provider_result.flagMetadata');
      if(!isPlainObject(provider_metadata))throw new TypeError('OpenFeature flagMetadata must be a plain object');
      const payload={
        schema:'musitu.axiom.openfeature-evaluation.v1',standard:'OpenFeature',provider,
        project_id,work_id,agent_id,request_id,flag_key,value_type:valueType,default_value:normalizedDefault,value:resolvedValue,provider_metadata,
        variant,reason,evaluation_context_sha256,
        canonical_evidence:false,authority_effect:'NONE',release_authority:false,production_authority:false,certification_authority:false,
        required_next_gate:'AXIOM_POLICY_ADMISSION',live_runtime_qualification:'NOT_PROVEN',
      };
      return Object.freeze({...payload,evaluation_sha256:await sha256(payload)});
    },
  });
}
