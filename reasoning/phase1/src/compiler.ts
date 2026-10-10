import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hashJson, sha256Hex } from "./canonical.ts";
import { OperationContractError, type OperationRegistry } from "./registry.ts";
import type { AxiomNode, AxiomProgram, CompilerManifest, JsonValue, TypeRef, TypedValue, ValueRef } from "./types.ts";

const COMPILER_VERSION="1.0.0";
const COMPILER_IMPLEMENTATION_HASH=sha256Hex(readFileSync(fileURLToPath(import.meta.url),"utf8"));

export function compilerManifest():CompilerManifest {
  return {id:"axiom.phase1-compiler",version:COMPILER_VERSION,implementationHash:COMPILER_IMPLEMENTATION_HASH};
}

export interface ValidationIssue { code:string; message:string; nodeId?:string; }
export class ProgramValidationError extends Error {
  readonly issues: ValidationIssue[];
  constructor(issues: ValidationIssue[]){ super("Program validation failed"); this.issues=issues; }
}

function cloneProgram(program:AxiomProgram):AxiomProgram { return structuredClone(program); }
function refNode(ref:ValueRef):string|undefined { return "node" in ref?ref.node:undefined; }

function validateValue(type:TypeRef,value:JsonValue,path:string,issues:ValidationIssue[],nodeId?:string):void {
  const fail=(message:string)=>issues.push({code:"VALUE_TYPE_MISMATCH",message:`${path}: ${message}`,nodeId});
  switch(type.kind){
    case "number":
      if(typeof value!=="number"||!Number.isFinite(value))fail("expected a finite number");
      return;
    case "decimal": {
      if(typeof value!=="string"){fail("expected a base-10 decimal string");return;}
      const match=/^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
      if(!match){fail("invalid decimal syntax");return;}
      const frac=match[3]??"";
      if(frac.length>type.scale)fail(`decimal has ${frac.length} fractional digits but declared scale is ${type.scale}`);
      return;
    }
    case "boolean":
      if(typeof value!=="boolean")fail("expected boolean");
      return;
    case "string":
      if(typeof value!=="string")fail("expected string");
      return;
    case "series":
      if(!Array.isArray(value)){fail("expected array");return;}
      value.forEach((item,index)=>validateValue(type.element,item,`${path}[${index}]`,issues,nodeId));
      return;
    case "record":
      if(value===null||Array.isArray(value)||typeof value!=="object"){fail("expected object record");return;}
      for(const [field,fieldType] of Object.entries(type.fields)){
        if(!(field in value)){fail(`missing record field ${field}`);continue;}
        validateValue(fieldType,(value as Record<string,JsonValue>)[field],`${path}.${field}`,issues,nodeId);
      }
      for(const field of Object.keys(value))if(!(field in type.fields))fail(`unexpected record field ${field}`);
      return;
  }
}

function resolveType(ref:ValueRef, inputs:Record<string,TypedValue>, outputs:Map<string,TypeRef>):TypeRef {
  if("input" in ref){const v=inputs[ref.input];if(!v)throw new OperationContractError("MISSING_INPUT",`Unknown input: ${ref.input}`);return v.type;}
  if("node" in ref){const t=outputs.get(ref.node);if(!t)throw new OperationContractError("MISSING_NODE_REFERENCE",`Unknown or unresolved node: ${ref.node}`);return t;}
  return ref.literal.type;
}
function topo(nodes:AxiomNode[],issues:ValidationIssue[]):AxiomNode[] {
  const byId=new Map<string,AxiomNode>();
  for(const n of nodes){if(byId.has(n.id))issues.push({code:"DUPLICATE_NODE",message:`Duplicate node id: ${n.id}`,nodeId:n.id}); else byId.set(n.id,n);}
  const state=new Map<string,number>(),out:AxiomNode[]=[];
  const visit=(id:string,stack:string[])=>{
    const n=byId.get(id); if(!n)return;
    const s=state.get(id)??0; if(s===2)return;
    if(s===1){issues.push({code:"CYCLE_DETECTED",message:`Cycle detected: ${[...stack,id].join(" -> ")}`,nodeId:id});return;}
    state.set(id,1);
    const deps=Object.values(n.inputs).map(refNode).filter((x): x is string => Boolean(x)).sort();
    for(const dep of deps){if(!byId.has(dep))issues.push({code:"MISSING_NODE_REFERENCE",message:`Unknown node reference: ${dep}`,nodeId:n.id});else visit(dep,[...stack,id]);}
    state.set(id,2);out.push(n);
  };
  for(const n of [...nodes].sort((a,b)=>a.id.localeCompare(b.id)))visit(n.id,[]);
  return out;
}

export function compileProgram(program:AxiomProgram,registry:OperationRegistry):AxiomProgram {
  const p=cloneProgram(program), issues:ValidationIssue[]=[];
  if(p.irVersion!=="0.1")issues.push({code:"UNSUPPORTED_IR_VERSION",message:`Unsupported IR version: ${p.irVersion}`});
  if(typeof p.objective!=="string"||!p.objective.trim())issues.push({code:"MISSING_OBJECTIVE",message:"objective is required"});
  for(const [name,value] of Object.entries(p.inputs)){
    validateValue(value.type,value.value,`input ${name}`,issues);
    if(!value.provenance) issues.push({code:"MISSING_PROVENANCE",message:`Input ${name} has no provenance`});
    else if(value.provenance.contentHash!==hashJson(value.value)) issues.push({code:"PROVENANCE_HASH_MISMATCH",message:`Input ${name} content hash does not match its value`});
  }
  const ordered=topo(p.nodes,issues), outputTypes=new Map<string,TypeRef>();
  for(const node of ordered){
    for(const [name,ref] of Object.entries(node.inputs)){
      if("literal" in ref)validateValue(ref.literal.type,ref.literal.value,`literal ${node.id}.${name}`,issues,node.id);
    }
    try{
      const def=registry.get(node.operation), inTypes:Record<string,TypeRef>={};
      for(const [name,ref] of Object.entries(node.inputs))inTypes[name]=resolveType(ref,p.inputs,outputTypes);
      const output=def.inferOutput(inTypes,node.params??{}); outputTypes.set(node.id,output);
    }catch(err){
      if(err instanceof OperationContractError)issues.push({code:err.code,message:err.message,nodeId:node.id});
      else issues.push({code:"CONTRACT_ERROR",message:err instanceof Error?err.message:String(err),nodeId:node.id});
    }
  }
  if(!outputTypes.has(p.decisionNodeId))issues.push({code:"INVALID_DECISION_NODE",message:`Decision node does not exist or is invalid: ${p.decisionNodeId}`});
  else if(outputTypes.get(p.decisionNodeId)?.kind!=="boolean")issues.push({code:"TYPE_MISMATCH",message:"Decision node must output boolean",nodeId:p.decisionNodeId});
  for(const c of p.constraints){const t=outputTypes.get(c.node);if(!t)issues.push({code:"INVALID_CONSTRAINT_NODE",message:`Constraint references invalid node: ${c.node}`,nodeId:c.node});else if(t.kind!=="boolean")issues.push({code:"TYPE_MISMATCH",message:`Constraint ${c.id} must reference boolean output`,nodeId:c.node});}
  if(issues.length)throw new ProgramValidationError(issues);
  p.nodes=ordered;
  return p;
}
