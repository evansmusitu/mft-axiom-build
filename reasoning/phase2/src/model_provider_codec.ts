import { canonicalize } from "../../phase1/src/canonical.ts";
import type { ModelCompilerProfile } from "./types.ts";
import { ModelAdapterError } from "./model_adapter.ts";

function required(value:unknown,label:string):string{
  if(typeof value!=="string"||!value.trim())throw new ModelAdapterError("MODEL_GATEWAY_SCHEMA",`${label} is required`,502);
  return value;
}
function object(value:unknown,label:string):Record<string,any>{
  if(!value||typeof value!=="object"||Array.isArray(value))throw new ModelAdapterError("MODEL_GATEWAY_SCHEMA",`${label} must be an object`,502);
  return value as Record<string,any>;
}
function exact(value:Record<string,any>,keys:string[],label:string):void{
  const allowed=new Set(keys);
  if(Object.keys(value).some(k=>!allowed.has(k)))throw new ModelAdapterError("MODEL_GATEWAY_SCHEMA",`${label} contains an unknown field`,502);
  if(keys.some(k=>!(k in value)))throw new ModelAdapterError("MODEL_GATEWAY_SCHEMA",`${label} is missing a required field`,502);
}
function nullableString(value:unknown,label:string):string|null{
  if(value===null)return null;
  return required(value,label);
}
function parseJsonObject(text:string,label:string):Record<string,any>{
  let parsed:any;
  try{parsed=JSON.parse(text);}catch{throw new ModelAdapterError("MODEL_GATEWAY_SCHEMA",`${label} must contain valid JSON`,502);}
  return object(parsed,label);
}

export function modelProviderProposalWireSchema(profile:ModelCompilerProfile):Record<string,unknown>{
  const stringOrNull={anyOf:[{type:"string"},{type:"null"}]};
  return {
    type:"object",additionalProperties:false,required:["proposal"],
    properties:{
      proposal:{
        type:"object",additionalProperties:false,
        required:["assumptions","nodes","constraints","decisionNodeId"],
        properties:{
          assumptions:{type:"array",maxItems:profile.maxAssumptions,items:{type:"string"}},
          nodes:{
            type:"array",maxItems:profile.maxNodes,
            items:{
              type:"object",additionalProperties:false,required:["id","kind","operation","inputs","paramsJson"],
              properties:{
                id:{type:"string"},
                kind:{type:"string",enum:["Transform","Hypothesis","Verify","Optimize","Decision"]},
                operation:{type:"string",enum:[...profile.allowedOperationIds].sort()},
                inputs:{
                  type:"array",
                  items:{
                    type:"object",additionalProperties:false,required:["name","input","node","literalJson"],
                    properties:{name:{type:"string"},input:stringOrNull,node:stringOrNull,literalJson:stringOrNull}
                  }
                },
                paramsJson:{type:"string"}
              }
            }
          },
          constraints:{
            type:"array",maxItems:profile.maxConstraints,
            items:{
              type:"object",additionalProperties:false,required:["id","node","statement","severity","expected"],
              properties:{
                id:{type:"string"},node:{type:"string"},statement:{type:"string"},
                severity:{type:"string",enum:["error","warning"]},expected:{type:"boolean"}
              }
            }
          },
          decisionNodeId:{type:"string"}
        }
      }
    }
  };
}

export function normalizeModelProviderProposalWire(text:string):string{
  let root:any;
  try{root=JSON.parse(required(text,"provider output text"));}catch(error){
    if(error instanceof ModelAdapterError)throw error;
    throw new ModelAdapterError("MODEL_GATEWAY_SCHEMA","Provider output text is not valid JSON",502);
  }
  const top=object(root,"provider gateway output");exact(top,["proposal"],"provider gateway output");
  const proposal=object(top.proposal,"proposal");exact(proposal,["assumptions","nodes","constraints","decisionNodeId"],"proposal");
  if(!Array.isArray(proposal.assumptions)||proposal.assumptions.some((x:any)=>typeof x!=="string"))throw new ModelAdapterError("MODEL_GATEWAY_SCHEMA","proposal assumptions are invalid",502);
  if(!Array.isArray(proposal.nodes))throw new ModelAdapterError("MODEL_GATEWAY_SCHEMA","proposal nodes are invalid",502);
  if(!Array.isArray(proposal.constraints))throw new ModelAdapterError("MODEL_GATEWAY_SCHEMA","proposal constraints are invalid",502);

  const nodes=proposal.nodes.map((raw:any,index:number)=>{
    const node=object(raw,`nodes[${index}]`);exact(node,["id","kind","operation","inputs","paramsJson"],`nodes[${index}]`);
    if(!Array.isArray(node.inputs))throw new ModelAdapterError("MODEL_GATEWAY_SCHEMA",`nodes[${index}].inputs must be an array`,502);
    const inputs:Record<string,any>={};
    for(let j=0;j<node.inputs.length;j++){
      const item=object(node.inputs[j],`nodes[${index}].inputs[${j}]`);
      exact(item,["name","input","node","literalJson"],`nodes[${index}].inputs[${j}]`);
      const name=required(item.name,`nodes[${index}].inputs[${j}].name`);
      if(name in inputs)throw new ModelAdapterError("MODEL_GATEWAY_SCHEMA",`Duplicate model input binding: ${name}`,502);
      const input=nullableString(item.input,"input reference"),nodeRef=nullableString(item.node,"node reference"),literalJson=nullableString(item.literalJson,"literalJson");
      if([input,nodeRef,literalJson].filter(x=>x!==null).length!==1)throw new ModelAdapterError("MODEL_GATEWAY_SCHEMA","Each model input binding must select exactly one reference",502);
      if(input!==null)inputs[name]={input};
      else if(nodeRef!==null)inputs[name]={node:nodeRef};
      else inputs[name]={literal:parseJsonObject(literalJson!,"literalJson")};
    }
    const params=parseJsonObject(required(node.paramsJson,`nodes[${index}].paramsJson`),`nodes[${index}].paramsJson`);
    return {id:required(node.id,"node id"),kind:required(node.kind,"node kind"),operation:required(node.operation,"node operation"),inputs,params};
  });

  const constraints=proposal.constraints.map((raw:any,index:number)=>{
    const c=object(raw,`constraints[${index}]`);exact(c,["id","node","statement","severity","expected"],`constraints[${index}]`);
    if(c.severity!=="error"&&c.severity!=="warning")throw new ModelAdapterError("MODEL_GATEWAY_SCHEMA","constraint severity is invalid",502);
    if(typeof c.expected!=="boolean")throw new ModelAdapterError("MODEL_GATEWAY_SCHEMA","constraint expected must be boolean",502);
    return {id:required(c.id,"constraint id"),node:required(c.node,"constraint node"),statement:required(c.statement,"constraint statement"),severity:c.severity,expected:c.expected};
  });

  return canonicalize({proposal:{
    assumptions:[...proposal.assumptions],
    nodes,constraints,
    decisionNodeId:required(proposal.decisionNodeId,"decisionNodeId")
  }} as any);
}


export function modelProviderExplanationWireSchema():Record<string,unknown>{
  return {
    type:"object",additionalProperties:false,required:["summary","keyFactors","limitations"],
    properties:{
      summary:{type:"string"},
      keyFactors:{type:"array",maxItems:8,items:{type:"string"}},
      limitations:{type:"array",maxItems:8,items:{type:"string"}}
    }
  };
}

export function normalizeModelProviderExplanationWire(text:string):string{
  let root:any;
  try{root=JSON.parse(required(text,"provider explanation text"));}catch(error){
    if(error instanceof ModelAdapterError)throw error;
    throw new ModelAdapterError("MODEL_GATEWAY_SCHEMA","Provider explanation text is not valid JSON",502);
  }
  const top=object(root,"provider explanation");exact(top,["summary","keyFactors","limitations"],"provider explanation");
  if(typeof top.summary!=="string"||!top.summary.trim())throw new ModelAdapterError("MODEL_GATEWAY_SCHEMA","provider explanation summary is required",502);
  const list=(value:unknown,label:string):string[]=>{
    if(!Array.isArray(value)||value.length>8||value.some(x=>typeof x!=="string"||!x.trim())){
      throw new ModelAdapterError("MODEL_GATEWAY_SCHEMA",`provider explanation ${label} is invalid`,502);
    }
    return [...value];
  };
  return canonicalize({
    summary:top.summary,
    keyFactors:list(top.keyFactors,"keyFactors"),
    limitations:list(top.limitations,"limitations")
  } as any);
}
