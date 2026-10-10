import { hashJson, merkleRoot } from "./canonical.ts";
import { compileProgram } from "./compiler.ts";
import type { OperationRegistry } from "./registry.ts";
import type { AxiomProgram, ExecutionResult, JsonValue, TraceEntry, TypedValue, VerificationResult } from "./types.ts";

function json(value:unknown):JsonValue { return value as JsonValue; }
function resolveValue(ref:any,program:AxiomProgram,outputs:Record<string,TypedValue>):TypedValue {
  if("input" in ref)return program.inputs[ref.input];
  if("node" in ref)return outputs[ref.node];
  return ref.literal;
}

export class AxiomRuntime {
  static readonly VERSION = "0.1.0";
  private readonly registry:OperationRegistry;
  constructor(registry:OperationRegistry){this.registry=registry;}
  execute(program:AxiomProgram):ExecutionResult {
    const p=compileProgram(program,this.registry), outputs:Record<string,TypedValue>={},trace:TraceEntry[]=[];
    const used=new Map<string,{id:string;version:string;implementationHash:string}>();
    const verifications:VerificationResult[]=[];
    for(const node of p.nodes){
      const def=this.registry.get(node.operation), resolved:Record<string,TypedValue>={};
      for(const [name,ref] of Object.entries(node.inputs))resolved[name]=resolveValue(ref,p,outputs);
      const expected=def.inferOutput(Object.fromEntries(Object.entries(resolved).map(([k,v])=>[k,v.type])),node.params??{});
      const output=def.execute({inputs:resolved,params:node.params??{}});
      const typeOk=JSON.stringify(expected)===JSON.stringify(output.type);
      verifications.push({id:`type:${node.id}`,kind:"type",ok:typeOk,severity:"error",message:typeOk?`Node ${node.id} output type verified`:`Node ${node.id} output type mismatch`});
      if(!typeOk)throw new Error(`Operation ${def.id} violated its output contract`);
      outputs[node.id]=output; used.set(def.id,{id:def.id,version:def.version,implementationHash:def.implementationHash});
      trace.push({nodeId:node.id,operation:def.id,operationVersion:def.version,implementationHash:def.implementationHash,inputHash:hashJson(json({inputs:resolved,params:node.params??{}})),outputHash:hashJson(json(output))});
    }
    for(const constraint of p.constraints){
      const value=outputs[constraint.node]?.value, ok=typeof value==="boolean"&&value===constraint.expected;
      verifications.push({id:constraint.id,kind:"constraint",ok,severity:constraint.severity,message:ok?`PASS: ${constraint.statement}`:`FAIL: ${constraint.statement}`});
    }
    const decision=outputs[p.decisionNodeId]?.value===true && !verifications.some(v=>v.severity==="error"&&!v.ok);
    const programHash=hashJson(json(p));
    const inputHashes=Object.entries(p.inputs).sort(([a],[b])=>a.localeCompare(b)).map(([name,value])=>hashJson(json({name,value})));
    const inputMerkleRoot=merkleRoot(inputHashes);
    const operationManifest=[...used.values()].sort((a,b)=>a.id.localeCompare(b.id));
    const base={status:"COMPLETED" as const,decisionStatus:(decision?"APPROVED":"DENIED") as "APPROVED"|"DENIED",programHash,inputMerkleRoot,outputs,trace,operationManifest,verifications};
    const executionHash=hashJson(json(base));
    return {...base,executionHash};
  }
}
