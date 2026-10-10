import { canonicalize, hashJson } from "../../phase1/src/canonical.ts";
import type { OperationRegistry } from "../../phase1/src/registry.ts";
import type {
  AxiomNode, AxiomProgram, ConstraintSpec, JsonValue, NodeKind, TypeRef, TypedValue, ValueRef
} from "../../phase1/src/types.ts";
import type {
  EvidenceRequirement, InputBinding, ModelCompileRequest, ModelCompilerProfile, ModelInputContract,
  ModelProgramProposal, TenantScope
} from "./types.ts";

const RESERVED_CONTEXT_PREFIX="AXIOM_PLATFORM_CONTEXT_SHA256:";
const NODE_KINDS=new Set<NodeKind>(["Transform","Hypothesis","Verify","Optimize","Decision"]);
const PROFILE_KEYS=[
  "profileId","version","adapterId","allowedOperationIds","maxRepairAttempts","maxInputs","maxNodes",
  "maxConstraints","maxAssumptions","maxObjectiveBytes","maxModelResponseBytes"
];

function required(value:unknown,label:string):string {
  if(typeof value!=="string"||!value.trim())throw new TypeError(`${label} is required`);
  return value;
}
function integer(value:unknown,label:string,min=0):number {
  if(!Number.isInteger(value)||(value as number)<min)throw new TypeError(`${label} must be an integer >= ${min}`);
  return value as number;
}
function plain(value:unknown,label:string):Record<string,unknown> {
  if(!value||typeof value!=="object"||Array.isArray(value))throw new TypeError(`${label} must be an object`);
  return value as Record<string,unknown>;
}
function exactKeys(value:Record<string,unknown>,allowed:string[],label:string):void {
  const allowedSet=new Set(allowed);
  for(const key of Object.keys(value))if(!allowedSet.has(key))throw new TypeError(`${label} contains forbidden or unknown field: ${key}`);
}
function jsonClone<T>(value:T,label:string):T {
  try{return JSON.parse(canonicalize(value as any)) as T;}
  catch{throw new TypeError(`${label} must contain canonical JSON data`);}
}
function unique(values:string[],label:string):void {
  const seen=new Set<string>();
  for(const value of values){
    required(value,label);
    if(seen.has(value))throw new TypeError(`Duplicate ${label}: ${value}`);
    seen.add(value);
  }
}
function validateTypeRef(value:unknown,label="type"):TypeRef {
  const t=plain(value,label);
  const kind=required(t.kind,`${label}.kind`);
  if(kind==="number"){
    exactKeys(t,["kind","unit"],label);return {kind:"number",unit:required(t.unit,`${label}.unit`)};
  }
  if(kind==="decimal"){
    exactKeys(t,["kind","unit","scale"],label);
    const scale=integer(t.scale,`${label}.scale`,0);
    if(scale>18)throw new TypeError(`${label}.scale must be <= 18`);
    return {kind:"decimal",unit:required(t.unit,`${label}.unit`),scale};
  }
  if(kind==="boolean"){exactKeys(t,["kind"],label);return {kind:"boolean"};}
  if(kind==="string"){exactKeys(t,["kind"],label);return {kind:"string"};}
  if(kind==="series"){
    exactKeys(t,["kind","element"],label);return {kind:"series",element:validateTypeRef(t.element,`${label}.element`)};
  }
  if(kind==="record"){
    exactKeys(t,["kind","fields"],label);
    const fields=plain(t.fields,`${label}.fields`),out:Record<string,TypeRef>={};
    for(const name of Object.keys(fields).sort()){
      required(name,`${label}.field name`);
      out[name]=validateTypeRef(fields[name],`${label}.fields.${name}`);
    }
    return {kind:"record",fields:out};
  }
  throw new TypeError(`${label}.kind is unsupported`);
}
function placeholderValue(type:TypeRef):JsonValue {
  if(type.kind==="number")return 0;
  if(type.kind==="decimal")return "0";
  if(type.kind==="boolean")return false;
  if(type.kind==="string")return "";
  if(type.kind==="series")return [];
  const out:Record<string,JsonValue>={};
  for(const key of Object.keys(type.fields).sort())out[key]=placeholderValue(type.fields[key]);
  return out;
}
function canonicalProfile(input:ModelCompilerProfile):ModelCompilerProfile {
  const p=plain(input,"model compiler profile");
  exactKeys(p,PROFILE_KEYS,"model compiler profile");
  const allowed=[...(p.allowedOperationIds as any[]??[])].map((x,i)=>required(x,`allowedOperationIds[${i}]`));
  if(!allowed.length)throw new TypeError("allowedOperationIds must not be empty");
  unique(allowed,"allowed operation");
  const maxRepairAttempts=integer(p.maxRepairAttempts,"maxRepairAttempts",0);
  if(maxRepairAttempts>2)throw new TypeError("maxRepairAttempts must be between 0 and 2");
  return {
    profileId:required(p.profileId,"profileId"),
    version:required(p.version,"profile version"),
    adapterId:required(p.adapterId,"adapterId"),
    allowedOperationIds:[...allowed].sort(),
    maxRepairAttempts,
    maxInputs:integer(p.maxInputs,"maxInputs",1),
    maxNodes:integer(p.maxNodes,"maxNodes",1),
    maxConstraints:integer(p.maxConstraints,"maxConstraints",0),
    maxAssumptions:integer(p.maxAssumptions,"maxAssumptions",0),
    maxObjectiveBytes:integer(p.maxObjectiveBytes,"maxObjectiveBytes",1),
    maxModelResponseBytes:integer(p.maxModelResponseBytes,"maxModelResponseBytes",1)
  };
}
export function modelProfileHash(profile:ModelCompilerProfile):string {
  return hashJson(canonicalProfile(profile) as any);
}

export interface ModelCompilerProfileRegistration {
  profile:ModelCompilerProfile;
  tenantIds?:string[];
}
interface StoredProfile {profile:ModelCompilerProfile;profileHash:string;tenantIds?:Set<string>;}

export class ModelCompilerRegistry {
  private readonly profiles=new Map<string,StoredProfile>();
  constructor(registry:Pick<OperationRegistry,"get">,entries:ModelCompilerProfileRegistration[]){
    if(!Array.isArray(entries))throw new TypeError("model compiler profiles must be an array");
    for(const entry of entries){
      const profile=canonicalProfile(entry?.profile);
      if(this.profiles.has(profile.profileId))throw new TypeError(`Duplicate model compiler profile: ${profile.profileId}`);
      for(const op of profile.allowedOperationIds){
        try{registry.get(op);}catch{throw new TypeError(`Unknown allowed operation: ${op}`);}
      }
      let tenantIds:Set<string>|undefined;
      if(entry.tenantIds!==undefined){
        if(!Array.isArray(entry.tenantIds)||entry.tenantIds.length===0)throw new TypeError("tenantIds must not be empty when configured");
        unique(entry.tenantIds,"tenantId");
        tenantIds=new Set(entry.tenantIds.map(x=>required(x,"tenantId")));
      }
      this.profiles.set(profile.profileId,{profile,profileHash:hashJson(profile as any),tenantIds});
    }
  }
  resolve(scope:TenantScope,profileId:string):{profile:ModelCompilerProfile;profileHash:string}{
    const tenantId=required(scope?.tenantId,"tenantId"),id=required(profileId,"profileId");
    const stored=this.profiles.get(id);
    if(!stored)throw new Error(`Unknown model compiler profile: ${id}`);
    if(stored.tenantIds&&!stored.tenantIds.has(tenantId))throw new Error(`Model compiler profile is not eligible for tenant: ${tenantId}`);
    return {profile:structuredClone(stored.profile),profileHash:stored.profileHash};
  }
}

function parseValueRef(value:unknown,label:string):ValueRef {
  const ref=plain(value,label),keys=Object.keys(ref);
  if(keys.length!==1)throw new TypeError(`${label} must contain exactly one value reference`);
  if("input" in ref)return {input:required(ref.input,`${label}.input`)};
  if("node" in ref)return {node:required(ref.node,`${label}.node`)};
  if("literal" in ref){
    const literal=plain(ref.literal,`${label}.literal`);
    exactKeys(literal,["type","value"],`${label}.literal`);
    return {literal:{type:validateTypeRef(literal.type,`${label}.literal.type`),value:jsonClone(literal.value,`${label}.literal.value`)}};
  }
  throw new TypeError(`${label} contains an unsupported value reference`);
}
function parseNode(value:unknown,index:number,allowed:Set<string>):AxiomNode {
  const n=plain(value,`nodes[${index}]`);
  exactKeys(n,["id","kind","operation","inputs","params"],`nodes[${index}]`);
  const kind=required(n.kind,`nodes[${index}].kind`) as NodeKind;
  if(!NODE_KINDS.has(kind))throw new TypeError(`nodes[${index}].kind is unsupported`);
  const operation=required(n.operation,`nodes[${index}].operation`);
  if(!allowed.has(operation))throw new TypeError(`Model operation is not allowed by compiler profile: ${operation}`);
  const inputsObj=plain(n.inputs,`nodes[${index}].inputs`),inputs:Record<string,ValueRef>={};
  for(const key of Object.keys(inputsObj).sort())inputs[required(key,"node input name")]=parseValueRef(inputsObj[key],`nodes[${index}].inputs.${key}`);
  const out:AxiomNode={id:required(n.id,`nodes[${index}].id`),kind,operation,inputs};
  if(n.params!==undefined)out.params=jsonClone(plain(n.params,`nodes[${index}].params`),`nodes[${index}].params`) as Record<string,JsonValue>;
  return out;
}
function parseConstraint(value:unknown,index:number):ConstraintSpec {
  const c=plain(value,`constraints[${index}]`);
  exactKeys(c,["id","node","statement","severity","expected"],`constraints[${index}]`);
  if(c.severity!=="error"&&c.severity!=="warning")throw new TypeError(`constraints[${index}].severity is invalid`);
  if(typeof c.expected!=="boolean")throw new TypeError(`constraints[${index}].expected must be boolean`);
  return {
    id:required(c.id,`constraints[${index}].id`),node:required(c.node,`constraints[${index}].node`),
    statement:required(c.statement,`constraints[${index}].statement`),severity:c.severity,expected:c.expected
  };
}

export function parseModelProposal(value:unknown,profileInput:ModelCompilerProfile):ModelProgramProposal {
  const profile=canonicalProfile(profileInput),p=plain(value,"model proposal");
  exactKeys(p,["assumptions","nodes","constraints","decisionNodeId"],"model proposal");
  if(!Array.isArray(p.assumptions))throw new TypeError("model proposal assumptions must be an array");
  if(!Array.isArray(p.nodes))throw new TypeError("model proposal nodes must be an array");
  if(!Array.isArray(p.constraints))throw new TypeError("model proposal constraints must be an array");
  if(p.assumptions.length>profile.maxAssumptions)throw new RangeError("model proposal assumptions exceed profile limit");
  if(p.nodes.length>profile.maxNodes)throw new RangeError("model proposal nodes exceed profile limit");
  if(p.constraints.length>profile.maxConstraints)throw new RangeError("model proposal constraints exceed profile limit");
  const assumptions=p.assumptions.map((x,i)=>required(x,`assumptions[${i}]`));
  if(assumptions.some(x=>x.startsWith(RESERVED_CONTEXT_PREFIX)))throw new Error("Model proposal uses reserved AXIOM platform-context assumption namespace");
  const allowed=new Set(profile.allowedOperationIds);
  return {
    assumptions,
    nodes:p.nodes.map((x,i)=>parseNode(x,i,allowed)),
    constraints:p.constraints.map((x,i)=>parseConstraint(x,i)),
    decisionNodeId:required(p.decisionNodeId,"decisionNodeId")
  };
}

function canonicalContracts(input:unknown,profile:ModelCompilerProfile):ModelInputContract[] {
  if(!Array.isArray(input))throw new TypeError("inputContracts must be an array");
  if(input.length===0)throw new TypeError("inputContracts must not be empty");
  if(input.length>profile.maxInputs)throw new RangeError("inputContracts exceed profile maxInputs limit");
  const contracts=input.map((raw,index)=>{
    const c=plain(raw,`inputContracts[${index}]`);
    exactKeys(c,["inputName","type","entity","attribute","requirementId","maxAgeMs"],`inputContracts[${index}]`);
    return {
      inputName:required(c.inputName,`inputContracts[${index}].inputName`),
      type:validateTypeRef(c.type,`inputContracts[${index}].type`),
      entity:required(c.entity,`inputContracts[${index}].entity`),
      attribute:required(c.attribute,`inputContracts[${index}].attribute`),
      requirementId:required(c.requirementId,`inputContracts[${index}].requirementId`),
      maxAgeMs:integer(c.maxAgeMs,`inputContracts[${index}].maxAgeMs`,0)
    } satisfies ModelInputContract;
  });
  unique(contracts.map(x=>x.inputName),"inputName");
  unique(contracts.map(x=>x.requirementId),"requirementId");
  return contracts.sort((a,b)=>a.inputName.localeCompare(b.inputName));
}
export function canonicalModelInputContracts(input:unknown,profileInput:ModelCompilerProfile):ModelInputContract[] {
  return canonicalContracts(input,canonicalProfile(profileInput));
}
export function modelContractHash(contract:ModelInputContract):string {
  return hashJson(contract as any);
}

export function assembleModelProgram(request:ModelCompileRequest,proposalValue:ModelProgramProposal,profileInput:ModelCompilerProfile):AxiomProgram {
  const profile=canonicalProfile(profileInput);
  const objective=required(request?.objective,"objective");
  if(Buffer.byteLength(objective,"utf8")>profile.maxObjectiveBytes)throw new RangeError("objective exceeds profile byte limit");
  if(required(request?.profileId,"profileId")!==profile.profileId)throw new Error("Compile request profileId does not match resolved profile");
  const contracts=canonicalContracts(request?.inputContracts,profile);
  const proposal=parseModelProposal(proposalValue,profile);
  const declared=new Set(contracts.map(x=>x.inputName));
  for(const node of proposal.nodes){
    for(const ref of Object.values(node.inputs)){
      if("input" in ref&&!declared.has(ref.input))throw new Error(`Model proposal references undeclared input: ${ref.input}`);
    }
  }
  const inputs:Record<string,TypedValue>={};
  for(const contract of contracts){
    const value=placeholderValue(contract.type),contractHash=modelContractHash(contract);
    inputs[contract.inputName]={
      type:structuredClone(contract.type),value,
      provenance:{source:`model-compile-contract:${contractHash}:${contract.inputName}`,contentHash:hashJson(value as any)}
    };
  }
  return {
    irVersion:"0.1",objective,assumptions:structuredClone(proposal.assumptions),inputs,
    nodes:structuredClone(proposal.nodes),constraints:structuredClone(proposal.constraints),decisionNodeId:proposal.decisionNodeId
  };
}

export function modelContractsToExecution(inputContracts:ModelInputContract[]):{requirements:EvidenceRequirement[];bindings:InputBinding[]} {
  if(!Array.isArray(inputContracts)||inputContracts.length===0)throw new TypeError("inputContracts must not be empty");
  const inputNames=inputContracts.map(x=>required(x.inputName,"inputName")),requirementIds=inputContracts.map(x=>required(x.requirementId,"requirementId"));
  unique(inputNames,"inputName");unique(requirementIds,"requirementId");
  const requirements=inputContracts.map(x=>({
    id:x.requirementId,entity:required(x.entity,"entity"),attribute:required(x.attribute,"attribute"),maxAgeMs:integer(x.maxAgeMs,"maxAgeMs",0)
  })).sort((a,b)=>a.id.localeCompare(b.id));
  const bindings=inputContracts.map(x=>({
    inputName:x.inputName,entity:x.entity,attribute:x.attribute
  })).sort((a,b)=>a.inputName.localeCompare(b.inputName));
  return {requirements,bindings};
}
